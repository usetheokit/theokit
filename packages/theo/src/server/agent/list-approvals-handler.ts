/**
 * M14 (theokit-ai-first) — GET /api/agents/<name>/approvals: list pending HITL approvals.
 *
 * Serves the approvals the CALLER owns, plus the ownerless ones, as JSON. Web Standards Response (G8).
 *
 * ## Why this is scoped, and what it closes
 *
 * The registry is process-wide by contract (ADR 0038): `list()` returns every pending approval, and
 * the `<name>` segment is accepted for a future per-agent store. That was the whole answer here, so
 * one admitted tenant of one agent received every pending approval in the process — other tenants',
 * other agents' — each with the `approvalId` the settle route needs.
 *
 * The draft advisory `GHSA-g94h-459g-rjhj` describes two steps: list without authentication, then
 * settle with an id from the listing. Both halves were closed around this file and neither in it —
 * `admitAux` refuses a caller the agent's policy does not admit (usetheokit/theokit#365), and
 * `approve-agent.ts` refuses a settle by a caller who is not the owner (B-016). The door was gated
 * and the window left open: an ADMITTED caller still read everyone's ids.
 *
 * ## An ownerless approval stays visible, deliberately
 *
 * The registry records an owner only for agents that DECLARE a policy — `admitAgentRequest` resolves
 * no subject for `'public'` or for an undeclared agent, so there is nothing to attribute. The settle
 * route already treats an absent owner as "nothing to compare a caller against" and refuses nobody
 * on it. Listing follows the same rule rather than inventing a second one, because hiding those
 * would blank a public agent's own approvals UI while protecting nobody.
 *
 * The filter asks `ownerOf` per approval rather than reading an owner off the listing, because
 * `owner` is held BESIDE `info` precisely so `list()` cannot leak it (B-016). Scoping the response
 * must not put the identity back into it.
 */
import type { ApprovalRegistry } from './approval-registry.js'

const LIST_PATH = /^\/api\/agents\/([^/]+)\/approvals$/

/** Return the agent name when `urlPath` is the approvals-listing path, else `null`. */
export function isListApprovalsPath(urlPath: string): string | null {
  const match = LIST_PATH.exec(urlPath)
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * Serve the pending approvals this caller may see as `{ approvals: [...] }` JSON.
 *
 * `subject` is the admitted caller's id, or `undefined` when the agent declares no policy and none
 * was resolved. An approval is included when it has no owner, or when its owner is this subject.
 */
export function handleListApprovals(
  registry: ApprovalRegistry,
  subject: string | undefined,
): Response {
  const visible = registry.list().filter((approval) => {
    const owner = registry.ownerOf(approval.approvalId)
    return owner === undefined || owner === subject
  })
  return new Response(JSON.stringify({ approvals: visible }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
