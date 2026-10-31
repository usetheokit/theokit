import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { copyFixture, FIXTURE_SECRETS } from './migration-fixtures.js'

/** The built import entry; `pnpm --filter theoclaw run build` writes it. */
const IMPORT_ENTRY = join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'import-main.js')

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
