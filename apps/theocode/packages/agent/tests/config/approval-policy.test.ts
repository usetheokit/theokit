import type { SandboxPosture } from '@theokit/agents/sandbox'
import { describe, expect, it } from 'vitest'

import { headlessApprovalPosture, resolveHeadlessApproval } from '../../src/config/approval-policy.js'

/**
 * M86 — the migration to `@theokit/agents@8.0.0`, at the one place it is a breaking change.
 *
 * ## What the framework started requiring, and why
 *
 * `ApprovalPosture`'s `auto-approve` arm now carries `confinedBy: SandboxPosture`. Before, the shape
 * was `{ kind, reason }` — a claim that nothing had to back. "Approved automatically" and "confined
 * by a kernel sandbox" were two independent assertions, and a caller could make the first while the
 * second was false.
 *
 * This file had the evidence in hand the whole time: `headlessApprovalPosture` already TAKES the
 * `SandboxPosture` and already refuses when it is not enforced — and then dropped it on the way out.
 * The migration is not new plumbing; it is attaching the proof to the claim that depends on it.
 *
 * So the assertion below is not "does the field exist". It is: the posture that ALLOWED the
 * auto-approve is the posture reported as confining it. A `confinedBy` filled with a different or
 * synthesised value would satisfy a type check and defeat the point.
 */

// The real vocabulary, not an invented one: `SandboxMode` is `read-only | workspace-write |
// danger-full-access`. A fixture with a plausible-looking `'bwrap'` / `'none'` type-checks nowhere
// and would have made these tests assert against a shape production cannot produce.
const enforced: SandboxPosture = {
  mode: 'workspace-write',
  enforced: true,
  detail: 'bubblewrap available',
}
const unenforced: SandboxPosture = {
  mode: 'danger-full-access',
  enforced: false,
  detail: 'no kernel sandbox available',
}

describe('headlessApprovalPosture attaches the evidence to the claim', () => {
  it('test_an_auto_approve_reports_the_SAME_posture_that_permitted_it', () => {
    const posture = headlessApprovalPosture('never', enforced)

    expect(posture.kind).toBe('auto-approve')
    // Identity, not shape: the sandbox that justified approving is the one reported.
    expect(posture.kind === 'auto-approve' && posture.confinedBy).toEqual(enforced)
  })

  it('test_an_unenforced_sandbox_still_REFUSES_rather_than_reporting_confinement', () => {
    // The counter-proof. Without it, a version that always attached `confinedBy` and always approved
    // would pass the test above while destroying the guarantee the field exists to express.
    const posture = headlessApprovalPosture('never', unenforced)

    // Narrowed rather than asserted: `ApprovalPosture`'s `interactive` arm carries no `reason`, so
    // reading the field off the union is a type error — and the narrowing doubles as the check that
    // this is the rejecting arm at all.
    expect(posture.kind).toBe('auto-reject')
    expect(posture.kind === 'auto-reject' && posture.reason).toMatch(/NO enforced sandbox/)
  })

  it('test_a_policy_that_keeps_a_human_in_the_loop_is_not_auto_approved_headlessly', () => {
    // An enforced sandbox does not make every policy headless-safe — confinement and consent are
    // different questions, and only one of them a sandbox can answer.
    expect(headlessApprovalPosture('untrusted', enforced).kind).toBe('auto-reject')
  })
})

describe('resolveHeadlessApproval — the decision the posture is built from', () => {
  it('test_full_auto_under_an_enforced_sandbox_is_approved', () => {
    expect(resolveHeadlessApproval('never', enforced).approved).toBe(true)
  })

  it('test_full_auto_without_enforcement_is_refused_and_says_why', () => {
    const decision = resolveHeadlessApproval('never', unenforced)
    expect(decision.approved).toBe(false)
    // The detail is quoted so an operator reads WHICH confinement was missing, not just that one was.
    expect(decision.reason).toContain('no kernel sandbox available')
  })
})
