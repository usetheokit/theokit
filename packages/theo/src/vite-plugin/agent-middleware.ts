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
import type { ServerResponse } from 'node:http'

import type { ViteDevServer, Connect } from 'vite'

import { isAgentCardPath } from '../server/agent/agent-card-handler.js'
import { getApprovalRegistry } from '../server/agent/approval-registry.js'
import { handleAgentApproval, isApprovalPath } from '../server/agent/approve-agent.js'
import { isListApprovalsPath } from '../server/agent/list-approvals-handler.js'
import { isMcpPath } from '../server/agent/mcp-handler.js'
import { mountAgent } from '../server/agent/mount-agent.js'
import { resolveProvider } from '../server/agent/provider-resolver.js'
import { serveAgentAuxRoute } from '../server/agent/serve-aux-routes.js'
import {
  incomingMessageToWebRequest,
  writeWebResponseToServerResponse,
} from '../server/http/node-web-adapter.js'
import {
  createViteLoader,
  logRequest,
  scanAgents,
  sendError,
  type CsrfMode,
} from '../server/internal-api.js'

const PREFIX = '/api/agents/'

/**
 * M15 — serve `/.well-known/<name>/agent-card.json` (GET) if the request matches. Returns `true`
 * when it owned the request (responded or fell through to `next()`), `false` to let the caller
 * continue. Extracted from the middleware arrow to keep that function within the complexity budget.
 */
interface CardDeps {
  projectRoot: string
  loadModule: (filePath: string) => Promise<unknown>
  agentsDir: string
  /** M34 (#97) — CSRF mode threaded to the MCP aux route (which drives the agent → spends tokens). */
  csrfMode: CsrfMode
}

/** M4 — serve the HITL approve route `/api/agents/<name>/approve/<id>` (already matched). */
async function serveApprove(
  req: Connect.IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  csrfMode: CsrfMode,
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
    const response = await handleAgentApproval(
      incomingMessageToWebRequest(req),
      urlPath,
      getApprovalRegistry(),
      csrfMode,
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
    const request = incomingMessageToWebRequest(req)
    const response = await serveAgentAuxRoute(request, urlPath, {
      agents: scanAgents(deps.projectRoot, deps.agentsDir),
      loadModule: deps.loadModule,
      baseUrl: `http://${req.headers.host ?? 'localhost'}`,
      csrfMode: deps.csrfMode,
      // M39 — the thread follow-up route drives the agent; resolve the key on demand.
      resolveApiKey: () => resolveProvider().apiKey,
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
): Connect.NextHandleFunction {
  const loadModule = createViteLoader(vite)
  return (req, res, next) => {
    void (async () => {
      const url = req.url ?? ''

      // M15 — A2A agent card at `/.well-known/<name>/agent-card.json` (GET). The match check is
      // SYNC so a non-card request still calls `next()` synchronously (no `await` before it — a
      // dev-middleware contract some tests rely on); only a real card path enters the async path.
      if (isAgentCardPath(url.split('?')[0]) !== null) {
        await serveAux(req, res, next, url.split('?')[0], {
          projectRoot,
          loadModule,
          agentsDir,
          csrfMode,
        })
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
        await serveApprove(req, res, urlPath, csrfMode, { requestId, start })
        return
      }

      // M14 (list approvals) + M16 (MCP) — both are agent aux routes served by the shared
      // dispatcher. Branch BEFORE the agent exact-match (neither path equals an `agentPath`).
      if (isListApprovalsPath(urlPath) !== null || isMcpPath(urlPath) !== null) {
        await serveAux(req, res, next, urlPath, { projectRoot, loadModule, agentsDir, csrfMode })
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

      try {
        const mod = await loadModule(agent.filePath)
        const apiKey = resolveProvider().apiKey
        const request = incomingMessageToWebRequest(req)
        const response = await mountAgent(mod, request, apiKey, agent.filePath, csrfMode)
        await writeWebResponseToServerResponse(response, res)
      } catch (err) {
        sendError(
          res,
          'INTERNAL',
          err instanceof Error ? err.message : 'Agent handler failed',
          500,
          undefined,
          requestId,
        )
      }
      logRequest({ method, url, status: res.statusCode, duration: Date.now() - start, requestId })
    })()
  }
}
