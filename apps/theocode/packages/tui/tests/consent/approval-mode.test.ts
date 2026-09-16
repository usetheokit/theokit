/**
 * B-006 — the two surfaces must agree on when it is safe to stop asking.
 *
 * The headless surface refuses to auto-approve without an enforced sandbox, and says why in its own
 * words: *"refusing instead of claiming a confinement that does not exist"* (`approval-policy.ts`).
 *
 * The interactive surface auto-approved every tool under `full-auto` with no posture check at all —
 * while the very same screen renders `sandbox:<mode> ⚠ tool-gating`, telling the user confinement is
 * absent. One surface reasoned it through; the other never asked the question.
 *
 * Trusting a directory is not the same as consenting to run unconfined: the trust gate answers
 * "may this repo configure the agent?", and this one answers "may commands run without me looking?".
 */
import { describe, expect, it } from 'vitest'

import { shouldAutoApprove } from '../../src/consent/approval-mode.js'

const ENFORCED = { enforced: true, detail: 'bwrap' }
const NOT_ENFORCED = { enforced: false, detail: 'no kernel sandbox available' }

describe('B-006 — full-auto requires an enforced sandbox', () => {
  it('test_full_auto_auto_approves_when_the_sandbox_is_enforced', () => {
    // Anti-vacuity floor: refusing everything would satisfy the assertion below.
    expect(shouldAutoApprove('full-auto', 'shell', ENFORCED)).toBe(true)
  })

  it('test_full_auto_does_NOT_auto_approve_without_an_enforced_sandbox', () => {
    expect(
      shouldAutoApprove('full-auto', 'shell', NOT_ENFORCED),
      'the interactive surface auto-approved a command with no confinement, while the same screen ' +
        'was telling the user there is none. The headless surface refuses this exact combination.',
    ).toBe(false)
  })

  it('test_an_unknown_posture_is_treated_as_unconfined', () => {
    // Absence of evidence is not evidence of confinement. Defaulting the other way would make the
    // guard vanish wherever the posture has not been threaded through yet.
    expect(shouldAutoApprove('full-auto', 'shell', undefined)).toBe(false)
  })
})

describe('B-006 — the other modes are unchanged', () => {
  it('test_suggest_never_auto_approves', () => {
    expect(shouldAutoApprove('suggest', 'apply_patch', ENFORCED)).toBe(false)
  })

  it('test_auto_edit_still_covers_edits_under_an_enforced_sandbox', () => {
    expect(shouldAutoApprove('auto-edit', 'apply_patch', ENFORCED)).toBe(true)
  })

  it('test_auto_edit_does_not_auto_approve_a_shell_command', () => {
    expect(shouldAutoApprove('auto-edit', 'shell', ENFORCED)).toBe(false)
  })

  it('test_auto_edit_of_a_file_is_allowed_without_a_kernel_sandbox', () => {
    // Deliberate: `apply_patch` is confined by the tool's own write scope, not by the kernel, and
    // the user opted into edits specifically. Widening the refusal here would be a different
    // decision than the one the headless surface made, which is only about running commands blind.
    expect(shouldAutoApprove('auto-edit', 'apply_patch', NOT_ENFORCED)).toBe(true)
  })
})

/**
 * The gate this product chose, pinned against the framework's wider catalog.
 *
 * `shouldAutoApprove` is now `@theokit/agents`' rule with our set passed in. The framework also
 * exports `WRITE_SCOPED_TOOLS` — `apply_patch`, `edit_file`, `write_file` — as a catalog of which
 * SDK tools bound their own writes. Adopting it here would widen an approval gate: this surface
 * REGISTERS `edit_file` (`agent/chat.ts:272-273`) and deliberately does not auto-approve it.
 *
 * Written because the migration was mutation-tested and the suite did not catch it: swapping our
 * one-tool set for the framework's three left all seven existing tests green. A gate that can be
 * widened without a red test is a gate that will be widened.
 */
describe('the auto-edit set is this product', () => {
  const ENFORCED = { enforced: true, detail: 'seccomp' }

  it('test_edit_file_still_requires_a_human_in_auto_edit', () => {
    // The tool the framework's catalog would have un-gated. It is registered and model-callable.
    expect(shouldAutoApprove('auto-edit', 'edit_file')).toBe(false)
    expect(shouldAutoApprove('auto-edit', 'edit_file', ENFORCED)).toBe(false)
  })

  it('test_write_file_still_requires_a_human_in_auto_edit', () => {
    expect(shouldAutoApprove('auto-edit', 'write_file', ENFORCED)).toBe(false)
  })

  it('test_apply_patch_is_the_one_that_auto_approves', () => {
    // Anti-vacuity floor: without this, a policy of the empty set would satisfy both cases above.
    expect(shouldAutoApprove('auto-edit', 'apply_patch')).toBe(true)
  })
})
