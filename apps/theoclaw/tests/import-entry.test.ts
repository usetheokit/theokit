import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readImport } from '../src/migration/import-store.js'
import { copyFixture, FIXTURE_SECRETS } from './migration-fixtures.js'

/** The built import entry; `pnpm --filter theoclaw run build` writes it. */
const IMPORT_ENTRY = join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'import-main.js')
/** The built process entry. */
const START_ENTRY = join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'main.js')
const MODEL_KEY = `model-key-${randomBytes(8).toString('hex')}`
const TOKEN = `control-token-${randomBytes(16).toString('hex')}`

interface Run {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

/** FR-006, FR-007, NFR-003 (AC-010, AC-011): the import entry, run as the owner runs it. */
describe('the import entry', () => {
  let dir = ''
  let home = ''
  let stateDir = ''

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'theoclaw-migration-')))
    home = join(dir, 'user-home')
    stateDir = join(dir, 'state')
    mkdirSync(home)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** Runs the entry with only what it needs in the environment: no profile, no model, the given state directory. */
  function runImport(args: readonly string[], options: { stateDir?: string; cwd?: string } = {}): Run {
    const result = spawnSync(process.execPath, [IMPORT_ENTRY, ...args], {
      cwd: options.cwd ?? dir,
      env: { PATH: process.env.PATH ?? '', HOME: home, ...(options.stateDir === undefined ? {} : { THEOCLAW_STATE_DIR: options.stateDir }) },
      encoding: 'utf8',
      timeout: 60_000,
    })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  }

  it('is built', () => {
    expect(existsSync(IMPORT_ENTRY), 'run pnpm --filter theoclaw run build first').toBe(true)
  })

  it('the import entry exits 1 without a state directory, without --from or with a missing source', () => {
    const hermes = copyFixture('hermes', join(dir, 'hermes'))

    const noState = runImport(['--from', 'hermes', '--source', hermes])
    const noFrom = runImport(['--source', hermes], { stateDir })
    const otherKind = runImport(['--from', 'openclaw', '--source', hermes], { stateDir })
    const missing = runImport(['--from', 'hermes', '--source', join(dir, 'absent')], { stateDir })

    expect([noState.status, noFrom.status, otherKind.status, missing.status]).toEqual([1, 1, 1, 1])
    expect(noState.stderr).toContain('theoclaw import: THEOCLAW_STATE_DIR must name the directory the import is written to')
    expect(noFrom.stderr).toContain('theoclaw import: --from must be claude-code or hermes')
    expect(otherKind.stderr).toContain('--from must be claude-code or hermes')
    expect(missing.stderr).toContain(`theoclaw import: --source: ${join(dir, 'absent')} is not a directory`)
    // Nothing was staged by any refused run.
    expect(existsSync(stateDir) ? readdirSync(stateDir) : []).toEqual([])
  })

  it('refuses an unknown flag', () => {
    const run = runImport(['--from', 'hermes', '--frmo', 'x'], { stateDir })

    expect(run.status).toBe(1)
    expect(run.stderr).toContain("Unknown option '--frmo'")
  })

  it('the import entry prints counts and dropped lines and no MCP secret', () => {
    const claude = copyFixture('claude-code', join(dir, 'claude'))
    const hermes = copyFixture('hermes', join(dir, 'hermes'))

    const fromClaude = runImport(['--from', 'claude-code', '--home', join(claude, 'home'), '--project', join(claude, 'project')], { stateDir })
    const fromHermes = runImport(['--from', 'hermes', '--source', hermes], { stateDir: join(dir, 'state-hermes') })

    expect(fromClaude.status, fromClaude.stderr).toBe(0)
    expect(fromClaude.stdout.split('\n')).toEqual([
      'imported claude-code: 3 instruction files',
      'imported claude-code: 0 memory files',
      'imported claude-code: 2 skills',
      'imported claude-code: 3 MCP servers',
      'dropped .claude.json#shared: shadowed by the project scope',
      'dropped skills/shared-skill/SKILL.md: shadowed by the project scope',
      '',
    ])
    expect(fromHermes.status, fromHermes.stderr).toBe(0)
    expect(fromHermes.stdout).toContain('imported hermes: 2 MCP servers')
    expect(fromHermes.stdout).toContain('dropped skills/no-description/SKILL.md: frontmatter lacks name or description')
    expect(fromHermes.stdout).toContain('dropped platforms: channels are not imported')
    for (const secret of FIXTURE_SECRETS) {
      expect(fromClaude.stdout + fromClaude.stderr + fromHermes.stdout + fromHermes.stderr).not.toContain(secret)
    }
    expect(existsSync(join(stateDir, 'import', 'manifest.json'))).toBe(true)
  })

  it('an empty source imports with every count at 0 (EC-8)', () => {
    const empty = join(dir, 'empty-hermes')
    mkdirSync(empty)

    const run = runImport(['--from', 'hermes', '--source', empty], { stateDir })

    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toBe(
      ['instruction files', 'memory files', 'skills', 'MCP servers'].map((kind) => `imported hermes: 0 ${kind}\n`).join(''),
    )
  })

  it('--project . and --source given relative resolve against the working directory (EC-3)', () => {
    const claude = copyFixture('claude-code', join(dir, 'claude'))
    const project = join(claude, 'project')

    const run = runImport(['--from', 'claude-code', '--home', join(claude, 'home'), '--project', '.', '--source', relative(project, join(claude, 'home', '.claude'))], {
      stateDir,
      cwd: project,
    })

    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toContain('imported claude-code: 3 instruction files')
  })
})

interface Started {
  readonly child: ChildProcess
  readonly output: () => string
  readonly exited: Promise<number | null>
}

/** FR-010, FR-011, NFR-003 (AC-014, EC-10): a started process reading the import. */
describe('the start with an import', () => {
  let dir = ''
  let home = ''
  let running: ChildProcess | undefined

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'theoclaw-migration-')))
    home = join(dir, 'user-home')
    mkdirSync(home)
  })

  afterEach(async () => {
    const child = running
    running = undefined
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      const gone = new Promise((resolve) => child.once('exit', resolve))
      child.kill('SIGKILL')
      await gone
    }
    rmSync(dir, { recursive: true, force: true })
  })

  function importInto(stateDir: string, source: string): void {
    const run = spawnSync(process.execPath, [IMPORT_ENTRY, '--from', 'hermes', '--source', source], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? '', HOME: home, THEOCLAW_STATE_DIR: stateDir },
      encoding: 'utf8',
      timeout: 60_000,
    })
    expect(run.status, run.stderr).toBe(0)
  }

  /** The built entry with only what a start needs; an `undefined` override leaves a variable unset. */
  function start(overrides: Readonly<Record<string, string | undefined>>): Started {
    const workspace = join(dir, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const variables = Object.entries({
      PATH: process.env.PATH ?? '',
      HOME: home,
      THEOCLAW_MODEL: 'stub',
      OPENROUTER_API_KEY: MODEL_KEY,
      THEOCLAW_PORT: '0',
      THEOCLAW_CONTROL_TOKEN: TOKEN,
      THEOCLAW_OWNERS: 'telegram:owner',
      THEOCLAW_DM_POLICY: 'allowlist',
      THEOCLAW_WORKSPACE: workspace,
      ...overrides,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined)
    const child = spawn(process.execPath, [START_ENTRY], { cwd: workspace, env: Object.fromEntries(variables), stdio: ['ignore', 'pipe', 'pipe'] })
    running = child
    let output = ''
    child.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()))
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
    return { child, output: () => output, exited }
  }

  /** Polls the output until `pattern` appears; fails naming what never did. */
  async function waitForLine(run: Started, pattern: RegExp): Promise<void> {
    const deadline = Date.now() + 30_000
    for (;;) {
      if (pattern.test(run.output())) return
      if (run.child.exitCode !== null) throw new Error(`the start exited ${run.child.exitCode}: ${run.output()}`)
      if (Date.now() > deadline) throw new Error(`no line matching ${pattern} within 30 s: ${run.output()}`)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  async function stopped(run: Started): Promise<string> {
    run.child.kill('SIGINT')
    await run.exited
    return run.output()
  }

  it('the started process names the import and prints no MCP secret', { timeout: 120_000 }, async () => {
    const stateDir = join(dir, 'state')
    importInto(stateDir, copyFixture('hermes', join(dir, 'hermes')))

    const off = start({ THEOCLAW_STATE_DIR: stateDir })
    await waitForLine(off, /control plane listening on/)
    const offOutput = await stopped(off)
    const on = start({ THEOCLAW_STATE_DIR: stateDir, THEOCLAW_IMPORTED_MCP: 'on' })
    await waitForLine(on, /control plane listening on/)
    const onOutput = await stopped(on)
    const bad = start({ THEOCLAW_STATE_DIR: stateDir, THEOCLAW_IMPORTED_MCP: 'yes' })
    const badCode = await bad.exited
    const none = start({ THEOCLAW_STATE_DIR: undefined })
    await waitForLine(none, /control plane listening on/)
    const noneOutput = await stopped(none)

    const lines = offOutput.split('\n')
    const instanceAt = lines.indexOf('theoclaw: instance started, no profile')
    expect(instanceAt).toBeGreaterThanOrEqual(0)
    expect(lines[instanceAt + 1]).toBe(
      'theoclaw: imported hermes setup: 2 instruction files, 2 memory files, 1 skills, 2 MCP servers (off: set THEOCLAW_IMPORTED_MCP=on)',
    )
    expect(onOutput).toContain('theoclaw: imported hermes setup: 2 instruction files, 2 memory files, 1 skills, 2 MCP servers (on)')
    expect(badCode).toBe(1)
    expect(bad.output()).toMatch(/^theoclaw: .*THEOCLAW_IMPORTED_MCP must be on or unset/m)
    expect(noneOutput).not.toContain('imported hermes setup')
    for (const output of [offOutput, onOutput, bad.output(), noneOutput]) {
      for (const secret of [...FIXTURE_SECRETS, MODEL_KEY, TOKEN]) expect(output).not.toContain(secret)
    }
  })

  it('an unset variable in the import prints one stderr note naming it and no value, and the start still listens', { timeout: 120_000 }, async () => {
    const stateDir = join(dir, 'state')
    const source = join(dir, 'hermes-unset')
    mkdirSync(source)
    writeFileSync(
      join(source, 'config.yaml'),
      'mcp_servers:\n  db:\n    command: npx\n    env:\n      TOKEN: ${THEOCLAW_MIGRATION_START_UNSET}\n      KEY: fixture-secret-start-sentinel\n',
    )
    importInto(stateDir, source)

    const run = start({ THEOCLAW_STATE_DIR: stateDir })
    await waitForLine(run, /control plane listening on/)
    const output = await stopped(run)

    const notes = output.split('\n').filter((line) => line.startsWith('theoclaw: import note: '))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('THEOCLAW_MIGRATION_START_UNSET')
    expect(notes[0]).toContain('"db"')
    expect(output).not.toContain('fixture-secret-start-sentinel')
  })
})

/** T5.1: the live test's MCP fixture server answers the handshake, before any paid turn depends on it. */
describe('the token MCP fixture server', () => {
  const SERVER = fileURLToPath(new URL('./live/fixtures/token-mcp-server.mjs', import.meta.url))
  let dir = ''

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'theoclaw-migration-')))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('answers initialize, tools/list and tools/call with its token when run from an imported config', () => {
    const source = join(dir, 'hermes')
    const home = join(dir, 'user-home')
    mkdirSync(source)
    mkdirSync(home)
    writeFileSync(join(source, 'config.yaml'), `mcp_servers:\n  token:\n    command: ${JSON.stringify(process.execPath)}\n    args: [${JSON.stringify(SERVER)}, tok-offline]\n`)
    const stateDir = join(dir, 'state')
    const imported = spawnSync(process.execPath, [IMPORT_ENTRY, '--from', 'hermes', '--source', source], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? '', HOME: home, THEOCLAW_STATE_DIR: stateDir },
      encoding: 'utf8',
      timeout: 60_000,
    })
    expect(imported.status, imported.stderr).toBe(0)
    const server = readImport(stateDir)?.mcpServers.token as { command: string; args: string[] }
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'reveal_token', arguments: {} } },
    ]

    const run = spawnSync(server.command, server.args, { input: requests.map((request) => JSON.stringify(request)).join('\n') + '\n', encoding: 'utf8', timeout: 30_000 })

    expect(run.status, run.stderr).toBe(0)
    const answers = run.stdout.trim().split('\n').map((line) => JSON.parse(line) as { id: number; result: Record<string, unknown> })
    expect(answers.map((answer) => answer.id)).toEqual([1, 2, 3])
    expect(answers[0]!.result.protocolVersion).toBe('2025-06-18')
    expect(answers[1]!.result.tools).toEqual([expect.objectContaining({ name: 'reveal_token' })])
    expect(answers[2]!.result.content).toEqual([{ type: 'text', text: 'tok-offline' }])
  })
})

