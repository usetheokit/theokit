/**
 * `doctor` reports what each `settings.json` carried and this product did not act on.
 *
 * `settings.json` is Claude Code's filename, so the file very often contains their settings. This
 * product tolerates them — a real one must not stop it from starting — and tolerance without a
 * report is the worse half of the trade: it teaches an operator that a setting is read when it is
 * not, and the cost lands later, on a behaviour they configured and never got.
 *
 * A warning, never a failure. Nothing is broken by a key we chose not to implement, and exiting
 * non-zero over one would report a working install as broken.
 */
import { describe, expect, it } from 'vitest'

import { collectChecks, diagnose } from '../../src/doctor/doctor.js'

const base = {
  cwd: '/tmp/p',
  trustLevel: 'trusted',
  model: 'openai/gpt-5',
  effort: 'medium',
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  credential: 'present' as const,
  wired: {
    mcp: { active: [], suppressedByTrust: false },
    skills: { active: [], suppressedByTrust: false },
    hooks: { active: [], suppressedByTrust: false },
  },
}

const REPORT = [
  {
    path: '/tmp/p/.claude/settings.json',
    ignored: ['alwaysThinkingEnabled'],
    unrecognised: ['voiceEnabled'],
    droppedHooks: ['UserPromptSubmit: this product has no such hook event'],
    unsupportedPermissions: [],
  },
]

describe('the settings row', () => {
  it('test_it_names_the_file_and_the_keys_it_did_not_act_on', () => {
    const check = collectChecks({ ...base, settingsIgnored: REPORT }).find(
      (c) => c.name === 'settings',
    )

    expect(check?.status).toBe('warn')
    expect(check?.detail).toContain('/tmp/p/.claude/settings.json')
    expect(check?.detail).toContain('alwaysThinkingEnabled')
    expect(check?.detail).toContain('voiceEnabled')
  })

  it('test_a_hook_that_could_not_be_translated_carries_its_reason', () => {
    const check = collectChecks({ ...base, settingsIgnored: REPORT }).find(
      (c) => c.name === 'settings',
    )

    expect(check?.detail).toContain('UserPromptSubmit')
  })

  it('test_it_warns_and_does_not_fail_the_install', () => {
    expect(diagnose(collectChecks({ ...base, settingsIgnored: REPORT })).failed).toBe(0)
  })

  it('test_a_file_with_nothing_to_report_produces_no_row', () => {
    // A row that permanently reads "none" is noise in a ten-row diagnostic, and noise is what makes
    // a diagnostic stop being read. Also the anti-vacuity floor for the assertions above.
    const rows = collectChecks({
      ...base,
      settingsIgnored: [
        { path: '/tmp/p/.theokit/settings.json', ignored: [], unrecognised: [], droppedHooks: [], unsupportedPermissions: [] },
      ],
    })
    expect(rows.find((c) => c.name === 'settings')).toBeUndefined()
  })

  it('test_a_caller_that_did_not_look_says_nothing', () => {
    expect(collectChecks(base).find((c) => c.name === 'settings')).toBeUndefined()
  })
})

describe('the output-style row', () => {
  it('test_a_configured_style_that_resolved_to_nothing_is_named', () => {
    // `baseInstructionsFor` falls back to the built-in instructions rather than refusing the turn —
    // a typo in an optional setting must not take the product away. This row is the other half of
    // that trade: the fallback is silent in the prompt, so it has to be loud somewhere.
    const check = collectChecks({ ...base, outputStyle: { name: 'terse', resolved: false } }).find(
      (c) => c.name === 'output-style',
    )

    expect(check?.status).toBe('warn')
    expect(check?.detail).toContain('terse')
  })

  it('test_a_style_that_resolved_is_reported_as_ok', () => {
    const check = collectChecks({ ...base, outputStyle: { name: 'terse', resolved: true } }).find(
      (c) => c.name === 'output-style',
    )

    expect(check?.status).toBe('ok')
    expect(check?.detail).toContain('terse')
  })

  it('test_no_configured_style_produces_no_row', () => {
    // Anti-vacuity, and the same noise argument as the settings row: a permanently absent setting
    // does not deserve a line in the diagnostic.
    expect(collectChecks(base).find((c) => c.name === 'output-style')).toBeUndefined()
  })
})


describe('the version row', () => {
  it('test_doctor_names_the_build', () => {
    // #128 — `doctor` reports the resolved install, and the version is the one fact every bug
    // report asks for first. Without it the answer to "which build are you on?" was to read a file.
    // A value that is NOT the current version, deliberately: a fixture equal to the real one passes
    // whether or not it flows through, and `bump_version.py` then has to ask whether a test is a
    // release site. It is not — which is exactly what it refused to guess.
    const check = collectChecks({ ...base, version: '9.9.9-fixture' }).find(
      (c) => c.name === 'version',
    )

    expect(check?.status).toBe('ok')
    expect(check?.detail).toBe('9.9.9-fixture')
  })

  it('test_a_caller_that_did_not_look_says_nothing', () => {
    // Anti-vacuity, and the same rule as every other optional input here: absence is not a claim.
    expect(collectChecks(base).find((c) => c.name === 'version')).toBeUndefined()
  })
})
