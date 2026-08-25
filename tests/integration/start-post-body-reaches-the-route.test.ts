/**
 * theokit#400 — a `POST` carrying a JSON body reaches its `/api` file route under `theokit start`.
 *
 * ## What hung, and why nothing in the suite noticed
 *
 * `createRequestHandler` dispatches every request through `tryServeAgentAux` before the API branch.
 * That branch used to build a Web `Request` from the Node `IncomingMessage` FIRST and only then ask
 * `serveAgentAuxRoute` whether it owned the path. Building the Request wraps the Node readable with
 * `Readable.toWeb()`, which puts it in flowing mode and drains it. For the ~all requests the aux
 * dispatcher does not own, the branch returned `false` having already eaten the body; the API branch
 * then reached `parseJsonBody`, attached an `'end'` listener to a stream that had already ended, and
 * waited for an event that can never fire again. No status, no error, no timeout — the socket just
 * stayed open.
 *
 * Every existing route test calls `executeRoute` (or the Web executor) directly, so none of them
 * ever crosses the branch that consumes the body. That is why a green suite coexisted with a
 * production server that could not answer the most ordinary request an application makes.
 *
 * ## Why this test boots a server instead of calling the executor
 *
 * The defect lives BETWEEN two layers, in the order they run. A test that calls `executeRoute` with
 * a hand-made request proves the executor works and proves nothing about whether it is reachable.
 * So this boots the real `createRequestHandler` on a real `node:http` listener and sends a real
 * `POST` over TCP: the body is a genuine socket stream that can be drained exactly once, which is
 * the property the defect turned on. A fixture "body" built from a string cannot disagree with the
 * code, because it can be read as many times as anyone likes (B-022).
 *
 * ## Why the server carries a plugin
 *
 * The drain and the parse RACE, and whoever attaches to the Node stream before its first `'data'`
 * emission wins: both listeners receive the chunks, so a parser that attaches inside the same tick
 * survives, and one that attaches after any event-loop turn hangs. Measured here before the fix: the
 * first request hung (cold `import()` of the route module is real I/O) while a second one, with the
 * module already cached, answered — the same defect, decided by luck. Production always has such a
 * turn (module load, middleware, auth hook, a session read), so the server under test installs the
 * smallest realistic one — a plugin whose `onRequest` yields once — and the failure becomes what it
 * is in production: deterministic, not order-dependent.
 *
 * ## Every request here is bounded
 *
 * The failure mode is a hang, so an unbounded request would hang the suite along with the server and
 * report a 30 s file timeout instead of a defect. Each fetch carries `AbortSignal.timeout`, so a
 * regression fails as "no response in 2000 ms" — the shape of the actual bug — in about two seconds.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { defineAgent } from '../../packages/agents/src/bridge/define-agent.js'
import { createRequestHandler } from '../../packages/theo/src/cli/commands/start/request-handler.js'
import type { RequestHandlerCtx } from '../../packages/theo/src/cli/commands/start/handlers.js'
import type { TheoApp } from '../../packages/theo/src/server/plugin-types.js'
import { createPluginRunnerFromConfig } from '../../packages/theo/src/server/plugins/load-plugins.js'
import { compilePattern } from '../../packages/theo/src/server/scan/match.js'
import type { ServerRouteNode } from '../../packages/theo/src/server/scan/match.js'
import { createProductionLoader } from '../../packages/theo/src/server/scan/module-loader.js'
import type { AgentNode } from '../../packages/theo/src/server/scan/agent-scan.js'

/** The scaffold's first route, verbatim in shape: a POST that reads `body` and answers JSON. */
const PROBE_ROUTE = `
export const POST = {
  handler: ({ body }) => ({ ok: true, echo: body }),
}
`

/**
 * The same POST, read the way a MOUNTED LIBRARY reads it: off the Web `Request`, not off the
 * parsed `body` the framework hands alongside it.
 *
 * This is a different property from the one above and nothing asserted it. `ctx.body` arriving
 * does not imply `ctx.request` still carries the bytes — the executor parses the Node stream, and
 * a Request rebuilt without them reports `body: null` while `bodyUsed` stays `false`, which is a
 * Request that misreports its own state.
 *
 * It matters because handing back handlers is a published pattern rather than a curiosity:
 * `@theokit/plugin-canvas`'s `createArtifactRouteHandlers` says in its own docblock that it
 * returns handlers "for the application to mount" precisely because a plugin cannot register a
 * route, and `handleChannelWebhook` — the seam for Telegram, Slack and Discord — is the same
 * shape. Both take a `Request` and read it themselves.
 */
const READS_THE_REQUEST_ROUTE = `
export const POST = {
  handler: async ({ request }) => {
    const text = await request.text()
    return {
      bodyIsNull: request.body === null,
      bodyUsedBeforeRead: false,
      text,
      parsed: text.length > 0 ? JSON.parse(text) : null,
    }
  },
}
`

/** How long a request may take before we call it a hang. The passing path answers in single digits. */
const RESPONSE_BUDGET_MS = 2000

let server: Server | undefined
let projectRoot: string
let origin: string

/** The one agent the aux dispatcher DOES own a path for — so the fix can be shown not to starve it. */
const AGENTS: AgentNode[] = [
  { name: 'support', filePath: '/agents/support.mjs', agentPath: '/api/agents/support' },
]

/**
 * Boot the production request handler on a real listener.
 *
 * The route module is a real file on disk loaded by the real `createProductionLoader`. The agent
 * module is supplied in memory: `loadModule` is a declared dependency of the production context
 * (dev injects Vite's loader, prod injects the dynamic import), and what this test needs to observe
 * is whether the aux dispatcher receives a body — not how its module got compiled.
 */
async function startProductionServer(): Promise<void> {
  projectRoot = await mkdtemp(join(tmpdir(), 'tk400-'))
  const routeFile = join(projectRoot, 'probe.route.mjs')
  await writeFile(routeFile, PROBE_ROUTE, 'utf8')
  const readsRequestFile = join(projectRoot, 'reads-request.route.mjs')
  await writeFile(readsRequestFile, READS_THE_REQUEST_ROUTE, 'utf8')

  const { pattern, paramNames } = compilePattern('/api/probe')
  const readsRequest = compilePattern('/api/reads-request')
  const routes: ServerRouteNode[] = [
    { filePath: routeFile, routePath: '/api/probe', pattern, paramNames, methods: ['POST'] },
    {
      filePath: readsRequestFile,
      routePath: '/api/reads-request',
      pattern: readsRequest.pattern,
      paramNames: readsRequest.paramNames,
      methods: ['POST'],
    },
  ]

  // One event-loop turn between the aux branch and the body parser — see the header. Any real app
  // has one; this is the smallest honest stand-in, wired through the production plugin runner.
  const pluginRunner = await createPluginRunnerFromConfig([
    {
      name: 'yields-once',
      register(app: TheoApp) {
        app.addHook('onRequest', async () => {
          await new Promise<void>((resolve) => setImmediate(resolve))
        })
      },
    },
  ])

  const loadRoute = createProductionLoader()
  const loadModule = async (filePath: string): Promise<Record<string, unknown>> =>
    filePath === AGENTS[0].filePath
      ? { default: defineAgent({ model: 'claude-sonnet-4-6', tools: [] }), mcp: true }
      : await loadRoute(filePath)

  const running = createServer(
    createRequestHandler({
      buildCtx: (req, res, requestId, startTime): RequestHandlerCtx => ({
        req,
        res,
        url: req.url ?? '/',
        requestId,
        startTime,
        clientDir: projectRoot,
        custom404Html: null,
        cachedRoutes: routes,
        cachedActions: [],
        cachedAgents: AGENTS,
        loadModule,
        serverDir: projectRoot,
        projectRoot,
        controllersDistDir: undefined,
        pluginRunner,
        transformer: undefined,
        csrfMode: 'strict',
        disallowed: undefined,
        rateLimiter: null,
      }),
      securityHeadersConfig: {},
      // #409 made this required rather than optional: the defect was that nobody wired
      // CORS into this handler, and an optional field is one a new call site can forget
      // the same way. `null` is this test's answer — it exercises no cross-origin path.
      corsHandler: null,
      ssrRender: null,
      ssrRenderStreaming: null,
      ssrStreamingEnabled: false,
      htmlHead: '',
      htmlTail: '',
      indexHtml: '<!doctype html><html></html>',
      custom500Html: null,
    }),
  )
  server = running
  await new Promise<void>((resolve) => running.listen(0, '127.0.0.1', resolve))
  const { port } = running.address() as AddressInfo
  origin = `http://127.0.0.1:${String(port)}`
}

/**
 * POST `body` as JSON, bounded. Resolves `{ status, json, ms }`, or reports the hang by name.
 *
 * The CSRF headers are the ones the reproduction in theokit#400 used (`x-theo-action` plus a
 * same-origin `Origin`) — `csrfMode` is `'strict'` here, as it is in a scaffolded app.
 */
async function postJson(
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown; ms: number }> {
  const started = Date.now()
  let response: Response
  try {
    response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-theo-action': '1',
        origin,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RESPONSE_BUDGET_MS),
    })
  } catch (err) {
    const elapsed = Date.now() - started
    throw new Error(
      `POST ${path} produced no response within ${String(RESPONSE_BUDGET_MS)} ms ` +
        `(gave up after ${String(elapsed)} ms): ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const json: unknown = await response.json()
  return { status: response.status, json, ms: Date.now() - started }
}

beforeAll(async () => {
  await startProductionServer()
})

afterAll(async () => {
  const running = server
  server = undefined
  if (running) await new Promise<void>((resolve) => running.close(() => resolve()))
  await rm(projectRoot, { recursive: true, force: true })
})

describe('theokit start — a POST body survives the dispatch chain', () => {
  it('test_a_post_with_a_json_body_to_an_api_file_route_answers_with_the_body_it_was_sent', async () => {
    const { status, json, ms } = await postJson('/api/probe', { a: 1 })

    expect(status).toBe(200)
    // The echo is what proves the body ARRIVED, not merely that a response did: a fix that
    // unblocked the parser by handing the handler an empty body would pass a status assertion.
    expect(json).toEqual({ ok: true, echo: { a: 1 } })
    expect(ms).toBeLessThan(RESPONSE_BUDGET_MS)
  })

  it('test_a_second_post_on_the_same_server_is_not_poisoned_by_the_first', async () => {
    // A per-request stream defect can also look like "the first one works" — or like "only the
    // first one works", which is what the cold/warm race produced here. Two in a row, both with
    // bodies, on one listener.
    await postJson('/api/probe', { a: 1 })
    const { status, json } = await postJson('/api/probe', { b: 2 })

    expect(status).toBe(200)
    expect(json).toEqual({ ok: true, echo: { b: 2 } })
  })

  it('test_an_aux_route_the_dispatcher_does_own_still_receives_its_body', async () => {
    // The other half of the fix: deferring the conversion must not starve the routes that need it.
    // `tools/list` is answered from the request body's JSON-RPC `method`, so a lost body would come
    // back as the -32600 "Invalid Request" envelope instead of a result.
    const { status, json } = await postJson('/api/agents/support/mcp', {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/list',
    })

    expect(status).toBe(200)
    expect(json).toMatchObject({ jsonrpc: '2.0', id: 7 })
    expect(json).not.toMatchObject({ error: { code: -32600 } })
  })

  it('test_a_handler_that_reads_the_request_itself_gets_the_bytes_it_was_sent', async () => {
    // The property a MOUNTED library depends on, which `echo: body` above does not cover: a
    // handler reading `request` rather than `body` must find the bytes there.
    //
    // Before usetheokit/theokit#445 this answered `body: null` and an empty string — while
    // `bodyUsed` stayed `false`, so a caller asking whether the body was still available was told
    // yes and then handed nothing. `@theokit/plugin-canvas` reported `INVALID_BODY` for a valid
    // JSON body on exactly this path, in a real app, which is how it was found again.
    const { status, json } = await postJson('/api/reads-request', { a: 1, nested: { b: 2 } })

    expect(status).toBe(200)
    expect(json).toMatchObject({ bodyIsNull: false, parsed: { a: 1, nested: { b: 2 } } })
    // The exact bytes, not a re-serialisation: a signature check computes over what arrived.
    expect((json as { text: string }).text).toBe(JSON.stringify({ a: 1, nested: { b: 2 } }))
  })

  it('test_a_post_to_an_unknown_api_route_still_reports_a_404_rather_than_hanging', async () => {
    const { status } = await postJson('/api/nothing-here', { a: 1 })

    expect(status).toBe(404)
  })
})
