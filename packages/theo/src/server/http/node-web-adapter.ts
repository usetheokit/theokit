/**
 * T5a.2 Phase G slice 5/N — Node adapter shim for the Web request handler.
 *
 * Bridges Node's `IncomingMessage` + `ServerResponse` shape to the
 * Web-Standards `executeWebRequest` (Phase A → G slices 1-4). Per
 * ADR-0028 R3a, the Node adapter is the ONLY place IncomingMessage ↔
 * Request conversion happens — every other layer of `server/` flows
 * through Web `Request`/`Response`.
 *
 * **Two conversions:**
 *
 *   1. `incomingMessageToWebRequest(req)` — Node → Web. Reads
 *      `req.method`, `req.url`, `req.headers`, and (for POST/PUT/etc.)
 *      drains the Node Readable body into a Web `ReadableStream`. The
 *      request URL is resolved to absolute form using `req.headers.host`
 *      (Web Request guarantees absolute URL).
 *
 *   2. `writeWebResponseToServerResponse(response, res)` — Web → Node.
 *      Sets status code + status text, copies headers (including all
 *      `Set-Cookie` values via `getSetCookie()`), then drains the Web
 *      `ReadableStream` body into the Node ServerResponse.
 *
 * Plus the convenience composer `executeWebRequestFromNode(req, res,
 * routeModule, opts?)` that wires both ends — exactly what api-middleware
 * (and the prod CLI start path) need to migrate from the legacy
 * `executeRoute` to `executeWebRequest` without touching call sites.
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase G slice 5/N (closes the executor bridge surface).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

import { executeWebRequest, type ExecuteWebRequestOptions } from '../web-handler.js'

/**
 * Build a Web `Request` from a Node `IncomingMessage`. The Web Request
 * spec requires an absolute URL; we synthesize one from
 * `req.headers.host` (or fall back to `localhost` for test doubles).
 *
 * For methods with a body (POST/PUT/PATCH/DELETE), the Node Readable
 * stream is wrapped as a Web ReadableStream via `Readable.toWeb()` so
 * downstream consumers can call `request.json()` / `request.formData()`
 * / `request.text()` natively.
 *
 * EC-1: Node sometimes provides headers as `string | string[]`. Web
 * `Headers` collapses to single-comma-joined strings — we do the join
 * manually for repeated headers because `Headers.append` would create
 * multi-value entries which behave differently on `.get()`.
 */
export function incomingMessageToWebRequest(req: IncomingMessage): Request {
  const host = pickHeaderString(req.headers.host) ?? 'localhost'
  const url = `http://${host}${req.url ?? '/'}`

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      headers.set(key, value.join(', '))
    } else {
      headers.set(key, value)
    }
  }

  const method = (req.method ?? 'GET').toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'

  if (!hasBody) {
    return new Request(url, { method, headers })
  }

  // Drain Node's Readable into a Web ReadableStream. `Readable.toWeb` is
  // available in Node 18+ (theokit's engines.node floor is 22+, so safe).
  const webStream = Readable.toWeb(req) as ReadableStream
  return new Request(url, {
    method,
    headers,
    body: webStream,
    // EC-2: Node 18+ requires `duplex: 'half'` when body is a stream.
    // The `RequestInit` type omits it (Web spec gap); cast accordingly.
    ...({ duplex: 'half' } as { duplex: 'half' }),
  })
}

/**
 * Write a Web `Response` into a Node `ServerResponse`. Mirrors the Node
 * `res.writeHead` + `res.end` pattern.
 *
 * Set-Cookie is the only multi-value header the Web spec exposes via
 * `getSetCookie()`. We append each entry individually so Node emits
 * separate `Set-Cookie:` lines per the HTTP spec.
 *
 * If the Response body is a `ReadableStream`, it's piped chunk-by-chunk
 * to `res`. Empty body (null) → just close.
 */
export async function writeWebResponseToServerResponse(
  response: Response,
  res: ServerResponse,
): Promise<void> {
  // Status + headers FIRST (writeHead locks them).
  // EC-3: Set-Cookie needs special handling (writeHead's plain object
  // shape conflicts with multi-value headers; we set them via setHeader
  // BEFORE writeHead so the array form is preserved).
  const setCookies = response.headers.getSetCookie()
  if (setCookies.length > 0) {
    res.setHeader('Set-Cookie', setCookies)
  }
  const otherHeaders: Record<string, string> = {}
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') continue
    otherHeaders[key] = value
  }
  res.writeHead(response.status, response.statusText, otherHeaders)

  // Body — drain ReadableStream OR just end() for null body.
  if (response.body === null) {
    res.end()
    return
  }
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      // Node's res.write accepts Uint8Array natively (no conversion needed).
      res.write(value)
    }
    res.end()
  } finally {
    reader.releaseLock()
  }
}

/**
 * Convenience composer — full request lifecycle Node → Web → Node.
 *
 * Use case: existing api-middleware (and the prod CLI start path)
 * receive Node `(req, res)` from `http.createServer`. To migrate to the
 * Web-Standards executor without rewriting every call site, wrap with
 * this composer:
 *
 *   import * as users from './app/users/route.js'
 *   await executeWebRequestFromNode(req, res, users, { csrfMode: 'strict' })
 *
 * The Web request is built, dispatched through executeWebRequest, and
 * the Response is drained back into `res`. Caller does NOT need to call
 * `res.end()` afterwards — this composer handles it.
 */
export async function executeWebRequestFromNode(
  req: IncomingMessage,
  res: ServerResponse,
  routeModule: Parameters<typeof executeWebRequest>[1],
  opts?: ExecuteWebRequestOptions,
): Promise<void> {
  const webRequest = incomingMessageToWebRequest(req)
  const webResponse = await executeWebRequest(webRequest, routeModule, opts)
  await writeWebResponseToServerResponse(webResponse, res)
}

/** Pick the first usable string from Node's `string | string[] | undefined` headers. */
function pickHeaderString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const v of value) if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}
