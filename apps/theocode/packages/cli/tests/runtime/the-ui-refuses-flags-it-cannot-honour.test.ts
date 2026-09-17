import { describe, expect, it } from 'vitest'

import { parseExecArgs } from '../../src/runtime/args.js'

/**
 * A confinement flag the UI silently drops is worse than one it refuses.
 *
 * `security-floor.ts` (B-006) makes `cli` the operator's override — the layer that wins in BOTH
 * directions, because the threat model is a repository or an inherited environment, never the
 * person at the keyboard. `ExecUi` carries nothing, so on the UI path that override reaches
 * nobody.
 *
 * Measured 2026-09-17 against a trusted workspace whose file said `danger-full-access`: the
 * operator typed `--sandbox read-only`, asking for MORE confinement, and the session came up
 * `workspace-write` with no message. They would believe the control was in force — the exact
 * failure this product's `doctor` exists to name one surface over.
 *
 * Refusing is the parsimonious fix: it invents no option-passing nobody asked for, and it cannot
 * fail toward reassurance.
 */
describe('parseExecArgs — the UI refuses what it cannot honour', () => {
  it('test_a_confinement_flag_with_no_prompt_is_refused_by_name', () => {
    const args = parseExecArgs(['--sandbox', 'read-only'], true)

    expect(args.mode).toBe('error')
    // By NAME: "unsupported option" would leave the operator guessing which of their flags died.
    if (args.mode === 'error') expect(args.message).toContain('--sandbox')
  })

  it('test_every_flag_the_ui_drops_is_refused', () => {
    for (const argv of [
      ['--sandbox', 'read-only'],
      ['--approval', 'never'],
      ['--model', 'some/model'],
      ['--effort', 'high'],
      ['--config', 'sandbox_mode=read-only'],
      ['--json'],
    ]) {
      const args = parseExecArgs(argv, true)
      expect(args.mode, argv.join(' ')).toBe('error')
    }
  })

  it('test_it_names_only_flags_the_operator_typed', () => {
    // `--sandbox` is SUGAR: it expands into a `sandbox_mode=` override. A first version derived the
    // message from that expansion and told an operator who typed `--sandbox` that `--config` was
    // the problem — sending them to look for a flag they never used.
    const args = parseExecArgs(['--sandbox', 'read-only'], true)

    expect(args.mode).toBe('error')
    if (args.mode === 'error') expect(args.message).not.toContain('--config')
  })

  it('test_the_bare_invocation_still_opens_the_ui', () => {
    // The refusal must not cost the capability it guards.
    expect(parseExecArgs([], true)).toEqual({ mode: 'ui' })
  })

  it('test_a_flag_with_a_prompt_is_untouched', () => {
    // One-shot carries `overrides`, so the operator's flag IS honoured there. Refusing it would
    // break the path that works.
    const args = parseExecArgs(['--sandbox', 'read-only', 'explain this'], true)

    expect(args.mode).toBe('run')
  })
})
