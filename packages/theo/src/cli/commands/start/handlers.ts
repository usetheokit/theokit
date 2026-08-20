import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { RouteSubject } from '../../../core/contracts/route-policy.js'
import { readAgentPolicy } from '../../../server/agent/agent-access.js'
import { getApprovalRegistry } from '../../../server/agent/approval-registry.js'
import {
  handleAgentApproval,
  isApprovalPath,
  parseApprovalAgentName,
} from '../../../server/agent/approve-agent.js'
import { mountAgent } from '../../../server/agent/mount-agent.js'
import { resolveProvider } from '../../../server/agent/provider-resolver.js'
import { serveAgentAuxRoute } from '../../../server/agent/serve-aux-routes.js'
import { executeAction } from '../../../server/http/action-execute.js'
import { dispatchControllerRequest } from '../../../server/http/controller-dispatch.js'
import { executeRoute } from '../../../server/http/execute.js'
import { createWebRequestSource } from '../../../server/http/node-request.js'
import {
  incomingMessageToWebRequest,
  writeWebResponseToServerResponse,
} from '../../../server/http/node-web-adapter.js'
import { createAgentSubjectResolver } from '../../../server/http/resolve-agent-subject.js'
import { sendError } from '../../../server/http/send-response.js'
import { serveStaticFile } from '../../../server/http/static.js'
import { logRequest } from '../../../server/observability/logger.js'
import { findSuggestion } from '../../../server/observability/suggest.js'
import type { PluginContext } from '../../../server/plugin-types.js'
import type { PluginRunner } from '../../../server/plugins/plugin-runner.js'
import type { ActionNode } from '../../../server/scan/action-scan.js'
import type { AgentNode } from '../../../server/scan/agent-scan.js'
import { matchRoute } from '../../../server/scan/match.js'
import type { ServerRouteNode } from '../../../server/scan/match.js'
import type { LoadModule } from '../../../server/scan/module-loader.js'
import type { CsrfMode, DisallowedConfig } from '../../../server/security/csrf.js'
import type { TheoTransformer } from '../../../server/transformer.js'

/**
 * Load a controller module that `theokit build` already compiled — theokit#123.
 *
 * A plain dynamic `import()`, deliberately: production must not need `@swc/core`. That peer is a
 * native binary the app would otherwise carry solely to re-do work the build already did, and a
 * missing optional peer would degrade into a runtime 404 instead of a build failure.
 */
async function loadCompiledController(absPath: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(absPath).href)) as Record<string, unknown>
}

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
  /** App root (= `process.cwd()` at `theokit start`); mountAgent points `.theokit/` discovery here. */
  projectRoot: string
  /**
   * theokit#123 — absolute path to the COMPILED controllers emitted by `theokit build`
   * (`<distDir>/controllers`), or `undefined` when the build produced none.
   *
   * `undefined` is the routes-only app, and it must stay free: no scan, no import, no cost.
   */
  controllersDistDir: string | undefined
  pluginRunner: PluginRunner | undefined
  transformer: TheoTransformer | undefined
  csrfMode: CsrfMode
  disallowed: DisallowedConfig | undefined
  /**
   * Async because the per-route limiter hashes the session cookie with Web Crypto when
   * `keyBy: 'session'`, and `subtle.digest` is promise-based.
   */
  rateLimiter:
    | ((req: IncomingMessage) => Promise<{ limited: boolean; headers: Record<string, string> }>)
    | null
}

/**
 * The caller's identity, from the application's own `server/context.ts` — the seam every
 * `route()` already reads and no agent URL ever reached (usetheokit/theokit#365).
 *
 * Memoized per request by `createAgentSubjectResolver` and invoked only on a path this process is
 * about to answer, and only when that path's agent declares a policy.
 */
function agentSubjectResolver(c: RequestHandlerCtx): () => Promise<RouteSubject | null> {
  return createAgentSubjectResolver({
    req: c.req,
    res: c.res,
    loadModule: c.loadModule,
    serverDir: c.serverDir,
    pluginRunner: c.pluginRunner,
  })
}

/** Apply rate limit; return true if request was limited (response sent). */
async function applyRateLimit(c: RequestHandlerCtx, method: string): Promise<boolean> {
  if (!c.rateLimiter) return false
  const check = await c.rateLimiter(c.req)
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

  if (await applyRateLimit(c, c.req.method ?? 'POST')) return true

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
 *
 * theokit#400 — this branch runs for EVERY url, so it hands the dispatcher a deferred
 * `WebRequestSource` instead of a converted `Request`. It used to convert first and ask second, and
 * the conversion drains the Node body stream: every POST with a JSON body to an `/api` file route
 * (the most ordinary route an application has) then reached `parseJsonBody` with a readable that had
 * already ended, and waited forever for an `'end'` that had already fired. Not a 500, not a timeout
 * — no response at all. `theokit dev` was unaffected because its middleware matches the aux paths
 * before it converts, which is exactly what this now does.
 */
export async function tryServeAgentAux(c: RequestHandlerCtx): Promise<boolean> {
  const urlPath = c.url.split('?')[0]
  const baseUrl = `http://${c.req.headers.host ?? 'localhost'}`
  const response = await serveAgentAuxRoute(createWebRequestSource(c.req), urlPath, {
    agents: c.cachedAgents,
    loadModule: c.loadModule,
    baseUrl,
    // M34 (#97) — the MCP aux route drives the agent (spends tokens); enforce CSRF like the run route.
    csrfMode: c.csrfMode,
    // M39 — the thread follow-up route drives the agent; resolve the key on demand.
    // theokit#328 — the thread route drives an agent, so its key follows the model too.
    resolveApiKey: (model) => resolveProvider(model).apiKey,
    // usetheokit/theokit#365 — who is asking. Memoized and LAZY: this branch runs for every url,
    // and the application's `createContext` must not execute for the ones it declines.
    resolveSubject: agentSubjectResolver(c),
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
    if (await applyRateLimit(c, c.req.method ?? 'POST')) return true
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
      // usetheokit/theokit#365 — the approve route settles a paused tool, so it answers to the
      // named agent's declared policy. The subject resolver runs BEFORE the Node request is
      // converted, because `createContext` receives the Node `req` and the conversion drains it.
      const approveAgent = c.cachedAgents.find((a) => a.name === parseApprovalAgentName(urlPath))
      const resolveSubject = agentSubjectResolver(c)
      const policy =
        approveAgent === undefined
          ? undefined
          : readAgentPolicy(await c.loadModule(approveAgent.filePath), approveAgent.filePath)
      const request = incomingMessageToWebRequest(c.req)
      const response = await handleAgentApproval(
        request,
        urlPath,
        getApprovalRegistry(),
        c.csrfMode,
        { policy, resolveSubject },
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
  if (await applyRateLimit(c, c.req.method ?? 'POST')) return true

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

  await serveAgentTurn(c, agent, method)
  return true
}

/**
 * Serves one agent turn through the plugin lifecycle.
 *
 * Extracted from `tryServeAgent` so that function stays what its name says — a router over the
 * agent paths — while the turn itself, which is what grew a lifecycle, reads in one piece.
 */
async function serveAgentTurn(
  c: RequestHandlerCtx,
  agent: { filePath: string; name: string },
  method: string,
): Promise<void> {
  // theokit#324 — the plugin lifecycle runs here too.
  //
  // This branch used to mount the agent without ever consulting the runner, so `onRequest`,
  // `onResponse` and `onError` fired for every OTHER route and never for an agent turn — leaving an
  // app embedding TheoKit with no supported place to observe or bound agent state. Reported with a repro
  // by a consumer who found it by instrumenting a hook and watching it stay silent — the failure is
  // invisible by construction, since a hook that never runs looks exactly like one with nothing to
  // say.
  //
  // Mirrors `executeRoute`'s shape deliberately: same `PluginContext`, same short-circuit contract,
  // same `onError` on the failure path — an agent route should not have a lifecycle of its own.
  let pluginCtx: PluginContext | undefined
  let request: Request

  // Built before the conversion below, for the same reason the approve branch does it: the
  // application's `createContext` is handed the Node `req`, and `incomingMessageToWebRequest`
  // drains that stream (theokit#400).
  const resolveSubject = agentSubjectResolver(c)

  try {
    request = incomingMessageToWebRequest(c.req)
    pluginCtx = { request, response: c.res, ctx: {}, requestId: c.requestId }
  } catch (err) {
    // A request the adapter cannot represent is a 500, exactly as before this branch grew a
    // lifecycle — the conversion used to sit inside the try below and this preserves that.
    sendError(
      c.res,
      'INTERNAL',
      err instanceof Error ? err.message : 'Agent handler failed',
      500,
      undefined,
      c.requestId,
    )
    logRequest({
      method,
      url: c.url,
      status: c.res.statusCode,
      duration: Date.now() - c.startTime,
      requestId: c.requestId,
    })

    return
  }

  if (c.pluginRunner) {
    c.pluginRunner.applyDecorations(pluginCtx.ctx)
    const onRequest = await c.pluginRunner.runOnRequest(pluginCtx)
    if (onRequest.shortCircuited) {
      logRequest({
        method,
        url: c.url,
        status: c.res.statusCode,
        duration: Date.now() - c.startTime,
        requestId: c.requestId,
      })
      return
    }
  }

  try {
    const mod = await c.loadModule(agent.filePath)
    // theokit#326 — resolve against the model the agent declares, not by env priority.
    const apiKey = (model: string | undefined): string => resolveProvider(model).apiKey
    const response = await mountAgent(mod, request, apiKey, {
      source: agent.filePath,
      csrfMode: c.csrfMode,
      projectRoot: c.projectRoot,
      // usetheokit/theokit#365 — the policy is read off `mod` inside `mountAgent`; what this
      // caller owes is the identity to judge it against.
      agentName: agent.name,
      resolveSubject,
    })
    await writeWebResponseToServerResponse(response, c.res)
  } catch (err) {
    if (c.pluginRunner) await c.pluginRunner.runOnError(pluginCtx, err)
    sendError(
      c.res,
      'INTERNAL',
      err instanceof Error ? err.message : 'Agent handler failed',
      500,
      undefined,
      c.requestId,
    )
  }

  // After the response is written, as `executeRoute` does — a hook here observes a completed turn.
  if (c.pluginRunner) await c.pluginRunner.runOnResponse(pluginCtx)
  logRequest({
    method,
    url: c.url,
    status: c.res.statusCode,
    duration: Date.now() - c.startTime,
    requestId: c.requestId,
  })
}

/** Branch 2: API routes (`/api/*` excluding actions). */
export async function tryServeApiRoute(c: RequestHandlerCtx): Promise<boolean> {
  if (!c.url.startsWith('/api/')) return false
  c.res.setHeader(X_REQUEST_ID, c.requestId)

  if (await applyRateLimit(c, c.req.method ?? 'GET')) return true

  const match = matchRoute(c.url, c.cachedRoutes)
  if (!match) {
    // theokit#123 — controller fall-through, mirroring the dev `api-middleware` arm.
    //
    // Before this, `theokit dev` served a decorator controller and `theokit start` 404'd it: the
    // production path has no Vite/swc transform, so an uncompiled `.controller.ts` could not load.
    // `theokit build` now emits compiled modules and this branch serves them, so the SAME app
    // answers the same routes in both. Reached only after a file-route miss, so file routes keep
    // precedence exactly as in dev.
    if (c.controllersDistDir !== undefined) {
      const handled = await dispatchControllerRequest({
        controllersDir: c.controllersDistDir,
        loadModule: loadCompiledController,
        req: c.req,
        res: c.res,
        csrfMode: c.csrfMode,
        disallowed: c.disallowed,
        requestId: c.requestId,
      })
      if (handled) return true
    }
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
