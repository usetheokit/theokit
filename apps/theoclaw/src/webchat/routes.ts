import { access, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type AgentRouteContext, generateAgentRoutes } from '@theokit/agents/bridge'

import { bearerCheck, MIN_BEARER_TOKEN_LENGTH } from '../control-plane/bearer.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import { MAX_MESSAGE_BYTES } from '../control-plane/limits.js'
import { TRUSTED_IDENTITY_HEADER } from '../control-plane/trusted-proxy.js'
import type { TurnRunner } from '../control-plane/turn.js'
import { chatIdOf, WebchatChatIdError } from './chat-id.js'
import { createWebchatRun } from './create-run.js'
import { renderPage, WEBCHAT_ASSETS } from './page.js'
import {
  WEBCHAT_ASSETS_PREFIX,
  WEBCHAT_CHAT_PATH,
  WEBCHAT_ROUTE,
  WEBCHAT_SANDBOX_PATH,
} from './paths.js'

export interface WebchatRoutesOptions {
  /** The WebChat token every chat post must carry; at least 32 characters. */
  readonly token: string
  /** Trusted-proxy mode is on: a chat post marked by the listener needs no bearer token. */
  readonly trustedProxy?: boolean
  /** Visitor access (OC-143): says whether a proxy-authenticated identity holds an unexpired grant. Default: every identity is let in. */
  readonly visitorAllowed?: (identity: string) => boolean
  /** The turn runner of one chat: its turns share the chat's session agent, and no other chat's. */
  readonly turnFor: (chatId: string) => TurnRunner
  /** Where the built page assets are (`build:web` writes them). */
  readonly assetsDir: string | URL
  /** Where a finished turn's usage line goes (B-400 FR-004). Default: nowhere. */
  readonly write?: (line: string) => void
}

const NO_STORE = { 'cache-control': 'no-store' }
/** The components set inline styles, so the page allows them and nothing else from elsewhere. */
const PAGE_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"
/** The page holds the token in the tab: no framing (clickjacking), no sniffing, no referrer leak. */
const PAGE_HARDENING = {
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}
/**
 * The html-widget frame: its own policy lets inline script run (the page's does not, and a frame can
 * only tighten what it inherits, so the frame is a URL, not srcdoc), with an opaque origin, no network
 * and no navigation. Only the page may frame it.
 */
const SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; sandbox allow-scripts"
const SANDBOX_SHELL =
  '<!doctype html><meta charset="utf-8"><script>addEventListener("message",function(e){if(e.source!==parent)return;if(typeof e.data!=="string")return;document.open();document.write(e.data);document.close()})</script>'
const MISSING_BUNDLE = 'run the build:web script of the theoclaw package\n'

/**
 * Required by the generator's context and never read by it: TheoClaw has one agent, built elsewhere.
 * `webchat-stream.test.ts` pins that the stream does not change with these; B-510 (a per-request hook
 * on the generator) is the follow-up that removes this placeholder and the per-request rebuild.
 */
const COMPILED_OPTIONS: AgentRouteContext['compiledOptions'] = {
  tools: [],
  agents: {},
  stream: true,
}

function ignore(): void {}

function notFound(): Response {
  return new Response(null, { status: 404, headers: NO_STORE })
}

function tooLarge(): Response {
  return new Response(null, { status: 413, headers: NO_STORE })
}

function clientLeft(): Response {
  return new Response(null, { status: 400, headers: NO_STORE })
}

function forbidden(): Response {
  return new Response(null, { status: 403, headers: NO_STORE })
}

function unauthorized(): Response {
  return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer', ...NO_STORE } })
}

/** Where an asset is on disk; `name` is one of the two the build writes, never a URL path. */
function assetPath(assetsDir: string | URL, name: keyof typeof WEBCHAT_ASSETS): string {
  return join(typeof assetsDir === 'string' ? assetsDir : fileURLToPath(assetsDir), name)
}

/** The asset's bytes, or `undefined` when the file is not there (the bundle was never built). */
async function readAsset(
  assetsDir: string | URL,
  name: keyof typeof WEBCHAT_ASSETS,
): Promise<Buffer | undefined> {
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
    return new Response(MISSING_BUNDLE, {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE },
    })
  }
  return new Response(renderPage(), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': PAGE_CSP,
      ...PAGE_HARDENING,
      ...NO_STORE,
    },
  })
}

/** `GET /webchat/sandbox`: the empty frame an html widget is written into. */
function sandbox(): Response {
  return new Response(SANDBOX_SHELL, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': SANDBOX_CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...NO_STORE,
    },
  })
}

/** `GET /webchat/assets/<name>`: only the two names the build writes; anything else is 404. */
async function asset(assetsDir: string | URL, name: string): Promise<Response> {
  if (!isAssetName(name)) return notFound()
  const bytes = await readAsset(assetsDir, name)
  if (bytes === undefined) return notFound()
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': WEBCHAT_ASSETS[name],
      'x-content-type-options': 'nosniff',
      ...NO_STORE,
    },
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
 * The post's body, read up to `MAX_MESSAGE_BYTES` and no further, or `undefined` past it. Read
 * from the stream rather than trusted from `content-length`, which a chunked post does not send.
 * A read that fails while the client is still connected rejects with the stream's error.
 */
async function boundedBody(request: Request): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (request.body === null) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength
    if (size > MAX_MESSAGE_BYTES) {
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
async function chat(
  request: Request,
  rawTurnFor: (chatId: string) => TurnRunner,
  write?: (line: string) => void,
  scope = '',
): Promise<Response> {
  // A signed-in user's chats are keyed under their identity: two users naming one chat id get two sessions.
  const turnFor =
    scope === '' ? rawTurnFor : (chatId: string): TurnRunner => rawTurnFor(`${scope}${chatId}`)
  const turn = new AbortController()
  const stopTurn = (): void => turn.abort()
  if (request.signal.aborted) stopTurn()
  else request.signal.addEventListener('abort', stopTurn, { once: true })
  const routes = generateAgentRoutes({
    walkResult: { route: WEBCHAT_ROUTE },
    compiledOptions: COMPILED_OPTIONS,
    createRun: createWebchatRun(turnFor, turn.signal, write),
  })
  const post = routes.find((route) => route.method === 'POST' && route.path === WEBCHAT_CHAT_PATH)
  if (post === undefined)
    throw new Error(`generateAgentRoutes returned no POST ${WEBCHAT_CHAT_PATH}`)
  const response = await post.handler(request)
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'no-store')
  const body = response.body === null ? null : relay(response.body, stopTurn)
  return new Response(body, { status: response.status, headers })
}

/**
 * The `/webchat` routes: the page, its two assets and the chat post. A chat post is refused 401
 * before anything is parsed and before any agent exists unless it carries the WebChat token, and 413
 * when its body passes `MAX_MESSAGE_BYTES`; the generator then answers 400 for a body with no
 * `message`, also before any agent exists. Every other method or path under `/webchat` is 404, and
 * every answer carries `cache-control: no-store`. A token below the bearer minimum is refused here,
 * at the gate's owner, and not only by whoever read it from the environment.
 */
export function createWebchatRoutes(
  options: WebchatRoutesOptions,
): (request: Request) => Promise<Response> {
  if (options.token.length < MIN_BEARER_TOKEN_LENGTH) {
    throw new TheoClawConfigError(
      `THEOCLAW_WEBCHAT_TOKEN must be at least ${MIN_BEARER_TOKEN_LENGTH} characters`,
      {
        variable: 'THEOCLAW_WEBCHAT_TOKEN',
      },
    )
  }
  const accepts = bearerCheck(options.token)
  return async (request) => {
    const { pathname } = new URL(request.url)
    if (request.method === 'GET' && pathname === WEBCHAT_ROUTE) return page(options.assetsDir)
    if (request.method === 'GET' && pathname === WEBCHAT_SANDBOX_PATH) return sandbox()
    if (request.method === 'GET' && pathname.startsWith(WEBCHAT_ASSETS_PREFIX)) {
      return asset(options.assetsDir, pathname.slice(WEBCHAT_ASSETS_PREFIX.length))
    }
    if (pathname !== WEBCHAT_CHAT_PATH || request.method !== 'POST') return notFound()
    const viaProxy =
      options.trustedProxy === true && (request.headers.get(TRUSTED_IDENTITY_HEADER) ?? '') !== ''
    if (!viaProxy && !accepts(request.headers.get('authorization') ?? undefined))
      return unauthorized()
    if (viaProxy && options.visitorAllowed !== undefined) {
      if (!options.visitorAllowed(request.headers.get(TRUSTED_IDENTITY_HEADER) ?? '')) return forbidden()
    }
    const identity = viaProxy ? (request.headers.get(TRUSTED_IDENTITY_HEADER) ?? '') : ''
    return boundedChat(
      request,
      options.turnFor,
      options.write,
      identity === '' ? '' : userScope(identity),
    )
  }
}

/** The session-key prefix of one proxy-authenticated user: a hash, so the identity never reaches a key or a file name. */
function userScope(identity: string): string {
  return `u${createHash('sha256').update(identity).digest('hex').slice(0, 16)}.`
}

/**
 * A 400 when the post has a message but no valid chat id, before any agent exists; `undefined` for
 * a post to go on. A body with no message is left to the generator's own 400.
 */
function chatIdRefusal(body: Uint8Array): Response | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const fields = parsed as Record<string, unknown>
  if (typeof fields.message !== 'string' || fields.message.length === 0) return undefined
  try {
    chatIdOf(fields)
    return undefined
  } catch (error) {
    if (!(error instanceof WebchatChatIdError)) throw error
    return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
      status: 400,
      headers: { 'content-type': 'application/json', ...NO_STORE },
    })
  }
}

/** An authorized chat post: its body read within the bound, then handed to `chat`. */
async function boundedChat(
  request: Request,
  turnFor: (chatId: string) => TurnRunner,
  write?: (line: string) => void,
  scope = '',
): Promise<Response> {
  const body = await boundedBody(request).catch((error: unknown) => {
    // A client that leaves mid-upload errors the body stream: answer, since the listener would
    // otherwise log "request failed" and write a 500 to a socket that is already gone.
    if (request.signal.aborted) return null
    throw error
  })
  if (body === null) return clientLeft()
  if (body === undefined) return tooLarge()
  const refused = chatIdRefusal(body)
  if (refused !== undefined) return refused
  return chat(
    new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body,
      signal: request.signal,
    }),
    turnFor,
    write,
    scope,
  )
}
