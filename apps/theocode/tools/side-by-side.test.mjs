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
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  SeedAlreadyPassesError,
  SeedMismatchError,
  SeedVerificationHangsError,
  UnlikeSidesError,
  assertSeedsIdentical,
  computeVerdict,
  parseTestCounts,
  runTask,
  spawnExec,
  writeRecord,
} from './side-by-side.mjs'
import { parseExecArgs } from '../packages/cli/src/runtime/args.ts'

const BROKEN = 'export const add = (a, b) => a - b\n'
const FIXED = 'export const add = (a, b) => a + b\n'
const HANGS = 'setInterval(() => {}, 1000)\nexport const add = (a, b) => a + b\n'
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
 * test to assert nothing, `crashes` exits 1 before touching the tree (a login or quota error),
 * `hangs` leaves code that never lets the verification exit.
 * Everything else (git, node) runs for real.
 * @param {Record<string, 'solves' | 'claims' | 'cheats' | 'crashes' | 'hangs'>} behaviour
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
    if (role === 'hangs') await writeFile(join(options.cwd, 'sum.mjs'), HANGS)
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

  it('a side whose tree cannot run the verification prints no totals and fails instead of aborting the run', async () => {
    const LOADS = [
      "const { add } = await import('./sum.mjs')",
      "console.log('# pass ' + (add(2, 3) === 5 ? 2 : 0))",
      "console.log('# fail ' + (add(2, 3) === 5 ? 0 : 2))",
      '',
    ].join('\n')
    const inner = fakeExec({ 'fake-theocode': 'claims', 'fake-claude': 'solves' })
    /** @type {import('./side-by-side.mjs').Exec} */
    const exec = async (cmd, args, options) => {
      const result = await inner(cmd, args, options)
      if (cmd === 'fake-theocode') await writeFile(join(options.cwd, 'sum.mjs'), 'export const add = (\n')
      return result
    }
    const record = await runTask({
      taskDir: await writeTask({
        verify: ['node', 'verify-loads.mjs'],
        extraVerify: { 'verify-loads.mjs': LOADS },
      }),
      theocode,
      competitorName: 'claude',
      competitor: claude,
      notLikeForLike: null,
      exec,
      workRoot: join(root, 'work'),
    })
    expect(record.sides[0].counts).toBeNull()
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

  it('TheoCode receives the task prompt unchanged as its headless prompt, with no extra word', async () => {
    /** @type {Record<string, string[]>} */
    const argvByBin = {}
    const solve = fakeExec({ 'fake-theocode': 'solves', 'fake-claude': 'solves' })
    const record = await runTask({
      taskDir: await writeTask(),
      theocode,
      competitorName: 'claude',
      competitor: claude,
      notLikeForLike: null,
      exec: async (cmd, args, options) => {
        if (cmd.startsWith('fake-') && args[0] !== '--version') argvByBin[cmd] = args
        return solve(cmd, args, options)
      },
      workRoot: join(root, 'work'),
    })
    const parsed = parseExecArgs(argvByBin['fake-theocode'], false)
    expect(parsed).toMatchObject({ mode: 'run', prompt: 'The tests fail. Fix sum.mjs.' })
    expect(record.sides[0].outcome).toBe('solved')
  })

  it('a codex competitor runs through codex exec with the same prompt and is recorded unsandboxed', async () => {
    /** @type {Record<string, string[]>} */
    const argvByBin = {}
    const solve = fakeExec({ 'fake-theocode': 'solves', 'fake-codex': 'claims' })
    const record = await runTask({
      taskDir: await writeTask(),
      theocode: { provider: 'openai', model: 'openai/gpt-5', effort: 'high', bin: 'fake-theocode' },
      competitorName: 'codex',
      competitor: { provider: 'openai', model: 'gpt-5', effort: 'high', bin: 'fake-codex' },
      notLikeForLike: null,
      exec: async (cmd, args, options) => {
        if (cmd.startsWith('fake-') && args[0] !== '--version') argvByBin[cmd] = args
        return solve(cmd, args, options)
      },
      workRoot: join(root, 'work'),
    })
    const codexArgv = argvByBin['fake-codex']
    expect(codexArgv[0]).toBe('exec')
    expect(codexArgv).toContain('model_reasoning_effort=high')
    expect(codexArgv.at(-1)).toBe('The tests fail. Fix sum.mjs.')
    expect(record.sides[1].name).toBe('codex')
    expect(record.sides[1].permissionMode).toBe('no sandbox, approvals bypassed')
    expect(record.sides[1].outcome).toBe('failed')
    expect(record.verdict).toBe('theocode_won')
  })

  it('an agent that outlives its bound is a void side naming the bound it was given', async () => {
    /** @type {number | undefined} */
    let agentBound
    const solve = fakeExec({ 'fake-theocode': 'solves', 'fake-claude': 'solves' })
    const record = await runTask({
      taskDir: await writeTask(),
      theocode,
      competitorName: 'claude',
      competitor: claude,
      notLikeForLike: null,
      agentTimeoutMs: 1234,
      exec: async (cmd, args, options) => {
        if (cmd !== 'fake-theocode' || args[0] === '--version') return solve(cmd, args, options)
        agentBound = options.timeoutMs
        return { code: 137, stdout: '', stderr: '', timedOut: true }
      },
      workRoot: join(root, 'work'),
    })
    expect(agentBound).toBe(1234)
    expect(record.sides[0].outcome).toBe('void')
    expect(record.sides[0].voidReason).toBe(
      'theocode: the agent CLI ran past 1234 ms and was killed',
    )
    expect(record.counted).toBe(false)
  })

  it('a verification whose output carries no totals is refused, quoting its last lines', async () => {
    const run = runTask({
      taskDir: await writeTask({
        verify: ['node', 'silent.mjs'],
        extraVerify: { 'silent.mjs': "console.log('nothing to count')\nprocess.exitCode = 1\n" },
      }),
      theocode,
      competitorName: 'claude',
      competitor: claude,
      notLikeForLike: null,
      exec: fakeExec({ 'fake-theocode': 'solves', 'fake-claude': 'solves' }),
      workRoot: join(root, 'work'),
    })
    await expect(run).rejects.toThrow(
      'the verification output carries no "# pass N" and "# fail N" totals; last lines: nothing to count',
    )
  })

  it('a task.json without a verify command is refused before any agent runs', async () => {
    const taskDir = await writeTask()
    await writeFile(
      join(taskDir, 'task.json'),
      JSON.stringify({ id: 'sum', title: 'fix add', prompt: 'Fix it.', verify: [] }),
    )
    /** @type {string[]} */
    const ran = []
    const run = runTask({
      taskDir,
      theocode,
      competitorName: 'claude',
      competitor: claude,
      notLikeForLike: null,
      exec: async (cmd, args, options) => {
        ran.push(cmd)
        return spawnExec(cmd, args, options)
      },
      workRoot: join(root, 'work'),
    })
    await expect(run).rejects.toThrow(
      `${taskDir}/task.json: "verify" must be a non-empty command array`,
    )
    expect(ran).toEqual([])
  })

  it('a verification that outlives its bound is killed and scores that side failed, with the reason', async () => {
    const record = await runTask({
      taskDir: await writeTask(),
      theocode,
      competitorName: 'claude',
      competitor: claude,
      notLikeForLike: null,
      exec: fakeExec({ 'fake-theocode': 'solves', 'fake-claude': 'hangs' }),
      workRoot: join(root, 'work'),
      verifyTimeoutMs: 3000,
    })
    expect(record.sides[0].outcome).toBe('solved')
    expect(record.sides[0].verifyTimedOut).toBe(false)
    expect(record.sides[1].outcome).toBe('failed')
    expect(record.sides[1].verifyTimedOut).toBe(true)
    expect(record.sides[1].failReason).toBe(
      'claude: the verification ran past 3000 ms and was killed',
    )
    expect(record.verdict).toBe('theocode_won')
    expect(record.counted).toBe(true)
  }, 30_000)

  it('a seed whose verification outlives its bound is refused before any agent runs', async () => {
    const ran = []
    const exec = fakeExec({ 'fake-theocode': 'solves', 'fake-claude': 'solves' })
    await expect(
      runTask({
        taskDir: await writeTask({ verify: ['node', '-e', 'setInterval(() => {}, 1000)'] }),
        theocode,
        competitorName: 'claude',
        competitor: claude,
        notLikeForLike: null,
        exec: async (cmd, args, options) => {
          ran.push(cmd)
          return exec(cmd, args, options)
        },
        workRoot: join(root, 'work'),
        verifyTimeoutMs: 500,
      }),
    ).rejects.toThrow(new SeedVerificationHangsError('sum', 500))
    expect(ran).not.toContain('fake-theocode')
    expect(ran).not.toContain('fake-claude')
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

  /**
   * @param {string[]} args
   * @param {Record<string, string>} [env]
   * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
   */
  function runCli(args, env = {}) {
    const script = fileURLToPath(new URL('./side-by-side.mjs', import.meta.url))
    return new Promise((resolve, reject) => {
      execFile(
        'node',
        [script, ...args],
        { cwd: root, env: { ...process.env, ...env } },
        (error, stdout, stderr) =>
          error && typeof error.code !== 'number'
            ? reject(error)
            : resolve({ code: error ? Number(error.code) : 0, stdout, stderr }),
      )
    })
  }

  it('runs a task end to end from its flags, writes the record and removes its work tree', async () => {
    const taskDir = await writeTask()
    const theoBin = await fakeBin('fake-theocode', 'exit 0')
    const claudeBin = await fakeBin('fake-claude', 'echo "Error: not logged in" >&2; exit 1')
    const scratch = join(root, 'tmp')
    await mkdir(scratch)
    const out = join(root, 'runs')
    const result = await runCli(
      [
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
      { TMPDIR: scratch },
    )
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/^sum: void \(not counted: claude: the agent CLI exited 1\) -> /)
    const [file] = await readdir(out)
    const record = JSON.parse(await readFile(join(out, file), 'utf8'))
    expect(record.sides.map((side) => side.name)).toEqual(['theocode', 'claude'])
    expect(record.counted).toBe(false)
    expect(await readdir(scratch)).toEqual([])
  }, 60_000)

  it('refuses an --agent-timeout-ms that is not a positive integer', async () => {
    const result = await runCli([
      '--task',
      await writeTask(),
      '--competitor',
      'claude',
      '--theocode-model',
      'anthropic/claude-sonnet-4-5',
      '--competitor-provider',
      'anthropic',
      '--competitor-model',
      'claude-sonnet-4-5',
      '--agent-timeout-ms',
      'soon',
    ])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'side-by-side: --agent-timeout-ms must be a positive integer, got "soon"',
    )
  })

  it('refuses different models with no --not-like-for-like declaration before any agent runs', async () => {
    const taskDir = await writeTask()
    const ran = join(root, 'agent-ran')
    const theoBin = await fakeBin('fake-theocode', `touch ${ran}; exit 0`)
    const claudeBin = await fakeBin('fake-claude', `touch ${ran}; exit 0`)
    const out = join(root, 'runs')
    const result = await runCli([
      '--task',
      taskDir,
      '--competitor',
      'claude',
      '--theocode-bin',
      theoBin,
      '--competitor-bin',
      claudeBin,
      '--theocode-model',
      'openai-chatgpt/gpt-5.6-terra',
      '--competitor-provider',
      'anthropic',
      '--competitor-model',
      'claude-sonnet-4-5',
      '--out',
      out,
    ])
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/^side-by-side: the two sides differ \(.*model.*\)/)
    expect(result.stderr).toContain('pass --not-like-for-like "<reason>"')
    expect(existsSync(ran)).toBe(false)
    expect(existsSync(out)).toBe(false)
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
