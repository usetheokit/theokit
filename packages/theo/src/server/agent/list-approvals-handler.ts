/**
 * M14 (theokit-ai-first) — GET /api/agents/<name>/approvals: list pending HITL approvals.
 *
 * Serves `ApprovalRegistry.list()` as JSON. Single-process contract (ADR 0038) — the list is
 * process-wide; the `<name>` segment is accepted for a future per-agent/durable store but the
 * in-process registry lists all pending approvals. Web Standards Response (G8).
 */
import type { ApprovalRegistry } from './approval-registry.js'

const LIST_PATH = /^\/api\/agents\/([^/]+)\/approvals$/

/** Return the agent name when `urlPath` is the approvals-listing path, else `null`. */
export function isListApprovalsPath(urlPath: string): string | null {
  const match = LIST_PATH.exec(urlPath)
  return match ? decodeURIComponent(match[1]) : null
}

/** Serve the currently-pending approvals as `{ approvals: [...] }` JSON. */
export function handleListApprovals(registry: ApprovalRegistry): Response {
  return new Response(JSON.stringify({ approvals: registry.list() }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
