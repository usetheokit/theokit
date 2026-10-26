import { type AgentRouteContext, generateAgentRoutes } from '@theokit/agents/bridge'

import { bearerCheck } from '../control-plane/bearer.js'
import type { TurnRunner } from '../control-plane/turn.js'
import { createWebchatRun } from './create-run.js'

export interface WebchatRoutesOptions {
  /** The WebChat token every chat post must carry; at least 32 characters. */
  readonly token: string
  readonly runTurn: TurnRunner
  /** Where the built page assets are (`build:web` writes them). */
  readonly assetsDir: string | URL
}

const ROUTE = '/webchat'
const CHAT_PATH = `${ROUTE}/chat`

/** Required by the generator's context and never read by it: TheoClaw has one agent, built elsewhere. */
const COMPILED_OPTIONS: AgentRouteContext['compiledOptions'] = { tools: [], agents: {}, stream: true }

function ignore(): void {}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } })
}

function unauthorized(): Response {
  return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer', 'cache-control': 'no-store' } })
}

/**
 * The generator's body, relayed chunk for chunk. Its `cancel` stops the turn first and only then
 * cancels the inner body, without waiting on it: the inner body reaches the turn through an async
 * generator's `return()`, which waits behind a read pending on a silent model (plan T3.1). The relay
 * writes no frame of its own.
 */
function relay(body: ReadableStream<Uint8Array>, stopTurn: () => void): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) controller.close()
        else controller.enqueue(value)
      } catch (error) {
        // The generator's body failed: nobody will read the turn's events, so the turn stops too.
        stopTurn()
        controller.error(error)
      }
    },
    cancel(reason) {
      stopTurn()
      reader.cancel(reason).catch(ignore)
    },
  })
}

/**
 * One chat post: the generator's handler, built per request so this request's signal reaches its
 * own turn. A client that leaves (the listener aborts `request.signal`) or a cancelled body stops
 * the turn.
 */
async function chat(request: Request, runTurn: TurnRunner): Promise<Response> {
  const turn = new AbortController()
  const stopTurn = (): void => turn.abort()
  if (request.signal.aborted) stopTurn()
  else request.signal.addEventListener('abort', stopTurn, { once: true })
  const routes = generateAgentRoutes({
    walkResult: { route: ROUTE },
    compiledOptions: COMPILED_OPTIONS,
    createRun: createWebchatRun(runTurn, turn.signal),
  })
  const post = routes.find((route) => route.method === 'POST' && route.path === CHAT_PATH)
  if (post === undefined) throw new Error(`generateAgentRoutes returned no POST ${CHAT_PATH}`)
  const response = await post.handler(request)
  if (response.body === null) return response
  return new Response(relay(response.body, stopTurn), { status: response.status, headers: response.headers })
}

/**
 * The `/webchat` routes. A chat post is refused 401 before anything is parsed and before any agent
 * exists unless it carries the WebChat token; the generator then answers 400 for a body with no
 * `message`, also before any agent exists.
 */
export function createWebchatRoutes(options: WebchatRoutesOptions): (request: Request) => Promise<Response> {
  const accepts = bearerCheck(options.token)
  return async (request) => {
    const { pathname } = new URL(request.url)
    if (pathname !== CHAT_PATH || request.method !== 'POST') return notFound()
    if (!accepts(request.headers.get('authorization') ?? undefined)) return unauthorized()
    return chat(request, options.runTurn)
  }
}
