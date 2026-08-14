import type { SandboxPosture } from '@theokit/sdk/sandbox'
import { describe, expect, it } from 'vitest'

import { applyPosture, type ApprovalPosture } from '../../src/bridge/approval-posture.js'
import type { HumanInTheLoopOptions } from '../../src/types.js'

/**
 * M77 — `auto-approve` stops being a promise and starts being evidence.
 *
 * ## The defect
 *
 * `auto-approve` is the most consequential decision a coding agent makes — "run commands without
 * asking" — and its type asked for a `string`. A string is unverifiable at the seam: nothing could
 * tell "confined by bwrap, kernel-enforced" from "I'm sure it's fine". So the consumer implemented
 * the refusal ITSELF, twice (`shouldAutoApprove` in the TUI and `resolveHeadlessApproval` in the
 * headless path), with the same rule in both: an absent posture counts as unconfined.
 *
 * A security rule duplicated across two call sites is a rule that will disagree with itself. The fix
 * is not to document it — it is to make the unconfined case UNREPRESENTABLE at the type level, and
 * refuse it at runtime for the caller who casts past the type.
 */

const gated: ReadonlyMap<string, HumanInTheLoopOptions> = new Map([
  ['run_command', { question: 'run it?' } as HumanInTheLoopOptions],
])

const enforced: SandboxPosture = {
  mode: 'workspace-write',
  enforced: true,
  detail: 'bwrap: user namespaces + seccomp',
}
const unenforced: SandboxPosture = {
  mode: 'danger-full-access',
  enforced: false,
  detail: 'bwrap unavailable: no user namespaces',
}

describe('auto-approve requires evidence of confinement', () => {
  it('test_an_ENFORCED_posture_installs_the_auto_approve_plugin', () => {
    // The counter-proof first: a gate that refuses everything is not a gate, it is a removed
    // feature. Auto-approve must still work for the case it was built for.
    const extra: Record<string, unknown> = {}
    applyPosture(
      extra,
      {},
      { kind: 'auto-approve', confinedBy: enforced, reason: 'sandboxed CI runner' },
      gated,
    )
    expect(extra.plugins).toHaveLength(1)
  })

  it('test_an_UNENFORCED_posture_is_REFUSED_at_runtime', () => {
    // The rule the consumer wrote twice, now written once, here. Casting past the type is the only
    // way to reach this — and a caller who casts is exactly who this check is for.
    expect(() =>
      applyPosture(
        {},
        {},
        {
          kind: 'auto-approve',
          confinedBy: unenforced,
          reason: 'trust me',
        } as unknown as ApprovalPosture,
        gated,
      ),
    ).toThrow(/not enforced/i)
  })

  it('test_the_refusal_names_WHY_the_sandbox_is_not_enforcing', () => {
    // `detail` is the whole reason `SandboxPosture` carries one: "unconfined" sends an operator
    // hunting, "bwrap unavailable: no user namespaces" sends them to the fix.
    expect(() =>
      applyPosture(
        {},
        {},
        { kind: 'auto-approve', confinedBy: unenforced, reason: 'x' } as unknown as ApprovalPosture,
        gated,
      ),
    ).toThrow(/no user namespaces/)
  })

  it('test_the_refusal_does_NOT_fire_when_there_is_no_gated_tool', () => {
    // The posture describes what to do with a gate. An agent with no gated tool decides nothing, so
    // refusing there would break agents that declare a posture they never exercise.
    const extra: Record<string, unknown> = {}
    expect(() =>
      applyPosture(
        extra,
        {},
        { kind: 'auto-approve', confinedBy: unenforced, reason: 'x' } as unknown as ApprovalPosture,
        new Map(),
      ),
    ).not.toThrow()
    expect(extra.plugins).toBeUndefined()
  })

  it('test_the_OTHER_postures_are_untouched_by_the_new_requirement', () => {
    // `auto-reject` and `owned-by-surface` carry no confinement claim — they are not permissive.
    // Requiring evidence from them would be cargo-culting the check onto postures that do not need it.
    const extra: Record<string, unknown> = {}
    expect(() =>
      applyPosture(extra, {}, { kind: 'auto-reject', reason: 'no approver here' }, gated),
    ).not.toThrow()
    expect(extra.plugins).toHaveLength(1)
  })
})
