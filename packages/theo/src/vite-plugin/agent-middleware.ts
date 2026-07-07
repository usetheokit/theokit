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

import { handleAgentCard, isAgentCardPath } from '../server/agent/agent-card-handler.js'
import { getApprovalRegistry } from '../server/agent/approval-registry.js'
import { handleAgentApproval, isApprovalPath } from '../server/agent/approve-agent.js'
import { handleListApprovals, isListApprovalsPath } from '../server/agent/list-approvals-handler.js'
import { handleMcpJsonRpc, isMcpPath } from '../server/agent/mcp-handler.js'
import { mountAgent } from '../server/agent/mount-agent.js'
import { resolveProvider } from '../server/agent/provider-resolver.js'
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
    sendError(res, 'METHOD_NOT_ALLOWED', 'Approve endpoints accept POST', 405, undefined, log.requestId)
    logRequest({ method, url: req.url ?? '', status: 405, duration: Date.now() - log.start, requestId: log.requestId })
    return
  }
  try {
    const response = await handleAgentApproval(incomingMessageToWebRequest(req), urlPath, getApprovalRegistry(), csrfMode)
    await writeWebResponseToServerResponse(response, res)
  } catch (err) {
    sendError(res, 'INTERNAL', err instanceof Error ? err.message : 'Approve handler failed', 500, undefined, log.requestId)
  }
  logRequest({ method, url: req.url ?? '', status: res.statusCode, duration: Date.now() - log.start, requestId: log.requestId })
}

/** M16 — serve `POST /api/agents/<name>/mcp` (JSON-RPC), already matched by the caller. */
async function serveMcp(
  req: Connect.IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
  mcpAgentName: string,
  deps: CardDeps,
): Promise<void> {
  const requestId = randomUUID()
  const start = Date.now()
  res.setHeader('x-request-id', requestId)
  const method = (req.method ?? 'POST').toUpperCase()
  const agent = scanAgents(deps.projectRoot).find((a) => a.name === mcpAgentName)
  if (method !== 'POST' || !agent) {
    next()
    return
  }
  try {
    const body: unknown = await incomingMessageToWebRequest(req).json()
    const mod = await deps.loadModule(agent.filePath)
    await writeWebResponseToServerResponse(handleMcpJsonRpc(mod, agent.name, body), res)
  } catch (err) {
    sendError(res, 'INTERNAL', err instanceof Error ? err.message : 'MCP handler failed', 500, undefined, requestId)
  }
  logRequest({ method, url: req.url ?? '', status: res.statusCode, duration: Date.now() - start, requestId })
}

/** M14 — serve `GET /api/agents/<name>/approvals` (already matched by the caller). */
async function serveListApprovals(
  req: Connect.IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
  log: { requestId: string; start: number },
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase()
  if (method !== 'GET') {
    next()
    return
  }
  await writeWebResponseToServerResponse(handleListApprovals(getApprovalRegistry()), res)
  logRequest({
    method,
    url: req.url ?? '',
    status: res.statusCode,
    duration: Date.now() - log.start,
    requestId: log.requestId,
  })
}

async function serveAgentCard(
  req: Connect.IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
  cardAgentName: string,
  deps: CardDeps,
): Promise<void> {
  const requestId = randomUUID()
  const start = Date.now()
  res.setHeader('x-request-id', requestId)
  const method = (req.method ?? 'GET').toUpperCase()
  const agent = scanAgents(deps.projectRoot).find((a) => a.name === cardAgentName)
  if (method !== 'GET' || !agent) {
    next()
    return
  }
  try {
    const mod = await deps.loadModule(agent.filePath)
    const baseUrl = `http://${req.headers.host ?? 'localhost'}`
    await writeWebResponseToServerResponse(handleAgentCard(mod, agent.name, agent.agentPath, baseUrl), res)
  } catch (err) {
    sendError(res, 'INTERNAL', err instanceof Error ? err.message : 'Agent card failed', 500, undefined, requestId)
  }
  logRequest({ method, url: req.url ?? '', status: res.statusCode, duration: Date.now() - start, requestId })
}

export function createAgentMiddleware(
  vite: ViteDevServer,
  projectRoot: string,
  csrfMode: CsrfMode = 'strict',
): Connect.NextHandleFunction {
  const loadModule = createViteLoader(vite)
  return (req, res, next) => {
    void (async () => {
      const url = req.url ?? ''

      // M15 — A2A agent card at `/.well-known/<name>/agent-card.json` (GET). The match check is
      // SYNC so a non-card request still calls `next()` synchronously (no `await` before it — a
      // dev-middleware contract some tests rely on); only a real card path enters the async path.
      const cardAgentName = isAgentCardPath(url.split('?')[0])
      if (cardAgentName) {
        await serveAgentCard(req, res, next, cardAgentName, { projectRoot, loadModule })
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

      // M14 — GET /api/agents/<name>/approvals lists pending HITL approvals. Branches BEFORE the
      // agent exact-match (the listing path never equals an `agentPath`). Sync match; extracted
      // serving keeps this arrow within the complexity budget (G6).
      if (isListApprovalsPath(urlPath)) {
        await serveListApprovals(req, res, next, { requestId, start })
        return
      }

      // M16 — POST /api/agents/<name>/mcp exposes the agent as an MCP server (JSON-RPC).
      const mcpAgentName = isMcpPath(urlPath)
      if (mcpAgentName) {
        await serveMcp(req, res, next, mcpAgentName, { projectRoot, loadModule })
        return
      }

      const agent = scanAgents(projectRoot).find((a) => a.agentPath === urlPath)
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
