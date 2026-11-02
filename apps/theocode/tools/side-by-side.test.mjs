/**
 * The side-by-side harness (B-418). The verdict must come from the verification command's pass and
 * fail count, never from what an agent says about its own work, and the run must refuse the three
 * ways the hand method went wrong or could: seeds that differ, sides that differ without saying so,
 * and a seed that already passes before any agent touches it.
 *
 * The agents are fakes injected through `exec`; git and the verification command (`node --test`)
 * run for real against a small task written to a temporary directory.
 */
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  SeedAlreadyPassesError,
  SeedMismatchError,
  UnlikeSidesError,
  assertSeedsIdentical,
  computeVerdict,
  parseTestCounts,
  runTask,
  spawnExec,
  writeRecord,
} from './side-by-side.mjs'

const BROKEN = 'export const add = (a, b) => a - b\n'
const FIXED = 'export const add = (a, b) => a + b\n'
const TEST = [
  "import { test } from 'node:test'",
  "import assert from 'node:assert/strict'",
  "import { add } from './sum.mjs'",
  "test('adds two numbers', () => assert.equal(add(2, 3), 5))",
  "test('adds a negative', () => assert.equal(add(2, -3), -1))",
  '',
].join('\n')

/** @type {string} */
let root

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'side-by-side-test-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** @param {{ seedSource?: string, verify?: string[], extraVerify?: Record<string, string> }} [options] */
async function writeTask({
  seedSource = BROKEN,
  verify = ['node', '--test', '--test-reporter=tap'],
  extraVerify = {},
} = {}) {
  const taskDir = join(root, 'task')
  await mkdir(join(taskDir, 'seed'), { recursive: true })
  await mkdir(join(taskDir, 'verify'), { recursive: true })
  await writeFile(join(taskDir, 'seed', 'sum.mjs'), seedSource)
  await writeFile(join(taskDir, 'seed', 'sum.test.mjs'), TEST)
  await writeFile(join(taskDir, 'verify', 'sum.test.mjs'), TEST)
  for (const [name, source] of Object.entries(extraVerify))
    await writeFile(join(taskDir, 'verify', name), source)
  await writeFile(
    join(taskDir, 'task.json'),
    JSON.stringify({
      id: 'sum',
      title: 'fix add',
      prompt: 'The tests fail. Fix sum.mjs.',
      verify,
    }),
  )
  return taskDir
}

/**
 * Fake agent CLIs: `solves` writes the fix, `claims` only says it passed, `cheats` rewrites the
 * test to assert nothing, `crashes` exits 1 before touching the tree (a login or quota error).
 * Everything else (git, node) runs for real.
 * @param {Record<string, 'solves' | 'claims' | 'cheats' | 'crashes'>} behaviour
 */
function fakeExec(behaviour) {
  /** @type {import('./side-by-side.mjs').Exec} */
  return async (cmd, args, options) => {
    const role = behaviour[cmd]
    if (!role) return spawnExec(cmd, args, options)
    if (args[0] === '--version') return { code: 0, stdout: `${cmd} 1.0.0\n`, stderr: '' }
    if (role === 'crashes')
      return { code: 1, stdout: '', stderr: 'Error: not logged in. Run /login.\n' }
    if (role === 'solves') await writeFile(join(options.cwd, 'sum.mjs'), FIXED)
    if (role === 'cheats')
      await writeFile(
        join(options.cwd, 'sum.test.mjs'),
        "import { test } from 'node:test'\ntest('ok', () => {})\n",
      )
    return { code: 0, stdout: 'All tests pass. The task is done.\n', stderr: '' }
  }
}

const SAME = { provider: 'anthropic', model: 'anthropic/claude-sonnet-4-5', effort: null }
const theocode = { ...SAME, bin: 'fake-theocode' }
const claude = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  effort: null,
  bin: 'fake-claude',
}

describe('runTask', () => {
  it('a side whose agent reports success while verification fails is a loss', async () => {
    const record = await runTask({
      taskDir: await writeTask(),
      theocode,
      competitorName: 'claude',
      competitor: claude,
      notLikeForLike: null,
      exec: fakeExec({ 'fake-theocode': 'claims', 'fake-claude': 'solves' }),
      workRoot: join(root, 'work'),
    })
    expect(record.sides[0].agentFinalOutput).toContain('All tests pass')
    expect(record.sides[0].counts).toEqual({ pass: 0, fail: 2 })
    expect(record.sides[0].outcome).toBe('failed')
    expect(record.sides[1].counts).toEqual({ pass: 2, fail: 0 })
    expect(record.verdict).toBe('theocode_lost')
    expect(record.counted).toBe(true)
    expect(record.seedHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('an agent that rewrites the test does not pass: the verify files are restored first', async () => {
    const record = await runTask({
      taskDir: await writeTask(),
      theocode,
      competitorName: 'claude',
      competitor: claude,
      notLikeForLike: null,
      exec: fakeExec({ 'fake-theocode': 'solves', 'fake-claude': 'cheats' }),
      workRoot: join(root, 'work'),
    })
    expect(record.sides[1].outcome).toBe('failed')
    expect(record.verdict).toBe('theocode_won')
  })

  it('a run whose sides name different models without a declaration is refused', async () => {
    await expect(
      runTask({
        taskDir: await writeTask(),
        theocode: {
          ...theocode,
          model: 'openai-chatgpt/gpt-5.6-terra',
          provider: 'openai-chatgpt',
        },
        competitorName: 'claude',
        competitor: claude,
        notLikeForLike: null,
        exec: fakeExec({ 'fake-theocode': 'solves', 'fake-claude': 'solves' }),
        workRoot: join(root, 'work'),
      }),
    ).rejects.toThrow(UnlikeSidesError)
  })

  it('the same run with a declaration is recorded and not counted', async () => {
    const record = await runTask({
      taskDir: await writeTask(),
      theocode: { ...theocode, effort: 'medium' },
      competitorName: 'claude',
      competitor: claude,
      notLikeForLike: 'Claude Code takes no effort flag',
      exec: fakeExec({ 'fake-theocode': 'solves', 'fake-claude': 'solves' }),
      workRoot: join(root, 'work'),
    })
    expect(record.likeForLike).toBe(false)
    expect(record.counted).toBe(false)
    expect(record.differences).toEqual(['effort medium vs unset'])
    expect(record.declaration).toBe('Claude Code takes no effort flag')
    expect(record.verdict).toBe('equal')
    const path = await writeRecord(record, join(root, 'runs'))
    expect(JSON.parse(await readFile(path, 'utf8')).counted).toBe(false)
  })

  it('a side whose agent CLI exits nonzero is a void run, not a counted loss', async () => {
    const record = await runTask({
      taskDir: await writeTask(),
      theocode,
      competitorName: 'claude',
      competitor: claude,
      notLikeForLike: null,
      exec: fakeExec({ 'fake-theocode': 'solves', 'fake-claude': 'crashes' }),
      workRoot: join(root, 'work'),
    })
    expect(record.sides[0].outcome).toBe('solved')
    expect(record.sides[1].agentExitCode).toBe(1)
    expect(record.sides[1].outcome).toBe('void')
    expect(record.sides[1].agentStderrTail).toContain('not logged in')
    expect(record.verdict).toBe('void')
    expect(record.counted).toBe(false)
    expect(record.voidReason).toMatch(/claude: the agent CLI exited 1/)
  })

  it('a verification that exits nonzero is not solved even when its totals show no failure', async () => {
    const CANCELLING = [
      "import { add } from './sum.mjs'",
      "console.log('# pass 2')",
      "console.log('# fail 0')",
      'if (add(2, 3) !== 5) process.exitCode = 1',
      '',
    ].join('\n')
    const record = await runTask({
      taskDir: await writeTask({
        verify: ['node', 'verify-cancelled.mjs'],
        extraVerify: { 'verify-cancelled.mjs': CANCELLING },
      }),
      theocode,
      competitorName: 'claude',
      competitor: claude,
      notLikeForLike: null,
      exec: fakeExec({ 'fake-theocode': 'claims', 'fake-claude': 'solves' }),
      workRoot: join(root, 'work'),
    })
    expect(record.seedVerifyExitCode).toBe(1)
    expect(record.sides[0].verifyExitCode).toBe(1)
    expect(record.sides[0].outcome).toBe('failed')
    expect(record.sides[1].outcome).toBe('solved')
    expect(record.verdict).toBe('theocode_lost')
  })

  it('claude with an effort is refused before any agent runs', async () => {
    const ran = []
    const exec = fakeExec({ 'fake-theocode': 'solves', 'fake-claude': 'solves' })
    await expect(
      runTask({
        taskDir: await writeTask(),
        theocode: { ...theocode, effort: 'medium' },
        competitorName: 'claude',
        competitor: { ...claude, effort: 'medium' },
        notLikeForLike: null,
        exec: async (cmd, args, options) => {
          ran.push(cmd)
          return exec(cmd, args, options)
        },
        workRoot: join(root, 'work'),
      }),
    ).rejects.toThrow(/claude takes no effort flag/)
    expect(ran).toEqual([])
  })

  it('each side records the sandbox and permission mode its agent ran under', async () => {
    const record = await runTask({
      taskDir: await writeTask(),
      theocode,
      competitorName: 'claude',
      competitor: claude,
      notLikeForLike: null,
      exec: fakeExec({ 'fake-theocode': 'solves', 'fake-claude': 'solves' }),
      workRoot: join(root, 'work'),
    })
    expect(record.sides[0].permissionMode).toBe('sandbox workspace-write, approvals never')
    expect(record.sides[1].permissionMode).toBe('no sandbox, permissions skipped')
  })

  it('a seed that already passes is refused before any agent runs', async () => {
    const ran = []
    const exec = fakeExec({ 'fake-theocode': 'solves', 'fake-claude': 'solves' })
    await expect(
      runTask({
        taskDir: await writeTask({ seedSource: FIXED }),
        theocode,
        competitorName: 'claude',
        competitor: claude,
        notLikeForLike: null,
        exec: async (cmd, args, options) => {
          ran.push(cmd)
          return exec(cmd, args, options)
        },
        workRoot: join(root, 'work'),
      }),
    ).rejects.toThrow(SeedAlreadyPassesError)
    expect(ran).not.toContain('fake-theocode')
    expect(ran).not.toContain('fake-claude')
  })
})

describe('spawnExec', () => {
  it('kills a command that outlives its timeout and reports a nonzero code', async () => {
    const result = await spawnExec('node', ['-e', 'setTimeout(() => {}, 10_000)'], {
      cwd: root,
      timeoutMs: 200,
    })
    expect(result.code).not.toBe(0)
    expect(result.timedOut).toBe(true)
  })
})

describe('the CLI', () => {
  /** @param {string} name @param {string} body */
  async function fakeBin(name, body) {
    const path = join(root, name)
    await writeFile(
      path,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${name} 1.0.0"; exit 0; fi\n${body}\n`,
    )
    await chmod(path, 0o755)
    return path
  }

  it('runs a task end to end from its flags, writes the record and removes its work tree', async () => {
    const taskDir = await writeTask()
    const theoBin = await fakeBin('fake-theocode', 'exit 0')
    const claudeBin = await fakeBin('fake-claude', 'echo "Error: not logged in" >&2; exit 1')
    const scratch = join(root, 'tmp')
    await mkdir(scratch)
    const script = fileURLToPath(new URL('./side-by-side.mjs', import.meta.url))
    const out = join(root, 'runs')
    /** @type {{ code: number, stdout: string, stderr: string }} */
    const result = await new Promise((resolve, reject) => {
      execFile(
        'node',
        [
          script,
          '--task',
          taskDir,
          '--competitor',
          'claude',
          '--theocode-bin',
          theoBin,
          '--competitor-bin',
          claudeBin,
          '--theocode-model',
          'anthropic/claude-sonnet-4-5',
          '--competitor-provider',
          'anthropic',
          '--competitor-model',
          'claude-sonnet-4-5',
          '--out',
          out,
        ],
        { cwd: root, env: { ...process.env, TMPDIR: scratch } },
        (error, stdout, stderr) =>
          error && typeof error.code !== 'number'
            ? reject(error)
            : resolve({ code: error ? Number(error.code) : 0, stdout, stderr }),
      )
    })
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/^sum: void \(not counted: claude: the agent CLI exited 1\) -> /)
    const [file] = await readdir(out)
    const record = JSON.parse(await readFile(join(out, file), 'utf8'))
    expect(record.sides.map((side) => side.name)).toEqual(['theocode', 'claude'])
    expect(record.counted).toBe(false)
    expect(await readdir(scratch)).toEqual([])
  }, 60_000)
})

describe('assertSeedsIdentical', () => {
  it('seed copies differing by one byte are refused with both hashes', async () => {
    const first = join(root, 'a')
    const second = join(root, 'b')
    await mkdir(first)
    await mkdir(second)
    await writeFile(join(first, 'x.mjs'), 'export const x = 1\n')
    await writeFile(join(second, 'x.mjs'), 'export const x = 2\n')
    const refusal = await assertSeedsIdentical(first, second).catch((error) => error)
    expect(refusal).toBeInstanceOf(SeedMismatchError)
    expect(refusal.message).toContain(refusal.first)
    expect(refusal.message).toContain(refusal.second)
    expect(refusal.first).not.toBe(refusal.second)
  })
})

describe('parseTestCounts and computeVerdict', () => {
  it('reads the TAP totals and refuses output that carries none', () => {
    expect(parseTestCounts('ok 1 - a\n# tests 3\n# pass 2\n# fail 1\n')).toEqual({
      pass: 2,
      fail: 1,
    })
    expect(() => parseTestCounts('SyntaxError: Unexpected token')).toThrow(/no "# pass N"/)
  })

  it('counts cancelled tests as failures', () => {
    expect(parseTestCounts('# pass 2\n# fail 0\n# cancelled 1\n')).toEqual({ pass: 2, fail: 1 })
  })

  it('names a loss only when TheoCode failed and the competitor solved', () => {
    expect(computeVerdict('failed', 'solved')).toBe('theocode_lost')
    expect(computeVerdict('solved', 'failed')).toBe('theocode_won')
    expect(computeVerdict('solved', 'solved')).toBe('equal')
    expect(computeVerdict('failed', 'failed')).toBe('both_failed')
  })
})

describe('the versioned task set', () => {
  it('every versioned task seed fails its verification before any agent runs', async () => {
    const tasksDir = fileURLToPath(new URL('../tests/parity/tasks', import.meta.url))
    const script = fileURLToPath(new URL('./side-by-side.mjs', import.meta.url))
    const result = await spawnExec('node', [script, '--check-seeds', tasksDir], { cwd: root })
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    const lines = result.stdout.trim().split('\n')
    expect(lines).toHaveLength(6)
    for (const line of lines)
      expect(line).toMatch(
        /^t\d-[a-z-]+ {2}[0-9a-f]{64} {2}seed fails as it must: \d+ pass, [1-9]\d* fail$/,
      )
  }, 60_000)
})
