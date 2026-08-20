/**
 * M2 (theokit-ai-first) — dev middleware for the `agents/<name>.ts` convention.
 *
 * Serves `POST /api/agents/<name>` in `theokit dev` by scanning the top-level `agents/`
 * directory on each request, loading the matched module via Vite's SSR loader, and
 * streaming the M0/M1 UIMessageStream through `mountAgent` — the SAME wiring point the
 * prod server uses (`start/handlers.ts` `tryServeAgent`), so dev and build never drift.
 *
 * Registered under the reserved `/api/agents/` prefix BEFORE the generic api-middleware
 * (mirrors how the action middleware owns `/api/__actions/`); an unmatched agent path
 * falls through to `next()` so the api-middleware can 404 it consistently.
 */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { ViteDevServer, Connect } from 'vite'

import { readAgentPolicy } from '../server/agent/agent-access.js'
import { isAgentCardPath } from '../server/agent/agent-card-handler.js'
import { getApprovalRegistry } from '../server/agent/approval-registry.js'
import {
  handleAgentApproval,
  isApprovalPath,
  parseApprovalAgentName,
} from '../server/agent/approve-agent.js'
import { isListApprovalsPath } from '../server/agent/list-approvals-handler.js'
import { isMcpPath } from '../server/agent/mcp-handler.js'
import { mountAgent } from '../server/agent/mount-agent.js'
import { resolveProvider } from '../server/agent/provider-resolver.js'
import { serveAgentAuxRoute } from '../server/agent/serve-aux-routes.js'
import { createWebRequestSource } from '../server/http/node-request.js'
import {
  incomingMessageToWebRequest,
  writeWebResponseToServerResponse,
} from '../server/http/node-web-adapter.js'
import { createAgentSubjectResolver } from '../server/http/resolve-agent-subject.js'
import {
  createViteLoader,
  logRequest,
  scanAgents,
  sendError,
  type CsrfMode,
} from '../server/internal-api.js'
import type { PluginContext } from '../server/plugin-types.js'
import type { PluginRunner } from '../server/plugins/plugin-runner.js'

const PREFIX = '/api/agents/'

/**
 * M15 — serve `/.well-known/<name>/agent-card.json` (GET) if the request matches. Returns `true`
 * when it owned the request (responded or fell through to `next()`), `false` to let the caller
 * continue. Extracted from the middleware arrow to keep that function within the complexity budget.
 */
interface CardDeps {
  projectRoot: string
  loadModule: (filePath: string) => Promise<Record<string, unknown>>
  agentsDir: string
  /** M34 (#97) — CSRF mode threaded to the MCP aux route (which drives the agent → spends tokens). */
  csrfMode: CsrfMode
  /**
   * The app's `server/` directory — where `context.ts` establishes who is asking
   * (usetheokit/theokit#365). Absent ⇒ no identity is resolvable, and an agent that declares a
   * policy refuses, which is the correct direction for a missing wiring.
   */
  serverDir?: string
  pluginRunner?: PluginRunner
}

/** M4 — serve the HITL approve route `/api/agents/<name>/approve/<id>` (already matched). */
async function serveApprove(
  req: Connect.IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: CardDeps,
  log: { requestId: string; start: number },
): Promise<void> {
  const method = (req.method ?? 'POST').toUpperCase()
  if (method !== 'POST') {
    sendError(
      res,
      'METHOD_NOT_ALLOWED',
      'Approve endpoints accept POST',
      405,
      undefined,
      log.requestId,
    )
    logRequest({
      method,
      url: req.url ?? '',
      status: 405,
      duration: Date.now() - log.start,
      requestId: log.requestId,
    })
    return
  }
  try {
    // usetheokit/theokit#365 — parity with `theokit start`: the approve route settles a paused
    // tool, so it answers to the named agent's declared policy. Resolved before the conversion
    // drains the Node request.
    const agent = scanAgents(deps.projectRoot, deps.agentsDir).find(
      (a) => a.name === parseApprovalAgentName(urlPath),
    )
    const resolveSubject = createAgentSubjectResolver({
      req,
      res,
      loadModule: deps.loadModule,
      serverDir: deps.serverDir,
      pluginRunner: deps.pluginRunner,
    })
    const policy =
      agent === undefined
        ? undefined
        : readAgentPolicy(await deps.loadModule(agent.filePath), agent.filePath)
    const response = await handleAgentApproval(
      incomingMessageToWebRequest(req),
      urlPath,
      getApprovalRegistry(),
      deps.csrfMode,
      { policy, resolveSubject },
    )
    await writeWebResponseToServerResponse(response, res)
  } catch (err) {
    sendError(
      res,
      'INTERNAL',
      err instanceof Error ? err.message : 'Approve handler failed',
      500,
      undefined,
      log.requestId,
    )
  }
  logRequest({
    method,
    url: req.url ?? '',
    status: res.statusCode,
    duration: Date.now() - log.start,
    requestId: log.requestId,
  })
}

/**
 * M15/M16/M14 — serve an agent AUXILIARY route (agent card / MCP / pending-approvals listing) via
 * the shared `serveAgentAuxRoute` dispatcher (the SAME one `theokit start`'s `tryServeAgentAux`
 * uses, so dev and prod never drift). Falls through to `next()` when the path is not an aux route,
 * the method is wrong, or the agent is unknown.
 */
async function serveAux(
  req: Connect.IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
  urlPath: string,
  deps: CardDeps,
): Promise<void> {
  const requestId = randomUUID()
  const start = Date.now()
  try {
    const response = await serveAgentAuxRoute(createWebRequestSource(req), urlPath, {
      agents: scanAgents(deps.projectRoot, deps.agentsDir),
      loadModule: deps.loadModule,
      baseUrl: `http://${req.headers.host ?? 'localhost'}`,
      csrfMode: deps.csrfMode,
      // M39 — the thread follow-up route drives the agent; resolve the key on demand.
      // theokit#328 — the thread route drives an agent, so its key follows the model too.
      resolveApiKey: (model) => resolveProvider(model).apiKey,
      // usetheokit/theokit#365 — parity with `theokit start`; lazy for the same reason.
      resolveSubject: createAgentSubjectResolver({
        req,
        res,
        loadModule: deps.loadModule,
        serverDir: deps.serverDir,
        pluginRunner: deps.pluginRunner,
      }),
    })
    if (response === null) {
      next()
      return
    }
    res.setHeader('x-request-id', requestId)
    await writeWebResponseToServerResponse(response, res)
  } catch (err) {
    res.setHeader('x-request-id', requestId)
    sendError(
      res,
      'INTERNAL',
      err instanceof Error ? err.message : 'Agent aux handler failed',
      500,
      undefined,
      requestId,
    )
  }
  logRequest({
    method: (req.method ?? 'GET').toUpperCase(),
    url: req.url ?? '',
    status: res.statusCode,
    duration: Date.now() - start,
    requestId,
  })
}

export function createAgentMiddleware(
  vite: ViteDevServer,
  projectRoot: string,
  csrfMode: CsrfMode = 'strict',
  agentsDir = 'agents',
  /**
   * The wiring the agent branch needs from the dev server, grouped rather than appended: a sixth
   * positional parameter would trip `max-params`, and these two are one concern — what the request
   * lifecycle around an agent turn is allowed to see.
   *
   * - `pluginRunner` (theokit#324) — the plugin lifecycle runs for agent turns in dev too, so a
   *   hook that fires in production fires here. Without it `dev` and `start` disagree, which is
   *   the worse bug: a plugin that works locally and silently stops in production.
   * - `serverDir` (usetheokit/theokit#365) — where `server/context.ts` establishes who is asking,
   *   so a policed agent can be reached in dev with the same identity it has in production.
   */
  deps: { pluginRunner?: PluginRunner; serverDir?: string } = {},
): Connect.NextHandleFunction {
  const { pluginRunner, serverDir } = deps
  const loadModule = createViteLoader(vite)
  const cardDeps = (): CardDeps => ({
    projectRoot,
    loadModule,
    agentsDir,
    csrfMode,
    serverDir,
    pluginRunner,
  })
  return (req, res, next) => {
    void (async () => {
      const url = req.url ?? ''

      // M15 — A2A agent card at `/.well-known/<name>/agent-card.json` (GET). The match check is
      // SYNC so a non-card request still calls `next()` synchronously (no `await` before it — a
      // dev-middleware contract some tests rely on); only a real card path enters the async path.
      if (isAgentCardPath(url.split('?')[0]) !== null) {
        await serveAux(req, res, next, url.split('?')[0], cardDeps())
        return
      }

      if (!url.startsWith(PREFIX)) {
        next()
        return
      }

      const requestId = randomUUID()
      const start = Date.now()
      res.setHeader('x-request-id', requestId)

      const urlPath = url.split('?')[0]

      // HITL approve route (`/api/agents/<name>/approve/<id>`, M4) — resolve the pending approval.
      // Branches BEFORE the agent-path exact match (the approve path never equals an `agentPath`).
      // Extracted to keep this arrow within the complexity budget (G6).
      if (isApprovalPath(urlPath)) {
        await serveApprove(req, res, urlPath, cardDeps(), { requestId, start })
        return
      }

      // M14 (list approvals) + M16 (MCP) — both are agent aux routes served by the shared
      // dispatcher. Branch BEFORE the agent exact-match (neither path equals an `agentPath`).
      if (isListApprovalsPath(urlPath) !== null || isMcpPath(urlPath) !== null) {
        await serveAux(req, res, next, urlPath, cardDeps())
        return
      }

      const agent = scanAgents(projectRoot, agentsDir).find((a) => a.agentPath === urlPath)
      if (!agent) {
        // Not a known agent — let the api-middleware own the 404 (single 404 shape).
        next()
        return
      }

      const method = (req.method ?? 'POST').toUpperCase()
      if (method !== 'POST') {
        sendError(
          res,
          'METHOD_NOT_ALLOWED',
          'Agent endpoints accept POST',
          405,
          undefined,
          requestId,
        )
        logRequest({ method, url, status: 405, duration: Date.now() - start, requestId })
        return
      }

      await serveAgentTurn({
        req,
        res,
        agent,
        method,
        url,
        requestId,
        start,
        loadModule,
        csrfMode,
        projectRoot,
        pluginRunner,
        serverDir,
      })
    })()
  }
}

/**
 * Serves one agent turn through the plugin lifecycle — the dev-server twin of
 * `serveAgentTurn` in the production handlers. Extracted so the middleware's request
 * callback stays a router and the turn reads in one piece.
 */
async function serveAgentTurn(t: {
  req: IncomingMessage
  res: ServerResponse
  agent: { filePath: string; name: string }
  method: string
  url: string
  requestId: string
  start: number
  loadModule: (filePath: string) => Promise<Record<string, unknown>>
  csrfMode: CsrfMode
  projectRoot: string
  pluginRunner?: PluginRunner
  serverDir?: string
}): Promise<void> {
  const {
    req,
    res,
    agent,
    method,
    url,
    requestId,
    start,
    loadModule,
    csrfMode,
    projectRoot,
    pluginRunner,
    serverDir,
  } = t
  let pluginCtx: PluginContext | undefined
  let request: Request

  // Before the conversion below: `createContext` is handed the Node `req`, which
  // `incomingMessageToWebRequest` drains (theokit#400).
  const resolveSubject = createAgentSubjectResolver({
    req,
    res,
    loadModule,
    serverDir,
    pluginRunner,
  })

  try {
    request = incomingMessageToWebRequest(req)
    pluginCtx = { request, response: res, ctx: {}, requestId }
  } catch (err) {
    sendError(
      res,
      'INTERNAL',
      err instanceof Error ? err.message : 'Agent handler failed',
      500,
      undefined,
      requestId,
    )
    logRequest({ method, url, status: res.statusCode, duration: Date.now() - start, requestId })

    return
  }

  if (pluginRunner) {
    pluginRunner.applyDecorations(pluginCtx.ctx)
    const onRequest = await pluginRunner.runOnRequest(pluginCtx)
    if (onRequest.shortCircuited) {
      logRequest({
        method,
        url,
        status: res.statusCode,
        duration: Date.now() - start,
        requestId,
      })

      return
    }
  }

  try {
    const mod = await loadModule(agent.filePath)
    // theokit#326 — resolve against the model the agent declares, not by env priority.
    const apiKey = (model: string | undefined): string => resolveProvider(model).apiKey
    const response = await mountAgent(mod, request, apiKey, {
      source: agent.filePath,
      csrfMode,
      projectRoot,
      // usetheokit/theokit#365 — the policy comes off `mod`; the caller owes the identity.
      agentName: agent.name,
      resolveSubject,
    })
    await writeWebResponseToServerResponse(response, res)
  } catch (err) {
    if (pluginRunner) await pluginRunner.runOnError(pluginCtx, err)
    sendError(
      res,
      'INTERNAL',
      err instanceof Error ? err.message : 'Agent handler failed',
      500,
      undefined,
      requestId,
    )
  }

  if (pluginRunner) await pluginRunner.runOnResponse(pluginCtx)
  logRequest({ method, url, status: res.statusCode, duration: Date.now() - start, requestId })
}
