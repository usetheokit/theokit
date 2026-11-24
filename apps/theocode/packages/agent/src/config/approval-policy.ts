import { approvalPostureFor, type ApprovalPosture } from '@theokit/agents'
import type { SandboxPosture } from '@theokit/agents/sandbox'

import type { ApprovalPolicy } from './config.js'

export interface ApprovalDecision {
  approved: boolean
  /**
   * #939: approved with nothing around it, because the operator chose `danger-full-access`. The
   * headless surface warns on it before the turn; a consumer that ignores it still gets the right
   * `approved`.
   */
  unconfined: boolean
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

/**
 * The posture the framework decides (`approvalPostureFor`, no `interactive`: this surface has no
 * human), with TheoCode's wording. The rule — `never` runs only when the sandbox is enforced or
 * `danger-full-access` was chosen — is the framework's, so no surface can disagree with it.
 */
function decideHeadless(
  policy: ApprovalPolicy,
  sandbox: SandboxPosture,
): { posture: ApprovalPosture; decision: ApprovalDecision } {
  const posture = approvalPostureFor(policy, sandbox)
  if (posture.kind === 'auto-approve') {
    const unconfined = !posture.confinedBy.enforced
    const reason = unconfined
      ? `approval_policy="${policy}" with sandbox_mode="danger-full-access" runs every tool ` +
        `without asking and with NO confinement: commands can read and write anything this user ` +
        `can. Use sandbox_mode="workspace-write" to keep the kernel sandbox.`
      : `approval_policy="${policy}" runs without asking; confinement is the kernel sandbox (${sandbox.detail})`
    return {
      // M86 / `@theokit/agents@8.0.0`: `auto-approve` carries the posture that permitted it.
      posture: { ...posture, reason },
      decision: { approved: true, unconfined, reason },
    }
  }
  const reason =
    policy === 'never'
      ? `approval_policy="${policy}" would run without asking, but there is NO enforced sandbox ` +
        `(${sandbox.detail}) — refusing instead of claiming a confinement that does not exist. ` +
        remediationFor(sandbox.detail)
      : `approval_policy="${policy}" keeps a human in the loop, and this surface has no human — ` +
        'set approval_policy="never" to run headless, or use the interactive surface'
  return {
    posture: { kind: 'auto-reject', reason },
    decision: { approved: false, unconfined: false, reason },
  }
}

export function resolveHeadlessApproval(
  policy: ApprovalPolicy,
  // B-021 — REQUIRED. Omitting it must not approve full-auto without the enforced-sandbox check.
  sandbox: SandboxPosture,
): ApprovalDecision {
  return decideHeadless(policy, sandbox).decision
}

export function headlessApprovalPosture(
  policy: ApprovalPolicy,
  sandbox: SandboxPosture,
): ApprovalPosture {
  return decideHeadless(policy, sandbox).posture
}
