/**
 * M4 (theokit-ai-first) — the HITL approve endpoint: `POST /api/agents/<name>/approve/<approvalId>`.
 *
 * The counterpart to `mountAgent`'s HITL pause. While a gated tool holds the SDK run paused (the
 * awaited `pre_tool_call` hook), the client POSTs here with `{ approved }`; this resolves the
 * pending approval in the shared registry, which un-pauses the run (allow) or vetoes the tool (deny).
 *
 * Web-Standard `Request` → `Response`, one wiring point shared by dev (vite middleware) and prod
 * (built server) so the two never drift (EC-4 parity with `mountAgent`). The registry is INJECTED —
 * dev/prod pass the process singleton (`getApprovalRegistry`), tests pass a fresh instance.
 */
import type { RoutePolicy } from '../../core/contracts/route-policy.js'
import { validateCsrfRequest, type CsrfMode } from '../security/csrf.js'

import { admitAgentRequest, agentAccessDenied, type AgentSubjectResolver } from './agent-access.js'
import type { ApprovalDecision, ApprovalRegistry } from './approval-registry.js'

/** The path segment separating the agent name from the approval id. */
const APPROVE_SEGMENT = '/approve/'

const APPROVE_PATH = /^\/api\/agents\/([^/]+)\/approve\/([^/]+)$/

/**
 * The agent named by a `/api/agents/<name>/approve/<id>` path, or `null`.
 *
 * The route's own gate is the agent's declared policy, and reading the policy needs the agent —
 * which this path carries and nothing previously read (usetheokit/theokit#365).
 */
export function parseApprovalAgentName(urlPath: string): string | null {
  const match = APPROVE_PATH.exec(urlPath)
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * Extract the `<approvalId>` from a `/api/agents/<name>/approve/<approvalId>` path.
 * Returns `null` when the path has no `/approve/` segment or an empty / nested id.
 */
export function parseApprovalId(urlPath: string): string | null {
  const at = urlPath.indexOf(APPROVE_SEGMENT)
  if (at === -1) return null
  const id = urlPath.slice(at + APPROVE_SEGMENT.length)
  return id.length > 0 && !id.includes('/') ? id : null
}

/** True when `urlPath` targets a HITL approve endpoint (used by dev/prod routing to branch early). */
export function isApprovalPath(urlPath: string): boolean {
  return urlPath.includes(APPROVE_SEGMENT)
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * M20 — cap on the serialized custom payload (16 KiB). A payload is a small structured note
 * (edited args, a reviewer comment), not a data channel — an oversized one is rejected fail-fast
 * rather than silently truncated (Rule 8).
 */
const MAX_PAYLOAD_BYTES = 16 * 1024

/**
 * Extract an {@link ApprovalDecision} from an untrusted body; `null` when the shape is wrong.
 *
 * M20 — accepts an optional `reason` (string) and `payload` (object, capped at
 * {@link MAX_PAYLOAD_BYTES}). Backward-compatible: `{ approved }` and `{ approved, reason }` parse
 * unchanged. A non-object or oversized `payload` is rejected (returns `null` → the route 400s).
 *
 * @public
 */
export function parseApprovalBody(body: unknown): ApprovalDecision | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if (typeof b.approved !== 'boolean') return null
  const decision: ApprovalDecision = { approved: b.approved }
  if (b.reason !== undefined) {
    if (typeof b.reason !== 'string') return null
    decision.reason = b.reason
  }
  if (b.payload !== undefined) {
    if (typeof b.payload !== 'object' || b.payload === null || Array.isArray(b.payload)) return null
    if (JSON.stringify(b.payload).length > MAX_PAYLOAD_BYTES) return null
    decision.payload = b.payload
  }
  return decision
}

/**
 * The gates it applies (usetheokit/theokit#365):
 *
 * CSRF, which refuses a cross-origin POST and identifies nobody — and then the agent's declared
 * `policy`, which is what makes "who is asking" a question this endpoint can answer at all.
 * Reproduced before the policy existed: a process holding no cookie and no credential read a
 * pending id off the listing, POSTed here, and the gated tool ran.
 *
 * Ownership, which this endpoint could NOT decide until B-016 and now can, within a stated scope.
 * `mountAgent` records the run's subject on each approval it registers, for agents that DECLARE a
 * policy, and this route refuses a caller whose identity does not match. Before it, an
 * authenticated tenant could settle another tenant's approval on an agent both were admitted to —
 * the policy was the only thing between them, and the policy cannot see whose approval it is.
 *
 * Two limits, stated rather than implied. An agent that declares `'public'` records no owner, since
 * attributing approvals there would start refusing callers the declaration admits. And a thread
 * continuation runs headless, with no request whose identity could be resolved, so its approvals
 * record nobody. In both cases the endpoint behaves exactly as it did — `params.approvalId` is
 * still passed so an application holding its own owner map can answer more than the framework does.
 *
 * Returns:
 *   403 CSRF_FAILED  — strict CSRF check failed
 *   403 FORBIDDEN    — the agent's policy refused this caller
 *   400 BAD_REQUEST  — no `/approve/<id>` in the path, or body lacks a boolean `approved`
 *   404 NOT_PENDING  — the id is unknown or already settled (idempotent double-submit)
 *   200 { resolved:true } — the approval was settled by this call
 */
/**
 * Refuse a caller who does not own this approval, where the ledger knows the owner (B-016).
 *
 * The agent's policy answers "may this subject touch this agent's approvals". It cannot answer "is
 * this approval theirs", because it is never told — which is why an authenticated tenant could
 * settle another tenant's approval on an agent both were admitted to. `mountAgent` now records the
 * run's subject on each approval it registers, for agents that DECLARE a policy, and this reads it.
 *
 * `undefined` from `ownerOf` covers three cases the endpoint treats identically — never registered,
 * already settled, and registered with no owner — and in all three there is nothing to compare a
 * caller against, so the endpoint behaves exactly as it did. The check only ever narrows.
 */
async function refuseIfNotOwner(
  registry: ApprovalRegistry,
  approvalId: string,
  resolveSubject: AgentSubjectResolver | undefined,
  params: Parameters<typeof agentAccessDenied>[1],
): Promise<Response | undefined> {
  const owner = registry.ownerOf(approvalId)
  if (owner === undefined) return undefined

  const subject = resolveSubject === undefined ? null : await resolveSubject()
  if (subject?.id === owner) return undefined

  // An unidentifiable caller is refused, deliberately. An approval that HAS an owner must not be
  // settleable by whoever reaches the endpoint without an identity — admitting there would make the
  // guarantee depend on how the host wired its resolver rather than on who is asking.
  return agentAccessDenied(
    { allowed: false, reason: 'the approval belongs to another subject' },
    params,
  )
}

export async function handleAgentApproval(
  request: Request,
  urlPath: string,
  registry: ApprovalRegistry,
  csrfMode: CsrfMode = 'strict',
  access: { policy?: RoutePolicy; resolveSubject?: AgentSubjectResolver } = {},
): Promise<Response> {
  if (csrfMode !== 'off') {
    const csrf = validateCsrfRequest(request)
    if (!csrf.valid && csrfMode === 'strict') {
      return jsonError(403, 'CSRF_FAILED', `CSRF check failed: ${csrf.reason}`)
    }
  }

  const approvalId = parseApprovalId(urlPath)
  if (approvalId === null) {
    return jsonError(400, 'BAD_REQUEST', 'Approval path must be /api/agents/<name>/approve/<id>.')
  }

  const params = {
    agent: parseApprovalAgentName(urlPath) ?? 'unknown',
    endpoint: 'approve' as const,
    approvalId,
  }
  const decision = await admitAgentRequest(access.policy, access.resolveSubject, params)
  if (!decision.allowed) return agentAccessDenied(decision, params)

  const notOwner = await refuseIfNotOwner(registry, approvalId, access.resolveSubject, params)
  if (notOwner !== undefined) return notOwner

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    /* invalid/empty JSON → handled below as a 400 */
  }
  const parsed = parseApprovalBody(body)
  if (parsed === null) {
    return jsonError(400, 'BAD_REQUEST', 'Request body must contain a boolean `approved`.')
  }

  const resolved = registry.resolve(approvalId, parsed)
  if (!resolved) {
    return jsonError(404, 'NOT_PENDING', `No pending approval for id '${approvalId}'.`)
  }
  return new Response(JSON.stringify({ resolved: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
