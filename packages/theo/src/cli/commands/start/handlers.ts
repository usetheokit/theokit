import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'

import { getApprovalRegistry } from '../../../server/agent/approval-registry.js'
import { handleAgentApproval, isApprovalPath } from '../../../server/agent/approve-agent.js'
import { mountAgent } from '../../../server/agent/mount-agent.js'
import { resolveProvider } from '../../../server/agent/provider-resolver.js'
import { serveAgentAuxRoute } from '../../../server/agent/serve-aux-routes.js'
import { executeAction } from '../../../server/http/action-execute.js'
import { executeRoute } from '../../../server/http/execute.js'
import {
  incomingMessageToWebRequest,
  writeWebResponseToServerResponse,
} from '../../../server/http/node-web-adapter.js'
import { sendError } from '../../../server/http/send-response.js'
import { serveStaticFile } from '../../../server/http/static.js'
import { logRequest } from '../../../server/observability/logger.js'
import { findSuggestion } from '../../../server/observability/suggest.js'
import type { PluginRunner } from '../../../server/plugins/plugin-runner.js'
import type { ActionNode } from '../../../server/scan/action-scan.js'
import type { AgentNode } from '../../../server/scan/agent-scan.js'
import { matchRoute } from '../../../server/scan/match.js'
import type { ServerRouteNode } from '../../../server/scan/match.js'
import type { LoadModule } from '../../../server/scan/module-loader.js'
import type { CsrfMode, DisallowedConfig } from '../../../server/security/csrf.js'
import type { TheoTransformer } from '../../../server/transformer.js'

/** Response header carrying the per-request correlation id. */
const X_REQUEST_ID = 'x-request-id'

/**
 * T6.1 (PV-7 SRP): start.ts request orchestrator decomposed into 5 focused
 * per-branch handlers. Each handler returns `true` if it handled the
 * request (response sent) so the orchestrator can stop iterating.
 *
 * The original 455-LOC monolith closed over 14+ locals; the shared shape
 * `RequestHandlerCtx` makes the dependencies explicit + reviewable.
 */
export interface RequestHandlerCtx {
  req: IncomingMessage
  res: ServerResponse
  url: string
  requestId: string
  startTime: number
  // Pre-loaded build artifacts
  clientDir: string
  custom404Html: string | null
  // Manifest-resolved tables
  cachedRoutes: ServerRouteNode[]
  cachedActions: ActionNode[]
  cachedAgents: AgentNode[]
  // Runtime infra
  loadModule: LoadModule
  serverDir: string
  pluginRunner: PluginRunner | undefined
  transformer: TheoTransformer | undefined
  csrfMode: CsrfMode
  disallowed: DisallowedConfig | undefined
  rateLimiter:
    | ((req: IncomingMessage) => { limited: boolean; headers: Record<string, string> })
    | null
}

/** Apply rate limit; return true if request was limited (response sent). */
function applyRateLimit(c: RequestHandlerCtx, method: string): boolean {
  if (!c.rateLimiter) return false
  const check = c.rateLimiter(c.req)
  for (const [k, v] of Object.entries(check.headers)) c.res.setHeader(k, v)
  if (check.limited) {
    sendError(c.res, 'RATE_LIMITED', 'Too many requests', 429, undefined, c.requestId)
    logRequest({
      method,
      url: c.url,
      status: 429,
      duration: Date.now() - c.startTime,
      requestId: c.requestId,
    })
    return true
  }
  return false
}

/** Branch 1: action routes (`/api/__actions/{file}/{exportName}`). */
export async function tryServeAction(c: RequestHandlerCtx): Promise<boolean> {
  if (!c.url.startsWith('/api/__actions/')) return false
  c.res.setHeader(X_REQUEST_ID, c.requestId)

  if (applyRateLimit(c, c.req.method ?? 'POST')) return true

  const pathAfterPrefix = c.url.slice('/api/__actions/'.length).split('?')[0]
  const segments = pathAfterPrefix.split('/').filter(Boolean)
  if (segments.length < 2) {
    sendError(
      c.res,
      'BAD_REQUEST',
      'Action URL must be /api/__actions/{file}/{exportName}',
      400,
      undefined,
      c.requestId,
    )
    logRequest({
      method: c.req.method ?? 'POST',
      url: c.url,
      status: 400,
      duration: Date.now() - c.startTime,
      requestId: c.requestId,
    })
    return true
  }
  const exportName = segments[segments.length - 1]
  const actionPath = segments.slice(0, -1).join('/')
  const action = c.cachedActions.find((a) => a.actionPath === actionPath)
  if (!action) {
    const actionPaths = c.cachedActions.map((a) => a.actionPath)
    const suggestion = findSuggestion(actionPath, actionPaths)
    const msg = suggestion
      ? `Action "${actionPath}" not found. Did you mean: ${suggestion}?`
      : `Action "${actionPath}" not found`
    sendError(c.res, 'NOT_FOUND', msg, 404, undefined, c.requestId)
    logRequest({
      method: c.req.method ?? 'POST',
      url: c.url,
      status: 404,
      duration: Date.now() - c.startTime,
      requestId: c.requestId,
    })
    return true
  }
  await executeAction(
    action.filePath,
    exportName,
    c.req,
    c.res,
    c.loadModule,
    c.serverDir,
    c.requestId,
    c.pluginRunner,
    c.csrfMode,
    c.disallowed,
  )
  logRequest({
    method: c.req.method ?? 'POST',
    url: c.url,
    status: c.res.statusCode,
    duration: Date.now() - c.startTime,
    requestId: c.requestId,
  })
  return true
}

/**
 * Branch 1.4: agent AUXILIARY routes served identically in dev + prod (M15/M16 follow-up) —
 * agent cards (`/.well-known/<name>/agent-card.json`), MCP (`/api/agents/<name>/mcp`), and the
 * pending-approvals listing (`/api/agents/<name>/approvals`). Before this, they were dev-only, so a
 * built/deployed app 404'd them. Delegates to the shared `serveAgentAuxRoute` dispatcher (DRY).
 */
export async function tryServeAgentAux(c: RequestHandlerCtx): Promise<boolean> {
  const urlPath = c.url.split('?')[0]
  const baseUrl = `http://${c.req.headers.host ?? 'localhost'}`
  const request = incomingMessageToWebRequest(c.req)
  const response = await serveAgentAuxRoute(request, urlPath, {
    agents: c.cachedAgents,
    loadModule: c.loadModule,
    baseUrl,
    // M34 (#97) — the MCP aux route drives the agent (spends tokens); enforce CSRF like the run route.
    csrfMode: c.csrfMode,
    // M39 — the thread follow-up route drives the agent; resolve the key on demand.
    resolveApiKey: () => resolveProvider().apiKey,
  })
  if (response === null) return false
  c.res.setHeader(X_REQUEST_ID, c.requestId)
  await writeWebResponseToServerResponse(response, c.res)
  logRequest({
    method: (c.req.method ?? 'GET').toUpperCase(),
    url: c.url,
    status: c.res.statusCode,
    duration: Date.now() - c.startTime,
    requestId: c.requestId,
  })
  return true
}

/**
 * Branch 1.5: agent convention routes (`/api/agents/<name>`, M2). Runs BEFORE the generic `/api/*`
 * branch so a scanned `agents/<name>.ts` owns its path (parity with dev). Loads the module, resolves
 * the provider apiKey (fail-fast), and streams the M0/M1 UIMessageStream via `mountAgent`.
 */
export async function tryServeAgent(c: RequestHandlerCtx): Promise<boolean> {
  if (!c.url.startsWith('/api/agents/')) return false
  const urlPath = c.url.split('?')[0]

  // HITL approve route (`/api/agents/<name>/approve/<id>`, M4) — resolve the pending approval.
  // Handled BEFORE the agent-path exact match (the approve path never equals an `agentPath`).
  if (isApprovalPath(urlPath)) {
    c.res.setHeader(X_REQUEST_ID, c.requestId)
    if (applyRateLimit(c, c.req.method ?? 'POST')) return true
    const method = (c.req.method ?? 'POST').toUpperCase()
    if (method !== 'POST') {
      sendError(
        c.res,
        'METHOD_NOT_ALLOWED',
        'Approve endpoints accept POST',
        405,
        undefined,
        c.requestId,
      )
      logRequest({
        method,
        url: c.url,
        status: 405,
        duration: Date.now() - c.startTime,
        requestId: c.requestId,
      })
      return true
    }
    try {
      const request = incomingMessageToWebRequest(c.req)
      const response = await handleAgentApproval(
        request,
        urlPath,
        getApprovalRegistry(),
        c.csrfMode,
      )
      await writeWebResponseToServerResponse(response, c.res)
    } catch (err) {
      sendError(
        c.res,
        'INTERNAL',
        err instanceof Error ? err.message : 'Approve handler failed',
        500,
        undefined,
        c.requestId,
      )
    }
    logRequest({
      method,
      url: c.url,
      status: c.res.statusCode,
      duration: Date.now() - c.startTime,
      requestId: c.requestId,
    })
    return true
  }

  const agent = c.cachedAgents.find((a) => a.agentPath === urlPath)
  if (!agent) return false // fall through to the generic /api/* branch (may 404 there)

  c.res.setHeader(X_REQUEST_ID, c.requestId)
  if (applyRateLimit(c, c.req.method ?? 'POST')) return true

  const method = (c.req.method ?? 'POST').toUpperCase()
  if (method !== 'POST') {
    sendError(
      c.res,
      'METHOD_NOT_ALLOWED',
      'Agent endpoints accept POST',
      405,
      undefined,
      c.requestId,
    )
    logRequest({
      method,
      url: c.url,
      status: 405,
      duration: Date.now() - c.startTime,
      requestId: c.requestId,
    })
    return true
  }

  try {
    const mod = await c.loadModule(agent.filePath)
    const apiKey = resolveProvider().apiKey
    const request = incomingMessageToWebRequest(c.req)
    const response = await mountAgent(mod, request, apiKey, agent.filePath, c.csrfMode)
    await writeWebResponseToServerResponse(response, c.res)
  } catch (err) {
    sendError(
      c.res,
      'INTERNAL',
      err instanceof Error ? err.message : 'Agent handler failed',
      500,
      undefined,
      c.requestId,
    )
  }
  logRequest({
    method,
    url: c.url,
    status: c.res.statusCode,
    duration: Date.now() - c.startTime,
    requestId: c.requestId,
  })
  return true
}

/** Branch 2: API routes (`/api/*` excluding actions). */
export async function tryServeApiRoute(c: RequestHandlerCtx): Promise<boolean> {
  if (!c.url.startsWith('/api/')) return false
  c.res.setHeader(X_REQUEST_ID, c.requestId)

  if (applyRateLimit(c, c.req.method ?? 'GET')) return true

  const match = matchRoute(c.url, c.cachedRoutes)
  if (!match) {
    const urlPath = c.url.split('?')[0]
    const routePaths = c.cachedRoutes.map((r) => r.routePath)
    const suggestion = findSuggestion(urlPath, routePaths)
    const msg = suggestion
      ? `API route not found: ${urlPath}. Did you mean: ${suggestion}?`
      : 'API route not found'
    sendError(c.res, 'NOT_FOUND', msg, 404, undefined, c.requestId)
    logRequest({
      method: c.req.method ?? 'GET',
      url: c.url,
      status: 404,
      duration: Date.now() - c.startTime,
      requestId: c.requestId,
    })
    return true
  }
  const method = (c.req.method ?? 'GET').toUpperCase()
  // T3.1 (ADR-0016) — context object replaces 12 positional args
  await executeRoute({
    route: match.route,
    method,
    params: match.params,
    req: c.req,
    res: c.res,
    loadModule: c.loadModule,
    serverDir: c.serverDir,
    requestId: c.requestId,
    pluginRunner: c.pluginRunner,
    transformer: c.transformer,
    csrfMode: c.csrfMode,
    disallowed: c.disallowed,
  })
  logRequest({
    method,
    url: c.url,
    status: c.res.statusCode,
    duration: Date.now() - c.startTime,
    requestId: c.requestId,
  })
  return true
}

/** Branch 3: static files (returns true if a static asset was served). */
export function tryServeStatic(c: RequestHandlerCtx): boolean {
  return serveStaticFile(c.req, c.res, c.clientDir)
}

/** Branch 4: custom 404 for URLs that look like missing assets. */
export function tryServeCustom404(c: RequestHandlerCtx): boolean {
  const urlPath = c.url.split('?')[0]
  if (c.custom404Html && extname(urlPath)) {
    c.res.writeHead(404, { 'Content-Type': 'text/html' })
    c.res.end(c.custom404Html)
    return true
  }
  return false
}
