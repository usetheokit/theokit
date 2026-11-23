/* eslint-disable security/detect-non-literal-fs-filename --
 * Asset reads: the URL names an entry of the closed `assets` map, never a path, so no request text
 * reaches the file system.
 */
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** One event of a run's stream: what `@theokit/agents/bridge` calls a `StreamEvent`, declared here so this file's types do not pull the agents declarations into theokit's. */
export interface HostedChatEvent {
  readonly type: string
  readonly [key: string]: unknown
}

/** The part of `@theokit/agents/bridge` this file uses, declared here so no agents type reaches theokit's declarations. */
interface Bridge {
  readonly readCappedBody: (request: Request, maxBytes: number) => Promise<Uint8Array<ArrayBuffer>>
  readonly BodyTooLargeError: abstract new (...args: never[]) => Error
  readonly generateAgentRoutes: (options: {
    readonly walkResult: { readonly route: string }
    readonly createRun: (message: string, sessionId: string) => AsyncIterable<HostedChatEvent>
  }) => readonly {
    readonly method: string
    readonly path: string
    readonly handler: (request: Request) => Promise<Response>
  }[]
}
/** Loaded on first use: the server barrel re-exports this file, and most servers never host a chat. */
const BRIDGE_SPECIFIER = '@theokit/agents/bridge'
const loadBridge = (): Promise<Bridge> =>
  // A variable specifier on purpose: a literal one makes the declaration build load the agents declarations for this entry, which runs it out of memory.
  import(/* @vite-ignore */ BRIDGE_SPECIFIER) as Promise<Bridge>
/** Set once `createHostedChat` has loaded it, so a request awaits nothing extra before its body read. */
let bridgeLoaded: Bridge | undefined

/** The longest chat id a hosted chat accepts. */
const HOSTED_CHAT_MAX_ID_LENGTH = 128
const CHAT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

/** What `auth` answers for a chat post it lets in. `identity` keys the chat's sessions when set. */
export interface HostedChatAccess {
  readonly identity?: string
}

export interface HostedChatOptions {
  /** The page's route, e.g. `/webchat`. The chat post is `<route>/chat`, the widget frame `<route>/sandbox`. */
  readonly route: string
  /** One run of a chat: the message, the (scoped) chat id and a signal that aborts when the client leaves. */
  readonly createRun: (
    message: string,
    chatId: string,
    signal: AbortSignal,
  ) => AsyncIterable<HostedChatEvent>
  /**
   * The gate of a chat post, run before the body is read: a `Response` refuses it (return the 401 or
   * 403 yourself), an access lets it in. Decide only from what you can trust; never from a header a
   * client may set unless a proxy you control strips it.
   */
  readonly auth: (
    request: Request,
  ) => Response | HostedChatAccess | Promise<Response | HostedChatAccess>
  /** Where the built page assets are. */
  readonly assetsDir: string | URL
  /** The most bytes a chat post's body may hold; more is 413. */
  readonly maxBodyBytes: number
  /** The session-key prefix of one authenticated identity, so two identities naming one chat id get two sessions. Default: no scoping. */
  readonly sessionScope?: (identity: string) => string | Promise<string>
  /** The assets served by name (and nothing else) with their content types. Default: `app.js` and `app.css`. */
  readonly assets?: Readonly<Record<string, string>>
  /** The shell's `<title>`. Default: `Chat`. */
  readonly title?: string
  /** The 503 text while the bundle is not built. */
  readonly missingBundleMessage?: string
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
const DEFAULT_ASSETS: Readonly<Record<string, string>> = {
  'app.js': 'text/javascript; charset=utf-8',
  'app.css': 'text/css; charset=utf-8',
}

function ignore(): void {
  // a cancel that fails has nothing left to report
}

function empty(status: number): Response {
  return new Response(null, { status, headers: NO_STORE })
}

/** The page's shell: it loads `app.css` and `app.js` from `<route>/assets/` and mounts on `#root`. */
export function renderHostedChatShell(route: string, title = 'Chat'): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<link rel="stylesheet" href="${route}/assets/app.css">`,
    '</head>',
    '<body>',
    '<div id="root"></div>',
    `<script type="module" src="${route}/assets/app.js"></script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function assetPath(assetsDir: string | URL, name: string): string {
  return join(typeof assetsDir === 'string' ? assetsDir : fileURLToPath(assetsDir), name)
}

async function readAsset(assetsDir: string | URL, name: string): Promise<Buffer | undefined> {
  try {
    return await readFile(assetPath(assetsDir, name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * The generator's body, relayed chunk for chunk. Its `cancel` stops the turn first and only then
 * cancels the inner body, without waiting on it: the inner body reaches the turn through an async
 * generator's `return()`, which waits behind a read pending on a silent model. The relay writes no
 * frame of its own.
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

/** The chat id a post names (`sessionId` wins over `id`), or the reason it is unusable. */
function chatIdProblem(fields: Record<string, unknown>): string | undefined {
  const pick = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined
  const id = pick(fields.sessionId) ?? pick(fields.id)
  if (id === undefined) return 'a chat post must carry the chat id as `id` or `sessionId`'
  if (id.length > HOSTED_CHAT_MAX_ID_LENGTH || !CHAT_ID.test(id))
    return 'the chat id is not a valid chat id'
  return undefined
}

/** A 400 when the post has a message but no valid chat id, before any run exists. A body with no message is left to the generator's own 400. */
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
  const problem = chatIdProblem(fields)
  if (problem === undefined) return undefined
  return new Response(JSON.stringify({ error: { code: 'chat_id_invalid', message: problem } }), {
    status: 400,
    headers: { 'content-type': 'application/json', ...NO_STORE },
  })
}

/** Reads the body within the bound: `undefined` past it, `null` when the client left. */
async function readBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null | undefined> {
  const { readCappedBody, BodyTooLargeError } = bridgeLoaded ?? (await loadBridge())
  return readCappedBody(request, maxBytes).catch((error: unknown) => {
    if (error instanceof BodyTooLargeError) return undefined
    // A client that leaves mid-upload errors the body stream; answer instead of failing the listener.
    if (request.signal.aborted) return null
    throw error
  })
}

/** The `/chat` generator's handler, built per request so this request's signal reaches its own run. */
async function chat(
  request: Request,
  options: HostedChatOptions,
  chatPath: string,
  scope: string,
): Promise<Response> {
  const turn = new AbortController()
  const stopTurn = (): void => {
    turn.abort()
  }
  if (request.signal.aborted) stopTurn()
  else request.signal.addEventListener('abort', stopTurn, { once: true })
  const { generateAgentRoutes } = bridgeLoaded ?? (await loadBridge())
  const routes = generateAgentRoutes({
    walkResult: { route: options.route },
    createRun: (message, chatId) => options.createRun(message, `${scope}${chatId}`, turn.signal),
  })
  const post = routes.find((route) => route.method === 'POST' && route.path === chatPath)
  if (post === undefined) throw new Error(`generateAgentRoutes returned no POST ${chatPath}`)
  const response = await post.handler(request)
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'no-store')
  const body = response.body === null ? null : relay(response.body, stopTurn)
  return new Response(body, { status: response.status, headers })
}

async function page(options: HostedChatOptions): Promise<Response> {
  const built = await access(assetPath(options.assetsDir, 'app.js')).then(
    () => true,
    () => false,
  )
  if (!built) {
    return new Response(options.missingBundleMessage ?? 'the page bundle is not built\n', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE },
    })
  }
  return new Response(renderHostedChatShell(options.route, options.title), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': PAGE_CSP,
      ...PAGE_HARDENING,
      ...NO_STORE,
    },
  })
}

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

async function asset(options: HostedChatOptions, name: string): Promise<Response> {
  const assets = options.assets ?? DEFAULT_ASSETS
  if (!Object.hasOwn(assets, name)) return empty(404)
  const bytes = await readAsset(options.assetsDir, name)
  if (bytes === undefined) return empty(404)
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': assets[name],
      'x-content-type-options': 'nosniff',
      ...NO_STORE,
    },
  })
}

/** An authorized chat post: its body read within the bound, its chat id checked, then handed to `chat`. */
async function boundedChat(
  request: Request,
  options: HostedChatOptions,
  chatPath: string,
  scope: string,
): Promise<Response> {
  const body = await readBody(request, options.maxBodyBytes)
  if (body === null) return empty(400)
  if (body === undefined) return empty(413)
  const refused = chatIdRefusal(body)
  if (refused !== undefined) return refused
  return chat(
    new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body,
      signal: request.signal,
    }),
    options,
    chatPath,
    scope,
  )
}

/** A session-key prefix from an identity, hashed so the identity never reaches a key or a file name. */
export async function hashedSessionScope(identity: string): Promise<string> {
  // Web Crypto, not node:crypto: server/ keeps runtime node:* imports to its documented leaves.
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(identity),
  )
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return `u${hex.slice(0, 16)}.`
}

/**
 * A hosted chat page: `GET <route>` (the shell, with a CSP), `GET <route>/sandbox` (the frame an html
 * widget runs in), `GET <route>/assets/<name>` (only the names in `assets`) and `POST <route>/chat`.
 * A chat post is refused by `auth` before its body is read, 413 past `maxBodyBytes`, 400 for a message
 * with no valid chat id, all before any run exists. The client leaving or cancelling stops the run.
 * Every other method or path is 404 and every answer carries `cache-control: no-store`.
 */
export function createHostedChat(
  options: HostedChatOptions,
): (request: Request) => Promise<Response> {
  loadBridge()
    .then((bridge) => {
      bridgeLoaded = bridge
    })
    .catch(ignore)
  const chatPath = `${options.route}/chat`
  const sandboxPath = `${options.route}/sandbox`
  const assetsPrefix = `${options.route}/assets/`
  return async (request) => {
    const { pathname } = new URL(request.url)
    if (request.method === 'GET' && pathname === options.route) return page(options)
    if (request.method === 'GET' && pathname === sandboxPath) return sandbox()
    if (request.method === 'GET' && pathname.startsWith(assetsPrefix)) {
      return asset(options, pathname.slice(assetsPrefix.length))
    }
    if (pathname !== chatPath || request.method !== 'POST') return empty(404)
    // Awaited only when it is a promise: a synchronous gate adds no turn to the body read that follows.
    const decided = options.auth(request)
    const access = decided instanceof Promise ? await decided : decided
    if (access instanceof Response) return access
    const identity = access.identity ?? ''
    const scope =
      identity === '' || options.sessionScope === undefined
        ? ''
        : await options.sessionScope(identity)
    return boundedChat(request, options, chatPath, scope)
  }
}
