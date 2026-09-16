/**
 * #72 — one directory for this product's state, on both sides.
 *
 * Measured on disk 2026-09-04: `~/.theocode/` held `auth.json` and `config.toml`, `~/.theokit/` held
 * the projects root, the hook approvals, the MCP tokens, the trust store — and a SECOND `auth.json`,
 * nine days stale, that nothing reads and nothing rotates. A project got the same treatment:
 * `config.toml` under `.theocode/`, everything else under `.theokit/`.
 *
 * `config.ts` already carried the measurement that this split costs users: a valid `[[hooks]]` block
 * written into `.theokit/config.toml` produced `hooks: []` from a trusted directory, with no error,
 * and read exactly like a product defect. The operator who wrote it was not confused — they picked
 * the directory the product uses for everything else.
 *
 * `home_dir` is what makes unification possible without stranding anyone: it names ONE root, so the
 * old root can be read and never written.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadConfig } from '../../src/config/config.js'
import { homeStateDir } from '../../src/config/home-dir.js'

let home: string
let project: string

const OPEN = {
  allows: { projectConfig: true, hooks: true, skills: true, mcp: true, memory: true, agentsMd: true },
} as unknown as Parameters<typeof loadConfig>[0]['posture']

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-state-home-'))
  project = mkdtempSync(join(tmpdir(), 'theocode-state-proj-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
})

/**
 * The file these assertions are about changed name — `config.toml` became `settings.json` when the
 * two dialects were unified. What #72 fixed did NOT change: one root for this product's state, the
 * previous root still read so nobody is stranded, and the trust gate deciding the project side
 * regardless of which root the project used. Those are the invariants below.
 */
function writeSettings(dir: string, rel: string, values: Record<string, unknown>): void {
  mkdirSync(join(dir, rel), { recursive: true })
  writeFileSync(join(dir, rel, 'settings.json'), JSON.stringify(values))
}

describe('#72 — homeStateDir is the one answer', () => {
  it('test_it_follows_the_configured_root', () => {
    expect(homeStateDir({ THEOKIT_HOME: join(home, '.claude') }, home)).toBe(join(home, '.claude'))
  })

  it('test_it_defaults_to_the_root_every_install_already_has', () => {
    expect(homeStateDir({}, home)).toBe(join(home, '.theokit'))
  })
})

describe('#72 — settings.json is read from the unified directory', () => {
  it('test_the_unified_home_location_is_read', () => {
    writeSettings(home, '.theokit', { model: 'unified/one' })

    expect(loadConfig({ projectDir: project, userDir: home, env: {}, posture: OPEN }).model).toBe(
      'unified/one',
    )
  })

  it('test_the_previous_home_location_still_works', () => {
    // Nobody is stranded. An operator who configured this product before the directories were one
    // does not get a silent reset to defaults.
    writeSettings(home, '.theocode', { model: 'legacy/one' })

    expect(loadConfig({ projectDir: project, userDir: home, env: {}, posture: OPEN }).model).toBe(
      'legacy/one',
    )
  })

  it('test_the_unified_location_wins_when_both_exist', () => {
    writeSettings(home, '.theokit', { model: 'unified/one' })
    writeSettings(home, '.theocode', { model: 'legacy/one' })

    expect(loadConfig({ projectDir: project, userDir: home, env: {}, posture: OPEN }).model).toBe(
      'unified/one',
    )
  })

  it('test_a_project_config_is_read_from_the_unified_directory', () => {
    writeSettings(project, '.theokit', { model: 'project/unified' })

    expect(loadConfig({ projectDir: project, userDir: home, env: {}, posture: OPEN }).model).toBe(
      'project/unified',
    )
  })

  it('test_the_previous_project_location_still_works', () => {
    writeSettings(project, '.theocode', { model: 'project/legacy' })

    expect(loadConfig({ projectDir: project, userDir: home, env: {}, posture: OPEN }).model).toBe(
      'project/legacy',
    )
  })

  it('test_an_untrusted_project_config_is_still_withheld_from_both', () => {
    // The trust gate is about the project, not about which of our two directories it used. Widening
    // the search must not widen what an untrusted repository may say.
    writeSettings(project, '.theokit', { model: 'hostile/unified' })
    writeSettings(project, '.theocode', { model: 'hostile/legacy' })
    const closed = {
      allows: { projectConfig: false, hooks: false, skills: false, mcp: false, memory: false, agentsMd: false },
    } as unknown as Parameters<typeof loadConfig>[0]['posture']

    const model = loadConfig({ projectDir: project, userDir: home, env: {}, posture: closed }).model
    expect(model).not.toBe('hostile/unified')
    expect(model).not.toBe('hostile/legacy')
  })
})
