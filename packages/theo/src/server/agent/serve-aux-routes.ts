/**
 * M15/M16 follow-up — shared dispatcher for the agent AUXILIARY routes that BOTH dev (vite
 * middleware) and prod (`theokit start` handler) must serve identically. Before this, these routes
 * were wired only into the dev middleware, so a built/deployed app served none of them (agent cards,
 * MCP, pending-approvals listing all 404'd in production).
 *
 * Single source of truth (DRY): one Web-Request→Response dispatcher, two callers. It handles the
 * routes that derive purely from the agent module + shared registry:
 *  - **M15** `GET /.well-known/<name>/agent-card.json` → {@link handleAgentCard}
 *  - **M14** `GET /api/agents/<name>/approvals`        → {@link handleListApprovals}
 *  - **M16** `POST /api/agents/<name>/mcp`             → {@link handleMcpJsonRpc}
 *
 * Channels (M27) are NOT here: a channel webhook needs app-supplied `validators` + `onMessage`, so
 * the app wires `handleChannelWebhook` in its own route (it cannot be auto-derived from the module).
 * The HITL approve route stays in each caller (it carries caller-specific rate-limiting/CSRF plumbing).
 */
import type { AgentNode } from '../scan/agent-scan.js'
import { validateCsrfRequest, type CsrfMode } from '../security/csrf.js'

import { isAgentCardPath, handleAgentCard } from './agent-card-handler.js'
import { getApprovalRegistry } from './approval-registry.js'
import { handleAgentRunReconnect, isAgentRunStreamPath } from './handle-agent-run-reconnect.js'
import { isListApprovalsPath, handleListApprovals } from './list-approvals-handler.js'
import { extractAppResources } from './mcp-app-resources.js'
import { isMcpPath, handleMcpJsonRpc } from './mcp-handler.js'
import { getRunEventCache } from './run-event-cache.js'

/** JSON error envelope (mirrors mount-agent.ts:37 — the parity source for the MCP CSRF gate). */
function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** Dependencies the aux dispatcher needs from its caller (dev or prod). */
export interface AuxRouteDeps {
  /** Discovered agents (from `scanAgents`). */
  agents: readonly AgentNode[]
  /** Load an agent module from its file path (dev: vite loader; prod: dynamic import). */
  loadModule: (filePath: string) => Promise<unknown>
  /** Absolute base URL (`http(s)://host`) for the agent-card endpoint URLs. */
  baseUrl: string
  /**
   * M34 (#97) — CSRF enforcement mode for the MCP route. `POST /api/agents/<name>/mcp` drives the
   * agent (spends LLM tokens), so a cross-origin POST MUST be rejected in `'strict'` — parity with
   * the agent-run route (`mount-agent.ts:83-91`). Defaults to `'strict'` (safe-by-default); a caller
   * that already gated upstream may pass `'off'`.
   */
  csrfMode?: CsrfMode
}

/**
 * Serve an agent auxiliary route. Returns a `Response` when `urlPath` matches an aux route (card /
 * list-approvals / mcp) and the method + agent resolve; returns `null` to fall through (not an aux
 * route, wrong method, or unknown agent — the caller then owns the 404/next).
 */
export async function serveAgentAuxRoute(
  request: Request,
  urlPath: string,
  deps: AuxRouteDeps,
): Promise<Response | null> {
  const method = request.method.toUpperCase()

  // M15 — A2A agent card at `/.well-known/<name>/agent-card.json` (GET).
  const cardName = isAgentCardPath(urlPath)
  if (cardName !== null) {
    if (method !== 'GET') return null
    const agent = deps.agents.find((a) => a.name === cardName)
    if (!agent) return null
    const mod = await deps.loadModule(agent.filePath)
    return handleAgentCard(mod, agent.name, agent.agentPath, deps.baseUrl)
  }

  // M14 — GET /api/agents/<name>/approvals (pending HITL approvals).
  if (isListApprovalsPath(urlPath)) {
    if (method !== 'GET') return null
    return handleListApprovals(getApprovalRegistry())
  }

  // M37 — GET /api/agents/<name>/runs/<runId>/stream (durable reconnect / observe).
  // INTENTIONALLY open (no CSRF, no auth gate): a GET is not CSRF-vulnerable, the
  // run-start POST is already gated, and the `runId` is a 122-bit UUID (unguessable).
  // Observe-by-runId is a FEATURE (ADR-0046 D5) — a second client resumes a run a
  // first started. Do NOT add a custom-header CSRF check here: browsers send NO
  // custom headers with `EventSource`, so it would break native SSE reconnect.
  const runStream = isAgentRunStreamPath(urlPath)
  if (runStream !== null) {
    if (method !== 'GET') return null
    if (!deps.agents.some((a) => a.name === runStream.name)) return null
    return handleAgentRunReconnect(runStream.runId, request, getRunEventCache())
  }

  // M16 — POST /api/agents/<name>/mcp (JSON-RPC MCP server). Extracted to keep this dispatcher
  // within the cognitive-complexity budget (G6).
  const mcpName = isMcpPath(urlPath)
  if (mcpName !== null) {
    return serveMcpRoute(request, method, mcpName, deps)
  }

  return null
}

/**
 * Serve the MCP route with the M34 gates: default-DENY opt-in → CSRF → dispatch. Returns `null` to
 * fall through (wrong method / unknown or non-opted-in agent), a 403 on CSRF failure, else the
 * JSON-RPC response.
 */
async function serveMcpRoute(
  request: Request,
  method: string,
  mcpName: string,
  deps: AuxRouteDeps,
): Promise<Response | null> {
  if (method !== 'POST') return null
  const agent = deps.agents.find((a) => a.name === mcpName)
  if (!agent) return null

  const mod = await deps.loadModule(agent.filePath)

  // M34 — DEFAULT-DENY: an agent is NOT exposed on MCP unless it explicitly opts in with a named
  // `export const mcp = true` (blueprint D5 — default-EXPOSE is the footgun magnified by the
  // multi-surface thesis). Absent the opt-in, fall through to 404 (the agent is web-only). This is a
  // breaking change from the M16 auto-mount (documented in the CHANGELOG § Security).
  if (!isMcpExposed(mod)) return null

  // M34 (#97) — enforce CSRF BEFORE any work. The MCP route drives the agent (real LLM tokens), so a
  // cross-origin POST must be rejected — parity with the agent-run route (`mount-agent.ts:83-91`).
  const csrfMode = deps.csrfMode ?? 'strict'
  if (csrfMode === 'strict') {
    const csrf = validateCsrfRequest(request)
    if (!csrf.valid) return jsonError(403, 'CSRF_FAILED', `CSRF check failed: ${csrf.reason}`)
  }

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    /* malformed/empty JSON → handleMcpJsonRpc returns a -32600 envelope */
  }
  // M30 — pass the agent's declared `ui://` App resources (named `appResources` export) so the MCP
  // server advertises + serves them via resources/list + resources/read.
  return handleMcpJsonRpc(mod, agent.name, body, extractAppResources(mod))
}

/**
 * M34 — DEFAULT-DENY opt-in check: is this agent module exposed on the MCP surface? An agent opts in
 * with a named `export const mcp = true` (mirroring the `appResources` named-export convention).
 * Anything else (absent / falsy) → NOT exposed. Read at the emit layer (blueprint D5).
 */
function isMcpExposed(mod: unknown): boolean {
  return (mod as { mcp?: unknown } | null | undefined)?.mcp === true
}
