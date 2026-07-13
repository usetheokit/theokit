/**
 * Pure Node `IncomingMessage` → Web `Request` converters.
 *
 * Kept free of any dependency on `web-handler.js` / `execute*.js` so the
 * executor (`execute.ts`) can build the handler-facing Web `Request` without
 * pulling the Web dispatch pipeline into its import graph (ADR-0028 R3a — the
 * Node adapter is the ONLY place IncomingMessage ↔ Request conversion lives;
 * these are the primitive converters it and the executor share).
 */
import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'

/** Pick the first usable string from Node's `string | string[] | undefined` headers. */
export function pickHeaderString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const v of value) if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

/** Web Request requires an absolute URL; synthesize one from the Host header. */
export function synthesizeAbsoluteUrl(req: IncomingMessage): string {
  const host = pickHeaderString(req.headers.host) ?? 'localhost'
  return `http://${host}${req.url ?? '/'}`
}

/**
 * Collapse Node's `string | string[]` headers into a Web `Headers`. Repeated
 * headers are comma-joined (not `.append`ed) because `Headers.append` creates
 * multi-value entries that behave differently on `.get()` (EC-1).
 */
export function nodeHeadersToWeb(req: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      headers.set(key, value.join(', '))
    } else {
      headers.set(key, value)
    }
  }
  return headers
}

/**
 * Build a Web `Request` from a Node `IncomingMessage`, body included. The Web
 * Request spec requires an absolute URL; we synthesize one from the Host header
 * (fallback `localhost` for test doubles).
 *
 * For methods with a body (POST/PUT/PATCH/DELETE), the Node Readable stream is
 * wrapped as a Web ReadableStream via `Readable.toWeb()` so downstream consumers
 * can call `request.json()` / `request.formData()` / `request.text()` natively.
 */
export function incomingMessageToWebRequest(req: IncomingMessage): Request {
  const url = synthesizeAbsoluteUrl(req)
  const headers = nodeHeadersToWeb(req)

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
 * Build the Web `Request` handed to a route handler as `ctx.request` in the
 * Node server path (dev + `theokit start`). Method + absolute URL + headers
 * only — NO body.
 *
 * Why no body: the Node executor parses the request body BEFORE the handler
 * runs and exposes the parsed value as `ctx.body` (the typed, documented body
 * API). By the time the handler is called the Node stream is already drained,
 * so re-wrapping it would yield an empty/closed stream. Handlers read the body
 * via `ctx.body`; `ctx.request` is for the Web-standard header/cookie/URL/method
 * surface (e.g. `createSessionManagerWeb.getSession(ctx.request)`).
 *
 * Per ADR-0028 R3a, handlers see a Web `Request` in every runtime — this closes
 * the gap where the Node path leaked the raw `IncomingMessage` (whose `.headers`
 * is a plain object, so `.headers.get(...)` threw for Web-standard consumers).
 */
export function incomingMessageToHandlerRequest(req: IncomingMessage): Request {
  return new Request(synthesizeAbsoluteUrl(req), {
    method: (req.method ?? 'GET').toUpperCase(),
    headers: nodeHeadersToWeb(req),
  })
}
