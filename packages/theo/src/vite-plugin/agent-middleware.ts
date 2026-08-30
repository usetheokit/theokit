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
import { mountAgent } from '../server/agent/mount-agent.js'
import { resolveProvider } from '../server/agent/provider-resolver.js'
import { matchAgentAuxRoute, serveMatchedAuxRoute } from '../server/agent/serve-aux-routes.js'
import { createWebRequestSource } from '../server/http/node-request.js'
import { writeWebResponseToServerResponse } from '../server/http/node-web-adapter.js'
import { serveThroughPluginLifecycle } from '../server/http/plugin-lifecycle.js'
import { createAgentSubjectResolver } from '../server/http/resolve-agent-subject.js'
import {
  createViteLoader,
  logRequest,
  scanAgents,
  sendError,
  type CsrfMode,
} from '../server/internal-api.js'
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
  // usetheokit/theokit#405 — parity with `theokit start`: the approve route runs the plugin
  // lifecycle like every other branch, so a hook that fires in production fires here too.
  await serveThroughPluginLifecycle(
    {
      source: createWebRequestSource(req),
      res,
      requestId: log.requestId,
      pluginRunner: deps.pluginRunner,
      failureMessage: 'Approve handler failed',
    },
    async (request) => {
      // usetheokit/theokit#365 — parity with `theokit start`: the approve route settles a paused
      // tool, so it answers to the named agent's declared policy.
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
        request,
        urlPath,
        getApprovalRegistry(),
        deps.csrfMode,
        { policy, resolveSubject },
      )
      await writeWebResponseToServerResponse(response, res)
    },
  )
  logRequest({
    method,
    url: req.url ?? '',
    status: res.statusCode,
    duration: Date.now() - log.start,
    requestId: log.requestId,
  })
}

/**
 * Serve an agent AUXILIARY route through the shared dispatcher — the SAME `matchAgentAuxRoute` /
 * `serveMatchedAuxRoute` pair `theokit start`'s `tryServeAgentAux` uses, so dev and prod never
 * drift. Falls through to `next()` when the path is not an aux route, the method is wrong, or the
 * agent is unknown or did not opt into MCP.
 *
 * usetheokit/theokit#405 — the match runs first and the answer runs inside the plugin lifecycle, so
 * these endpoints emit the same hooks (and therefore the same `http.request` span) as every other
 * branch. Deciding before converting is also what keeps theokit#400 fixed: a url this dispatcher
 * declines never has its Node body stream touched.
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
  const auxDeps = {
    agents: scanAgents(deps.projectRoot, deps.agentsDir),
    loadModule: deps.loadModule,
    baseUrl: `http://${req.headers.host ?? 'localhost'}`,
    csrfMode: deps.csrfMode,
    // M39 — the thread follow-up route drives the agent; resolve the key on demand.
    // theokit#328 — the thread route drives an agent, so its key follows the model too.
    resolveApiKey: (model: string | undefined, plugins?: readonly unknown[]) =>
      resolveProvider(model, { plugins }).apiKey,
    // usetheokit/theokit#365 — parity with `theokit start`; lazy for the same reason.
    resolveSubject: createAgentSubjectResolver({
      req,
      res,
      loadModule: deps.loadModule,
      serverDir: deps.serverDir,
      pluginRunner: deps.pluginRunner,
    }),
  }

  const method = (req.method ?? 'GET').toUpperCase()
  const route = await matchAgentAuxRoute(method, urlPath, auxDeps)
  if (route === null) {
    next()
    return
  }

  res.setHeader('x-request-id', requestId)
  await serveThroughPluginLifecycle(
    {
      source: createWebRequestSource(req),
      res,
      requestId,
      pluginRunner: deps.pluginRunner,
      failureMessage: 'Agent aux handler failed',
    },
    async (request) => {
      await writeWebResponseToServerResponse(
        await serveMatchedAuxRoute(route, request, auxDeps),
        res,
      )
    },
  )
  logRequest({
    method,
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

      const agent = scanAgents(projectRoot, agentsDir).find((a) => a.agentPath === urlPath)
      if (!agent) {
        // Not the plain run route. Offer it to the aux dispatcher, which owns the approvals
        // listing, MCP, the durable run stream and the two thread routes; it calls `next()` when it
        // owns nothing, so the api-middleware still gives a single 404 shape.
        //
        // This used to ask `isListApprovalsPath || isMcpPath` and hand over only those two, so
        // `theokit dev` 404'd four routes `theokit start` served — the durable run-stream reconnect
        // (M37) and both thread routes (M39). A hand-maintained subset of the dispatcher's own
        // table is a drift waiting to happen; asking the table is not.
        await serveAux(req, res, next, urlPath, cardDeps())
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
  // The bracket is `serveThroughPluginLifecycle` — the same one the production handler and the aux
  // and approve branches use (usetheokit/theokit#405). It was copied here from `handlers.ts`, and a
  // copied bracket is how five branches ended up with three different lifecycles.
  const resolveSubject = createAgentSubjectResolver({
    req,
    res,
    loadModule,
    serverDir,
    pluginRunner,
  })

  await serveThroughPluginLifecycle(
    {
      source: createWebRequestSource(req),
      res,
      requestId,
      pluginRunner,
      failureMessage: 'Agent handler failed',
    },
    async (request) => {
      const mod = await loadModule(agent.filePath)
      // theokit#326 — resolve against the model the agent declares, not by env priority.
      const apiKey = (model: string | undefined, plugins?: readonly unknown[]): string =>
        resolveProvider(model, { plugins }).apiKey
      const response = await mountAgent(mod, request, apiKey, {
        source: agent.filePath,
        csrfMode,
        projectRoot,
        // usetheokit/theokit#365 — the policy comes off `mod`; the caller owes the identity.
        // usetheokit/theokit#406 — and the same name labels the run's spans.
        agentName: agent.name,
        resolveSubject,
      })
      await writeWebResponseToServerResponse(response, res)
    },
  )
  logRequest({ method, url, status: res.statusCode, duration: Date.now() - start, requestId })
}
