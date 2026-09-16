/**
 * Phase 1 — `settings.json` replaces `config.toml`, and the chain that finds it.
 *
 * Every case here goes through `loadConfig`, the ONE function in this module that touches disk, so
 * what is asserted is discovery and precedence rather than a shape passed in by hand.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadConfig } from '../../src/config/config.js'
import { settingsReport } from '../../src/config/settings-load.js'
import { DEFAULT_HOME_DIR, LEGACY_HOME_DIR } from '../../src/config/home-dir.js'

let home: string
let project: string

const OPEN = {
  allows: { projectConfig: true, hooks: true, skills: true, mcp: true, memory: true, agentsMd: true },
} as unknown as Parameters<typeof loadConfig>[0]['posture']

const CLOSED = {
  allows: { projectConfig: false, hooks: false, skills: false, mcp: false, memory: false, agentsMd: false },
} as unknown as Parameters<typeof loadConfig>[0]['posture']

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-settings-home-'))
  project = mkdtempSync(join(tmpdir(), 'theocode-settings-proj-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
})

function write(dir: string, rel: string, name: string, body: unknown): void {
  mkdirSync(join(dir, rel), { recursive: true })
  writeFileSync(join(dir, rel, name), JSON.stringify(body, null, 2))
}

function load(env: Record<string, string | undefined> = {}) {
  return loadConfig({ projectDir: project, userDir: home, env: { HOME: home, ...env }, posture: OPEN })
}

describe('discovery', () => {
  it('test_the_user_settings_are_read_from_the_foreign_root', () => {
    write(home, '.claude', 'settings.json', { model: 'openai/from-user' })
    expect(load().model).toBe('openai/from-user')
  })

  it('test_the_project_settings_outrank_the_user_settings', () => {
    write(home, '.claude', 'settings.json', { model: 'openai/from-user' })
    write(project, '.claude', 'settings.json', { model: 'openai/from-project' })
    expect(load().model).toBe('openai/from-project')
  })

  it('test_settings_local_outranks_settings', () => {
    // Claude Code's own precedence: `.claude/settings.local.json` is the personal, gitignored file
    // and it wins over the committed one.
    write(project, '.claude', 'settings.json', { model: 'openai/committed' })
    write(project, '.claude', 'settings.local.json', { model: 'openai/personal' })
    expect(load().model).toBe('openai/personal')
  })

  it('test_our_own_root_wins_over_the_foreign_one_within_a_layer', () => {
    // Same argument `config.toml` discovery already records: an operator who moves their file must
    // see the move take effect, so the product's own root is the one that wins.
    write(home, '.claude', 'settings.json', { model: 'openai/foreign' })
    write(home, DEFAULT_HOME_DIR, 'settings.json', { model: 'openai/ours' })
    expect(load().model).toBe('openai/ours')
  })

  it('test_project_settings_are_not_read_when_the_directory_is_untrusted', () => {
    // Negative control on the trust gate: without it this test passes against a loader that ignores
    // the posture entirely.
    write(home, '.claude', 'settings.json', { model: 'openai/from-user' })
    write(project, '.claude', 'settings.json', { model: 'openai/from-project' })
    const cfg = loadConfig({ projectDir: project, userDir: home, env: { HOME: home }, posture: CLOSED })
    expect(cfg.model).toBe('openai/from-user')
  })
})

describe('a real Claude Code file', () => {
  it('test_a_file_full_of_their_keys_still_starts', () => {
    write(project, '.claude', 'settings.json', {
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      _comment_: 'written by a human',
      alwaysThinkingEnabled: true,
      statusLine: { type: 'command', command: 'x' },
      permissions: { allow: ['Bash'] },
      model: 'openai/real',
    })
    expect(load().model).toBe('openai/real')
  })

  it('test_their_nested_hooks_arrive_in_our_shape_with_the_unit_converted', () => {
    // `.theocode/`, not `.theokit/`: the SDK's filebase is `.theokit/`, so a `hooks` key there is
    // read and run by the SDK too — refused since #151. This is the root only this product reads.
    write(project, LEGACY_HOME_DIR, 'settings.json', {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh', timeout: 10 }] }],
        PreCompact: [{ matcher: '*', hooks: [{ type: 'command', command: 'never.sh' }] }],
      },
    })
    expect(load().hooks).toEqual([
      { event: 'PreToolUse', command: 'guard.sh', matcher: 'Bash', timeout_ms: 10_000 },
    ])
  })

  it('test_an_unknown_key_in_OUR_root_is_refused_by_name', () => {
    // Tolerating their keys must not become tolerating everything. `sandboxMode` is a camelCase
    // typo of `sandbox_mode`, and under this product's own root, silently ignoring it is exactly
    // the failure strictness exists to prevent.
    write(project, DEFAULT_HOME_DIR, 'settings.json', { sandboxMode: 'read-only' })
    expect(() => load()).toThrow(/sandboxMode/)
  })

  it('test_the_same_key_in_THEIR_root_starts_instead_of_refusing', () => {
    // The other side of the provenance rule, and the reason it exists: their vocabulary grows on
    // their release cadence. A real `~/.claude/settings.json` on this machine carried five keys an
    // explicit inventory did not know, and refusing on them stopped the product from starting.
    write(project, '.claude', 'settings.json', { sandboxMode: 'read-only', model: 'openai/x' })
    expect(load().model).toBe('openai/x')
  })

  it('test_malformed_json_names_the_file', () => {
    mkdirSync(join(project, '.claude'), { recursive: true })
    writeFileSync(join(project, '.claude', 'settings.json'), '{ not json')
    expect(() => load()).toThrow(/settings\.json/)
  })
})

describe('the file it replaces', () => {
  it('test_a_leftover_config_toml_with_no_settings_json_refuses_to_start', () => {
    // Silence here would be the worst outcome: the operator's settings simply stop applying, with
    // no error, and the product looks like it lost their configuration.
    mkdirSync(join(project, DEFAULT_HOME_DIR), { recursive: true })
    writeFileSync(join(project, DEFAULT_HOME_DIR, 'config.toml'), 'model = "openai/old"\n')
    expect(() => load()).toThrow(/settings\.json/)
  })

  it('test_the_refusal_names_the_conversion_command', () => {
    mkdirSync(join(project, DEFAULT_HOME_DIR), { recursive: true })
    writeFileSync(join(project, DEFAULT_HOME_DIR, 'config.toml'), 'model = "openai/old"\n')
    expect(() => load()).toThrow(/migrate-config/)
  })

  it('test_a_config_toml_beside_a_settings_json_does_not_block_the_start', () => {
    mkdirSync(join(project, DEFAULT_HOME_DIR), { recursive: true })
    writeFileSync(join(project, DEFAULT_HOME_DIR, 'config.toml'), 'model = "openai/old"\n')
    write(project, DEFAULT_HOME_DIR, 'settings.json', { model: 'openai/new' })
    expect(load().model).toBe('openai/new')
  })
})

describe('what the file carried and this product did not act on', () => {
  it('test_an_ignored_key_is_reported_by_name', () => {
    // The contract the whole tolerance rests on. Dropping a key without being able to name it later
    // teaches an operator that a setting is read when it is not — and the cost lands on a behaviour
    // they configured and never got.
    write(project, '.claude', 'settings.json', {
      alwaysThinkingEnabled: true,
      voiceEnabled: true,
      model: 'openai/x',
    })
    const [report] = settingsReport({ projectDir: project, userDir: home, env: { HOME: home } })

    expect(report?.ignored).toContain('alwaysThinkingEnabled')
    expect(report?.unrecognised).toContain('voiceEnabled')
    expect(report?.ignored).not.toContain('model')
  })

  it('test_an_untranslatable_hook_is_reported_with_its_reason', () => {
    write(project, LEGACY_HOME_DIR, 'settings.json', {
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'inject.sh' }] }] },
    })
    const [report] = settingsReport({ projectDir: project, userDir: home, env: { HOME: home } })

    expect(report?.droppedHooks.join(' ')).toContain('UserPromptSubmit')
  })

  it('test_a_file_with_nothing_to_report_reports_nothing', () => {
    // Negative control: a reporter that listed every key would satisfy the two arms above.
    write(project, DEFAULT_HOME_DIR, 'settings.json', { model: 'openai/x' })
    const [report] = settingsReport({ projectDir: project, userDir: home, env: { HOME: home } })

    expect(report?.ignored).toEqual([])
    expect(report?.unrecognised).toEqual([])
  })

  it('test_a_malformed_settings_json_ends_that_scope_without_a_report_or_a_throw', () => {
    // The loader already refuses malformed JSON with the file named; the DIAGNOSTIC must survive
    // the state it exists to describe. Malformed-in-scope means: no report for that scope, no
    // fall-through to a lower-ranked candidate (the loader would not have fallen through either),
    // and the other scopes still report.
    mkdirSync(join(project, DEFAULT_HOME_DIR), { recursive: true })
    writeFileSync(join(project, DEFAULT_HOME_DIR, 'settings.json'), '{ not json')
    write(project, '.claude', 'settings.json', { alwaysThinkingEnabled: true })
    write(home, DEFAULT_HOME_DIR, 'settings.json', { model: 'openai/x' })

    const reports = settingsReport({ projectDir: project, userDir: home, env: { HOME: home } })

    expect(reports.map((r) => r.path)).toEqual([join(home, DEFAULT_HOME_DIR, 'settings.json')])
  })

  it('test_it_describes_the_file_the_loader_actually_read', () => {
    // Ours wins within a layer, so the report must be about ours — a diagnostic describing a file
    // the loader skipped is worse than no diagnostic.
    write(project, '.claude', 'settings.json', { alwaysThinkingEnabled: true })
    write(project, DEFAULT_HOME_DIR, 'settings.json', { model: 'openai/x' })
    const [report] = settingsReport({ projectDir: project, userDir: home, env: { HOME: home } })

    expect(report?.path).toBe(join(project, DEFAULT_HOME_DIR, 'settings.json'))
  })
})

describe('hooks under the foreign root are left to the loader that already runs them', () => {
  it('test_they_do_not_reach_this_products_hook_list', () => {
    // Without this, every hook in a real `.claude/settings.json` would fire twice: once through the
    // framework's compatibility loader, which already executes them (B-153), and once through this
    // one. A hook is arbitrary shell, so "twice" is not a cosmetic defect.
    write(project, '.claude', 'settings.json', {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'check.sh' }] }] },
    })
    expect(load().hooks).toEqual([])
  })

  it('test_the_reason_is_reported_rather_than_left_silent', () => {
    write(project, '.claude', 'settings.json', {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'check.sh' }] }] },
    })
    const [report] = settingsReport({ projectDir: project, userDir: home, env: { HOME: home } })

    // Was `toContain('twice')`, from the message that said running them here would fire each hook
    // twice. They fire zero times: `hooks` is withheld from the foreign root, so the SDK never reads
    // that file for them. What must still be REPORTED is the reason, which is what this asserts.
    expect(report?.droppedHooks.join(' ')).toContain('nothing runs')
  })

  it('test_the_same_hooks_under_OUR_root_are_translated', () => {
    // Negative control on the provenance rule: a loader that simply dropped every nested hook block
    // would pass both arms above. `.theocode/` because `.theokit/` is refused since #151.
    write(project, LEGACY_HOME_DIR, 'settings.json', {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'check.sh' }] }] },
    })
    expect(load().hooks).toEqual([{ event: 'Stop', command: 'check.sh' }])
  })
})

describe('the refusal is per scope', () => {
  it('test_a_user_settings_json_does_not_silence_a_stranded_project_config_toml', () => {
    // The gap the first version of the refusal had: it asked "is there a settings.json anywhere?",
    // so a user-level file silenced a stranded project-level `config.toml` — and the project's whole
    // configuration dropped with no error, which is the exact silence the refusal exists to break.
    write(home, DEFAULT_HOME_DIR, 'settings.json', { model: 'openai/user' })
    mkdirSync(join(project, DEFAULT_HOME_DIR), { recursive: true })
    writeFileSync(join(project, DEFAULT_HOME_DIR, 'config.toml'), 'model = "openai/old"\n')

    expect(() => load()).toThrow(/config\.toml/)
  })

  it('test_an_untrusted_project_is_not_refused_over_a_file_it_would_not_read_anyway', () => {
    // Negative control on the scoping: the project scope is only checked when the project scope is
    // read at all. Refusing here would block every run in an untrusted directory over a file whose
    // contents the product has already decided to ignore.
    write(home, DEFAULT_HOME_DIR, 'settings.json', { model: 'openai/user' })
    mkdirSync(join(project, DEFAULT_HOME_DIR), { recursive: true })
    writeFileSync(join(project, DEFAULT_HOME_DIR, 'config.toml'), 'model = "openai/old"\n')

    const cfg = loadConfig({
      projectDir: project,
      userDir: home,
      env: { HOME: home },
      posture: CLOSED,
    })
    expect(cfg.model).toBe('openai/user')
  })
})
