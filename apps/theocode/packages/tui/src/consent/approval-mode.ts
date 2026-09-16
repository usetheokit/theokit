import {
  APPROVAL_MODES,
  shouldAutoApprove as decide,
  type ApprovalMode,
} from '@theokit/agents/bridge'

export type { ApprovalMode }

/**
 * Which tools THIS product lets run without asking, in `auto-edit`.
 *
 * Passed explicitly on every call, and that is the point rather than ceremony. `@theokit/agents`
 * also exports `WRITE_SCOPED_TOOLS` — `apply_patch`, `edit_file`, `write_file` — but that is a
 * CATALOG of which SDK tools bound their own writes, not a policy about who may skip the human.
 * Adopting it as a default here would silently widen an approval gate: this surface registers
 * `edit_file` (`agent/chat.ts:272-273`) and deliberately does not auto-approve it, so inheriting the
 * framework's list would un-gate a live, model-callable write tool as a side effect of deleting
 * duplicated code. The framework's `auto-edit` approves nothing when no set is given, precisely so
 * that widening cannot happen by omission.
 *
 * `apply_patch` is here because it is bounded by the tool's own write scope rather than by the
 * kernel, and the user opted into edits specifically.
 */
const EDIT_TOOLS: ReadonlySet<string> = new Set(['apply_patch'])

/**
 * Whether a gated tool may run without asking.
 *
 * The RULE is `@theokit/agents`'; only the set above is ours. This replaces a local copy of the same
 * switch, and the framework's version carries the reasoning that copy had to restate: `full-auto`
 * means "run commands without asking", which is only defensible when something else is confining
 * them, so an absent or unenforced sandbox posture auto-approves nothing (B-006) — absence of
 * evidence is not evidence of confinement.
 */
export function shouldAutoApprove(
  mode: ApprovalMode,
  toolName: string,
  posture?: { enforced: boolean; detail: string },
): boolean {
  return decide(mode, toolName, posture, { writeScopedTools: EDIT_TOOLS })
}

export function parseApprovalMode(input: string): ApprovalMode | undefined {
  return (APPROVAL_MODES as readonly string[]).includes(input) ? (input as ApprovalMode) : undefined
}

export function nextApprovalMode(mode: ApprovalMode): ApprovalMode {
  const i = APPROVAL_MODES.indexOf(mode)
  return APPROVAL_MODES[(i + 1) % APPROVAL_MODES.length] as ApprovalMode
}
