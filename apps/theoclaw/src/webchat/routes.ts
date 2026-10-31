import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type AgentRouteContext, generateAgentRoutes } from '@theokit/agents/bridge'

import { bearerCheck, MIN_BEARER_TOKEN_LENGTH } from '../control-plane/bearer.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import type { TurnRunner } from '../control-plane/turn.js'
import { createWebchatRun } from './create-run.js'
import { renderPage, WEBCHAT_ASSETS } from './page.js'

export interface WebchatRoutesOptions {
  /** The WebChat token every chat post must carry; at least 32 characters. */
  readonly token: string
  readonly runTurn: TurnRunner
  /** Where the built page assets are (`build:web` writes them). */
  readonly assetsDir: string | URL
}

const ROUTE = '/webchat'
const CHAT_PATH = `${ROUTE}/chat`
const ASSETS_PREFIX = `${ROUTE}/assets/`
const NO_STORE = { 'cache-control': 'no-store' }
/** The components set inline styles, so the page allows them and nothing else from elsewhere. */
const PAGE_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'"
const MISSING_BUNDLE = 'run the build:web script of the theoclaw package\n'
/** The largest chat post accepted, the bound `/control` puts on one frame: a message, not a file. */
export const MAX_CHAT_BODY_BYTES = 65_536

/** Required by the generator's context and never read by it: TheoClaw has one agent, built elsewhere. */
const COMPILED_OPTIONS: AgentRouteContext['compiledOptions'] = { tools: [], agents: {}, stream: true }

function ignore(): void {}

function notFound(): Response {
  return new Response(null, { status: 404, headers: NO_STORE })
}

function tooLarge(): Response {
  return new Response(null, { status: 413, headers: NO_STORE })
}

function unauthorized(): Response {
  return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer', ...NO_STORE } })
}

/** Where an asset is on disk; `name` is one of the two the build writes, never a URL path. */
function assetPath(assetsDir: string | URL, name: keyof typeof WEBCHAT_ASSETS): string {
  return join(typeof assetsDir === 'string' ? assetsDir : fileURLToPath(assetsDir), name)
}

/** The asset's bytes, or `undefined` when the file is not there (the bundle was never built). */
async function readAsset(assetsDir: string | URL, name: keyof typeof WEBCHAT_ASSETS): Promise<Buffer | undefined> {
  try {
    return await readFile(assetPath(assetsDir, name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function isAssetName(name: string): name is keyof typeof WEBCHAT_ASSETS {
  return Object.hasOwn(WEBCHAT_ASSETS, name)
}

/** `GET /webchat`: the shell, or 503 naming the build step when the bundle is missing. */
async function page(assetsDir: string | URL): Promise<Response> {
  const built = await access(assetPath(assetsDir, 'app.js')).then(
    () => true,
    () => false,
  )
  if (!built) {
    return new Response(MISSING_BUNDLE, { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE } })
  }
  return new Response(renderPage(), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP, ...NO_STORE },
  })
}

/** `GET /webchat/assets/<name>`: only the two names the build writes; anything else is 404. */
async function asset(assetsDir: string | URL, name: string): Promise<Response> {
  if (!isAssetName(name)) return notFound()
  const bytes = await readAsset(assetsDir, name)
  if (bytes === undefined) return notFound()
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': WEBCHAT_ASSETS[name], 'x-content-type-options': 'nosniff', ...NO_STORE },
  })
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
 * The post's body, read up to `MAX_CHAT_BODY_BYTES` and no further, or `undefined` past it. Read
 * from the stream rather than trusted from `content-length`, which a chunked post does not send.
 */
async function boundedBody(request: Request): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (request.body === null) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength
    if (size > MAX_CHAT_BODY_BYTES) {
      reader.cancel().catch(ignore)
      return undefined
    }
    chunks.push(read.value)
  }
  return new Uint8Array(Buffer.concat(chunks))
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
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'no-store')
  const body = response.body === null ? null : relay(response.body, stopTurn)
  return new Response(body, { status: response.status, headers })
}

/**
 * The `/webchat` routes: the page, its two assets and the chat post. A chat post is refused 401
 * before anything is parsed and before any agent exists unless it carries the WebChat token, and 413
 * when its body passes `MAX_CHAT_BODY_BYTES`; the generator then answers 400 for a body with no
 * `message`, also before any agent exists. Every other method or path under `/webchat` is 404, and
 * every answer carries `cache-control: no-store`. A token below the bearer minimum is refused here,
 * at the gate's owner, and not only by whoever read it from the environment.
 */
export function createWebchatRoutes(options: WebchatRoutesOptions): (request: Request) => Promise<Response> {
  if (options.token.length < MIN_BEARER_TOKEN_LENGTH) {
    throw new TheoClawConfigError(`THEOCLAW_WEBCHAT_TOKEN must be at least ${MIN_BEARER_TOKEN_LENGTH} characters`, {
      variable: 'THEOCLAW_WEBCHAT_TOKEN',
    })
  }
  const accepts = bearerCheck(options.token)
  return async (request) => {
    const { pathname } = new URL(request.url)
    if (request.method === 'GET' && pathname === ROUTE) return page(options.assetsDir)
    if (request.method === 'GET' && pathname.startsWith(ASSETS_PREFIX)) {
      return asset(options.assetsDir, pathname.slice(ASSETS_PREFIX.length))
    }
    if (pathname !== CHAT_PATH || request.method !== 'POST') return notFound()
    if (!accepts(request.headers.get('authorization') ?? undefined)) return unauthorized()
    const body = await boundedBody(request)
    if (body === undefined) return tooLarge()
    const bounded = new Request(request.url, { method: 'POST', headers: request.headers, body, signal: request.signal })
    return chat(bounded, options.runTurn)
  }
}
