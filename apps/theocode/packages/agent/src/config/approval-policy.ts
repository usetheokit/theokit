import type { ApprovalPosture } from '@theokit/agents'
import type { SandboxPosture } from '@theokit/agents/sandbox'

import type { ApprovalPolicy } from './config.js'
import { approvalModeFor } from './sandbox-policy.js'

export interface ApprovalDecision {
  approved: boolean
  reason: string
}

/**
 * What would make the sandbox enforceable, chosen from the reason it is not.
 *
 * #939 — the hint was always "Install bwrap". On stock Ubuntu 24.04 bwrap IS installed and fails
 * anyway: AppArmor refuses unprivileged user namespaces by default, which bwrap needs, and the probe
 * reports exactly that. Telling that operator to install bwrap sends them after something they have.
 */
function remediationFor(detail: string): string {
  if (/user namespaces/i.test(detail)) {
    return (
      'bwrap needs unprivileged user namespaces, and this kernel refuses them. On Ubuntu 23.10 and ' +
      'later that is AppArmor (`sysctl kernel.apparmor_restrict_unprivileged_userns` prints 1): ' +
      'allow them for bwrap with an AppArmor profile, or run where user namespaces are available.'
    )
  }
  return 'Install bwrap, or set an explicit sandbox_mode with kernel enforcement.'
}

export function resolveHeadlessApproval(
  policy: ApprovalPolicy,
  // B-021 — REQUIRED. Omitting it used to return `approved: true` for full-auto, skipping the
  // enforced-sandbox refusal that is this function's stated purpose.
  posture: { enforced: boolean; detail: string },
): ApprovalDecision {
  const mode = approvalModeFor(policy)
  if (mode === 'full-auto') {
    if (!posture.enforced) {
      return {
        approved: false,
        reason:
          `approval_policy="${policy}" would run without asking, but there is NO enforced sandbox ` +
          `(${posture.detail}) — refusing instead of claiming a confinement that does not exist. ` +
          remediationFor(posture.detail),
      }
    }
    return {
      approved: true,
      reason:
        `approval_policy="${policy}" runs without asking; confinement is the kernel sandbox` +
        (posture !== undefined ? ` (${posture.detail})` : ''),
    }
  }
  return {
    approved: false,
    reason:
      `approval_policy="${policy}" keeps a human in the loop, and this surface has no human — ` +
      'set approval_policy="never" to run headless, or use the interactive surface',
  }
}

export function headlessApprovalPosture(
  policy: ApprovalPolicy,
  sandbox: SandboxPosture,
): ApprovalPosture {
  const decision = resolveHeadlessApproval(policy, sandbox)
  return decision.approved
    ? // M86 / `@theokit/agents@8.0.0` — `auto-approve` now carries the confinement it claims.
      // The posture was already in hand, and already the thing that permitted this branch; passing
      // the SAME value (never a synthesised one) is what keeps "approved automatically" and
      // "confined by a kernel sandbox" from drifting into two independent assertions.
      { kind: 'auto-approve', confinedBy: sandbox, reason: decision.reason }
    : { kind: 'auto-reject', reason: decision.reason }
}
