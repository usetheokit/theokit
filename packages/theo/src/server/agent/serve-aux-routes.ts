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
 *  - **M37** `GET /api/agents/<name>/runs/<id>/stream` → {@link handleAgentRunReconnect}
 *  - **M39** the two thread routes                     → {@link handleThreadMessage} / {@link handleThreadStream}
 *
 * Channels (M27) are NOT here: a channel webhook needs app-supplied `validators` + `onMessage`, so
 * the app wires `handleChannelWebhook` in its own route (it cannot be auto-derived from the module).
 * The HITL approve route stays in each caller (it carries caller-specific rate-limiting/CSRF plumbing).
 *
 * ## Deciding and answering are two functions, and that is the fix
 *
 * This used to be one call that took a not-yet-converted request, decided whether it owned the path
 * and answered in the same breath. A caller could therefore learn "this is an agent aux route" only
 * by receiving the finished `Response` — too late to run anything around the handler. So the plugin
 * lifecycle, which every other branch of `theokit start` runs, was never run here: `onRequest`,
 * `onResponse` and `onError` fired for a file route and for the plain agent route and for none of
 * these six, and the observability plugin therefore emitted no `http.request` span for the endpoints
 * that spend tokens and settle human decisions (usetheokit/theokit#405).
 *
 * {@link matchAgentAuxRoute} decides; {@link serveMatchedAuxRoute} answers. A caller brackets the
 * gap with whatever the request lifecycle owes — and a seventh route added to the match table
 * inherits that bracket instead of having to remember it.
 */
import type { AgentNode } from '../scan/agent-scan.js'
import { validateCsrfRequest, type CsrfMode } from '../security/csrf.js'

import {
  admitAgentRequest,
  agentAccessDenied,
  readAgentPolicy,
  type AgentAccessParams,
  type AgentSubjectResolver,
} from './agent-access.js'
import { isAgentCardPath, handleAgentCard } from './agent-card-handler.js'
import type { ApiKeyResolver } from './api-key-resolver.js'
import { getApprovalRegistry } from './approval-registry.js'
import { handleAgentRunReconnect, isAgentRunStreamPath } from './handle-agent-run-reconnect.js'
import {
  handleThreadMessage,
  handleThreadStream,
  isThreadMessagePath,
  isThreadStreamPath,
} from './handle-thread-routes.js'
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
interface AuxRouteDeps {
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
  /**
   * M39 — lazily resolve the provider apiKey. Required only for the thread
   * follow-up route (which drives the agent); resolved on demand so non-agent
   * aux routes (card, approvals, stream) never need a provider key.
   *
   * theokit#328 — it receives the model the agent declares, so the credential matches the provider
   * the agent asked for. It was called with no argument, before the module was even compiled, so
   * an agent declaring `anthropic/…` was handed whichever key env priority found first.
   */
  resolveApiKey?: ApiKeyResolver
  /**
   * Who is asking (usetheokit/theokit#365). Invoked ONLY from {@link serveMatchedAuxRoute}, and only
   * when the matched path's agent declares a policy — so the application's `createContext` never
   * runs for a url this dispatcher merely declines. {@link matchAgentAuxRoute} is not given it, for
   * the same reason it is not given the request body: deciding must cost nothing.
   */
  resolveSubject?: AgentSubjectResolver
}

/**
 * One aux route, already decided. Carries what the match resolved so the serve half re-derives
 * nothing: the agent node it looked up, and for MCP the module it had to open in order to answer
 * the opt-in question at all.
 */
export type AgentAuxRoute =
  | { readonly kind: 'card'; readonly agent: AgentNode }
  | { readonly kind: 'approvals'; readonly agent: AgentNode }
  | { readonly kind: 'run-stream'; readonly agent: AgentNode; readonly runId: string }
  | { readonly kind: 'thread-stream'; readonly agent: AgentNode; readonly sessionId: string }
  | { readonly kind: 'thread-message'; readonly agent: AgentNode; readonly sessionId: string }
  | { readonly kind: 'mcp'; readonly agent: AgentNode; readonly mod: unknown }

/**
 * Resolve `name` to a discovered agent and build a route from it, or `null` when there is no name
 * (the path did not match) or no such agent (fall through to the caller's 404).
 *
 * Both misses collapse to `null` deliberately: every one of them means "this dispatcher does not
 * answer this url", and the path families below are mutually exclusive, so a family that declines
 * can safely let the next matcher look.
 */
function routeFor<R>(
  deps: AuxRouteDeps,
  name: string | null,
  build: (agent: AgentNode) => R,
): R | null {
  if (name === null) return null
  const agent = deps.agents.find((a) => a.name === name)
  return agent === undefined ? null : build(agent)
}

/** The GET-only aux routes: agent card, approvals listing, run stream, thread stream. */
function matchGetAuxRoute(verb: string, urlPath: string, deps: AuxRouteDeps): AgentAuxRoute | null {
  if (verb !== 'GET') return null

  // M15 — A2A agent card at `/.well-known/<name>/agent-card.json`.
  const card = routeFor(
    deps,
    isAgentCardPath(urlPath),
    (agent) => ({ kind: 'card', agent }) as const,
  )
  if (card !== null) return card

  // M14 — the pending HITL approvals of one agent.
  const approvals = routeFor(
    deps,
    isListApprovalsPath(urlPath),
    (agent) => ({ kind: 'approvals', agent }) as const,
  )
  if (approvals !== null) return approvals

  // M37 — the durable run stream (`/runs/<runId>/stream`), reconnect or observe.
  const run = isAgentRunStreamPath(urlPath)
  if (run !== null) {
    return routeFor(
      deps,
      run.name,
      (agent) => ({ kind: 'run-stream', agent, runId: run.runId }) as const,
    )
  }

  // M39 — subscribe to a thread (`/threads/<sessionId>/stream`).
  const stream = isThreadStreamPath(urlPath)
  if (stream === null) return null
  return routeFor(
    deps,
    stream.name,
    (agent) => ({ kind: 'thread-stream', agent, sessionId: stream.sessionId }) as const,
  )
}

/** The POST-only aux routes: thread follow-up and MCP. */
async function matchPostAuxRoute(
  verb: string,
  urlPath: string,
  deps: AuxRouteDeps,
): Promise<AgentAuxRoute | null> {
  if (verb !== 'POST') return null

  // M39 — a follow-up message on a thread.
  const msg = isThreadMessagePath(urlPath)
  if (msg !== null) {
    return routeFor(
      deps,
      msg.name,
      (agent) => ({ kind: 'thread-message', agent, sessionId: msg.sessionId }) as const,
    )
  }

  // M16 — the JSON-RPC MCP server, behind the M34 opt-in.
  const agent = routeFor(deps, isMcpPath(urlPath), (found) => found)
  if (agent === null) return null
  // M34 — DEFAULT-DENY: an agent is NOT exposed on MCP unless it explicitly opts in with a named
  // `export const mcp = true` (blueprint D5 — default-EXPOSE is the footgun magnified by the
  // multi-surface thesis). Absent the opt-in, fall through to 404 (the agent is web-only). This is a
  // breaking change from the M16 auto-mount (documented in the CHANGELOG § Security).
  const mod = await deps.loadModule(agent.filePath)
  return isMcpExposed(mod) ? { kind: 'mcp', agent, mod } : null
}

/**
 * Does this dispatcher own `urlPath`? Returns the matched route, or `null` to fall through (not an
 * aux path, wrong method, unknown agent, or an agent that did not opt into MCP).
 *
 * theokit#400 — this function is where the "convert only on a path you are about to answer" rule
 * now lives, and it is enforced by the signature rather than by discipline: it is handed a method
 * and a url and has no request to convert. Converting in order to decide is what drained the Node
 * body stream on every path this dispatcher declined, so an ordinary `POST /api/…` file route then
 * waited forever for an `'end'` that had already fired — no status, no timeout, no response.
 *
 * The one branch that does real work here is MCP, which must open the module to read its
 * `export const mcp` opt-in. That is deliberate: a match that could still fall through would hand
 * the caller a request it had already started a lifecycle for, and the span opened for it would
 * either double-count or never close.
 */
export async function matchAgentAuxRoute(
  method: string,
  urlPath: string,
  deps: AuxRouteDeps,
): Promise<AgentAuxRoute | null> {
  const verb = method.toUpperCase()
  return matchGetAuxRoute(verb, urlPath, deps) ?? (await matchPostAuxRoute(verb, urlPath, deps))
}

/**
 * Evaluate the agent's declared policy for one aux endpoint.
 *
 * Returns the refusal `Response`, or `null` when the caller is admitted. Loading the module here is
 * what makes the gate reachable at all: the policy is an export of the agent file, and three of
 * these branches previously answered without ever opening it.
 */
async function admitAux(
  deps: AuxRouteDeps,
  agent: AgentNode,
  params: AgentAccessParams,
  body?: unknown,
): Promise<Response | null> {
  const mod = await deps.loadModule(agent.filePath)
  const decision = await admitAgentRequest(
    readAgentPolicy(mod, agent.filePath),
    deps.resolveSubject,
    params,
    body,
  )
  return decision.allowed ? null : agentAccessDenied(decision, params)
}

/**
 * Answer a route {@link matchAgentAuxRoute} already claimed. Always returns a `Response` — every
 * fall-through was decided upstream, which is what lets a caller open a request span before this
 * runs and be sure something will close it.
 */
export async function serveMatchedAuxRoute(
  route: AgentAuxRoute,
  request: Request,
  deps: AuxRouteDeps,
): Promise<Response> {
  if (route.kind === 'card') {
    const mod = await deps.loadModule(route.agent.filePath)
    return handleAgentCard(mod, route.agent.name, route.agent.agentPath, deps.baseUrl)
  }

  // usetheokit/theokit#365 — the approvals listing used to answer 200 with every pending approval
  // id to anyone who asked, and the id is all the approve route needs to settle a paused tool.
  if (route.kind === 'approvals') {
    const refusal = await admitAux(deps, route.agent, {
      agent: route.agent.name,
      endpoint: 'approvals',
    })
    return refusal ?? handleListApprovals(getApprovalRegistry())
  }

  // M37 — INTENTIONALLY open (no CSRF, no auth gate): a GET is not CSRF-vulnerable, the run-start
  // POST is already gated, and the `runId` is a 122-bit UUID minted BY THE SERVER (`mintRunId`) and
  // handed only to the caller that started the run — a capability the framework issued rather than
  // a name the caller chose. That is the property the thread and conversation keys lack, and it is
  // the whole of the difference. Observe-by-runId is a FEATURE (ADR-0046 D5). Do NOT add a
  // custom-header CSRF check here: browsers send NO custom headers with `EventSource`, so it would
  // break native SSE reconnect.
  if (route.kind === 'run-stream') {
    return handleAgentRunReconnect(route.runId, request, getRunEventCache())
  }

  if (route.kind === 'mcp') return serveMcpRoute(route, request, deps)

  return serveThreadRoute(route, request, deps)
}

/**
 * M39 — serve the thread routes:
 *  - `POST .../threads/<sessionId>/message` (follow-up) — loads the module, drives
 *    the run headless via the thread dispatcher. Needs `resolveApiKey` (drives the
 *    agent) → 501 when absent (rather than a silent 404).
 *  - `GET .../threads/<sessionId>/stream` (subscribe) — attach to the active/next
 *    run's durable stream. INTENTIONALLY open (GET, no custom headers — like the
 *    M37 reconnect route).
 *
 * SECURITY (thread stream): unlike the M37 reconnect route — keyed on an
 * `mintRunId()` UUID (122-bit unguessable) — the thread stream is keyed on the
 * caller-supplied `sessionId`, so an app using a PREDICTABLE sessionId (a user id,
 * an email, a tenant-derived key) is one guess away from another party reading the
 * thread's live conversation.
 *
 * usetheokit/theokit#365 — this paragraph used to end by telling the application it
 * "MUST add its own auth gate before this endpoint", and no such gate was constructible:
 * the URL is dispatched before route matching, so no `route()` and no middleware ever
 * saw it. The gate is the agent's own `export const policy`, evaluated here, and the
 * instruction is now one an application can follow.
 */
async function serveThreadRoute(
  route: Extract<AgentAuxRoute, { kind: 'thread-stream' | 'thread-message' }>,
  request: Request,
  deps: AuxRouteDeps,
): Promise<Response> {
  const { agent, sessionId } = route

  if (route.kind === 'thread-stream') {
    const refusal = await admitAux(deps, agent, {
      agent: agent.name,
      endpoint: 'thread-stream',
      sessionId,
    })
    return refusal ?? handleThreadStream(sessionId, request)
  }

  const refusal = await admitAux(deps, agent, {
    agent: agent.name,
    endpoint: 'thread-message',
    sessionId,
  })
  if (refusal !== null) return refusal
  if (deps.resolveApiKey === undefined) {
    // MEDIUM-1 — the path matched but the caller wired no provider-key resolver.
    // Fail loudly (501) instead of a silent 404 that reads as "route not found".
    return jsonError(
      501,
      'NOT_CONFIGURED',
      'Thread follow-up requires a provider API key (resolveApiKey was not provided to serveMatchedAuxRoute).',
    )
  }
  const mod = await deps.loadModule(agent.filePath)
  return handleThreadMessage({
    mod,
    // Passed unresolved: `makeThreadStartRun` calls it once the module is compiled and the
    // model is known (theokit#328).
    apiKey: deps.resolveApiKey,
    sessionId,
    request,
    source: `agent "${agent.name}"`,
    // usetheokit/theokit#406 — the label above reads well in an `AgentDefinitionError` and is not
    // a name; the spans get the name, so the same agent is one series whichever route started it.
    agentName: agent.name,
    csrfMode: deps.csrfMode ?? 'strict',
  })
}

/**
 * Serve the MCP route with the M34 gates. The opt-in check already ran in the match (it is what
 * decides ownership), so what is left here is: default-DENY policy → CSRF → dispatch.
 */
async function serveMcpRoute(
  route: Extract<AgentAuxRoute, { kind: 'mcp' }>,
  request: Request,
  deps: AuxRouteDeps,
): Promise<Response> {
  const { agent, mod } = route

  // usetheokit/theokit#365 — the MCP route drives the agent and reaches its tools, so it answers to
  // the same declared policy as the run route.
  const mcpParams = { agent: agent.name, endpoint: 'mcp' as const }
  const mcpDecision = await admitAgentRequest(
    readAgentPolicy(mod, agent.filePath),
    deps.resolveSubject,
    mcpParams,
  )
  if (!mcpDecision.allowed) return agentAccessDenied(mcpDecision, mcpParams)

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
