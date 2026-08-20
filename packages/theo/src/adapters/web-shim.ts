/**
 * Web-to-Node bridge used by adapters whose runtimes provide a `Request`
 * (Web Standard) but where TheoKit's `executeRoute` expects a Node-style
 * IncomingMessage/ServerResponse pair.
 *
 * Consumed by every adapter that emits a request handler: Cloudflare, Vercel,
 * Netlify, Bun, Deno Deploy and AWS Lambda. (The header used to claim Deno
 * Deploy did not use it; `deno-deploy.ts` has imported it since the rewrite.)
 *
 * ## The response side streams (#382)
 *
 * `res.write()` enqueues into a `ReadableStream` that the `Response` already
 * carries, and the `Response` is resolved the moment status + headers are
 * known — at `writeHead()`, or at the first `write()`/`end()` when the caller
 * never called `writeHead()`. It is NOT resolved at `end()`.
 *
 * That ordering is the whole point. Until #382 the shim pushed every write
 * onto an array and built the `Response` from a single concatenation inside
 * `end()`, so `toResponse()` could not settle before the producer finished and
 * no byte was observable early. Measured through the shim, a run emitting a
 * chunk every 120 ms arrived as one chunk at the millisecond the run ended.
 *
 * Three consequences the caller has to know about:
 *
 * - **Headers freeze at the first byte.** `setHeader()`/`writeHead()` after
 *   the `Response` has been handed out throw, naming the header. They cannot
 *   be honoured — the platform may already have flushed the head — and
 *   silently dropping them would be a lie the caller never sees. Node's own
 *   `ServerResponse` throws `ERR_HTTP_HEADERS_SENT` here, so this is parity,
 *   not a new rule.
 * - **Backpressure is reported, not enforced.** `write()` returns `false`
 *   once the outbound queue passes {@link RESPONSE_HIGH_WATER_MARK_BYTES},
 *   and `once('drain', cb)` fires when the consumer has read enough to make
 *   room. A producer that ignores the boolean can still outrun its consumer —
 *   that is the Node contract, not a shim limitation. The framework's own
 *   producer (`pipeWebStreamToResponse` in `server/http/execute.ts`) honours
 *   it.
 * - **A failure after the first byte cannot become a status code.** Pass the
 *   in-flight handler promise to `toResponse(pending)`: if it rejects before
 *   the headers are out, `toResponse()` rejects and the adapter can still
 *   produce a 500; if it rejects after, the body stream is errored, so the
 *   consumer sees a broken stream rather than a short body that looks
 *   complete (ADR-0002).
 */

export interface ShimRequest {
  method: string
  url: string
  headers: Record<string, string>
  socket: { remoteAddress: string }
  on: (event: 'data' | 'end' | 'error', cb: (chunk?: unknown) => void) => unknown
}

export interface ShimResponse {
  statusCode: number
  headersSent: boolean
  writableEnded: boolean
  /**
   * Freeze status + headers and hand the `Response` to `toResponse()`. Every
   * later `setHeader`/`writeHead` throws.
   */
  writeHead: (status: number, headers?: Record<string, string>) => void
  /** Throws once the headers have been handed out (Node: `ERR_HTTP_HEADERS_SENT`). */
  setHeader: (key: string, value: string) => void
  getHeader: (key: string) => string | undefined
  /**
   * Enqueue `chunk` onto the body stream the `Response` already carries.
   * Returns `false` when the outbound queue is above the high-water mark or
   * the consumer has gone away — a cooperating producer should then wait for
   * `once('drain', ...)` before writing more.
   */
  write: (chunk: Uint8Array | string) => boolean
  end: (body?: Uint8Array | string) => void
  /**
   * Node `ServerResponse` parity, limited to what a stream can express:
   * `'drain'` fires when the consumer has made room (or when the consumer has
   * gone away and waiting further would hang the producer). Any other event
   * name is accepted and ignored, because there is no socket underneath.
   */
  once: (event: string, listener: () => void) => ShimResponse
}

export interface ShimContext {
  req: ShimRequest
  res: ShimResponse
  /**
   * Resolve to a Web Standard Response as soon as status + headers are known
   * — at `writeHead()`, or at the first `write()`/`end()` otherwise. The body
   * is a live `ReadableStream`, so the returned Response is usually still
   * being written to when the caller receives it.
   *
   * Pass the in-flight handler promise so a failure cannot be reported as a
   * normal ending (ADR-0002):
   *
   * ```js
   * return toResponse(executeRoute({ route, method, params, req, res, ... }))
   * ```
   *
   * - rejects before the headers are out → `toResponse()` rejects, and the
   *   adapter is still free to answer with a 500;
   * - rejects after → the body stream is errored, so the consumer sees a
   *   broken stream instead of a truncated body that looks complete;
   * - resolves without the handler having called `end()` → the shim closes the
   *   stream rather than leaving `toResponse()` pending forever.
   */
  toResponse: (pending?: Promise<unknown>) => Promise<Response>
}

/**
 * Bytes allowed to sit in the outbound queue before `write()` starts
 * answering `false`. 64 KiB matches Node's default `highWaterMark` for a
 * socket, so a producer that already honours Node backpressure behaves the
 * same through the shim.
 */
export const RESPONSE_HIGH_WATER_MARK_BYTES = 64 * 1024

/**
 * Statuses the Fetch spec forbids a body on — `new Response(stream, { status })`
 * throws for these. The shim answers with a bodyless Response instead.
 */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

export interface CreateWebShimOptions {
  /**
   * CR-018 fix: how to resolve the client IP from forwarded headers.
   *
   * - `'platform'` (default for `cf-connecting-ip`): trust runtime-injected
   *   headers only (`cf-connecting-ip` on Cloudflare, `x-real-ip` on
   *   Netlify/Vercel when the platform writes it). Ignores
   *   `x-forwarded-for` because clients can spoof it.
   * - `'trusted-proxy'`: read the **rightmost** entry of `x-forwarded-for`.
   *   Only safe when the request literally went through a trusted proxy
   *   that strips client-set headers and appends the real client IP last.
   * - `'none'`: skip all forwarded-header lookups and report
   *   `'0.0.0.0'`. Force this when the adapter has no reliable way to
   *   identify the client (rate-limiters then must use a different key).
   *
   * Default: `'platform'`.
   */
  trustedProxy?: 'platform' | 'trusted-proxy' | 'none'
}

function resolveRemoteAddress(
  headers: Record<string, string>,
  policy: NonNullable<CreateWebShimOptions['trustedProxy']>,
): string {
  if (policy === 'none') return '0.0.0.0'

  // Runtime-injected headers — these come from the platform itself and
  // cannot be set by the client.
  const cf = headers['cf-connecting-ip']
  if (cf) return cf

  if (policy === 'trusted-proxy') {
    // Take the RIGHTMOST entry of x-forwarded-for. The rightmost is the
    // hop nearest the application, which a trusted proxy appended; entries
    // to the left may have been forged by the client.
    const xff = headers['x-forwarded-for']
    if (xff) {
      const parts = xff
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
      if (parts.length > 0) return parts[parts.length - 1]
    }
    // x-real-ip is typically platform-set (NGINX/Netlify/Vercel).
    const xri = headers['x-real-ip']
    if (xri) return xri
  }

  return '0.0.0.0'
}

/**
 * The outbound body: a `ReadableStream` the `Response` carries from the moment
 * the headers are known, plus the small surface `res` needs to feed it.
 *
 * It exists as its own object because it owns the one thing the rest of the
 * shim must not touch directly — the stream controller. Once the consumer
 * cancels (client disconnect, platform abort) the controller is dropped, so a
 * later write reports `false` instead of throwing, and anything parked on
 * `drain` is released rather than left waiting for a signal that will never
 * come.
 */
interface OutboundBody {
  readonly stream: ReadableStream<Uint8Array>
  /** Enqueue bytes. `false` means the consumer is gone and nothing was written. */
  push: (bytes: Uint8Array) => boolean
  /** Room left below the high-water mark — what `res.write()` reports. */
  hasRoom: () => boolean
  isOpen: () => boolean
  close: () => void
  error: (err: unknown) => void
  /** Fire `listener` when the consumer makes room, or when it goes away. */
  onDrain: (listener: () => void) => void
}

function createOutboundBody(): OutboundBody {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const drainListeners: (() => void)[] = []

  function releaseDrainListeners(): void {
    if (drainListeners.length === 0) return
    const pending = drainListeners.splice(0, drainListeners.length)
    for (const listener of pending) listener()
  }

  function detach(): ReadableStreamDefaultController<Uint8Array> | null {
    const c = controller
    controller = null
    releaseDrainListeners()
    return c
  }

  const stream = new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c
      },
      pull() {
        // The consumer read enough to make room — that is Node's `drain`.
        releaseDrainListeners()
      },
      cancel() {
        detach()
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: RESPONSE_HIGH_WATER_MARK_BYTES }),
  )

  return {
    stream,
    push(bytes) {
      if (!controller) return false
      if (bytes.length > 0) controller.enqueue(bytes)
      return true
    },
    hasRoom: () => controller !== null && (controller.desiredSize ?? 0) > 0,
    isOpen: () => controller !== null,
    close() {
      detach()?.close()
    },
    error(err) {
      detach()?.error(err)
    },
    onDrain(listener) {
      if (!controller || (controller.desiredSize ?? 0) > 0) {
        queueMicrotask(listener)
        return
      }
      drainListeners.push(listener)
    },
  }
}

function chunkToBytes(chunk: Uint8Array | string): Uint8Array {
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk)
  return chunk
}

function refuseFrozenHeader(operation: string, key: string): never {
  throw new Error(
    `[web-shim] ${operation}('${key}') after the response headers were sent. ` +
      `The body is already streaming, so this header cannot reach the client. ` +
      `Set it before the first res.write()/res.writeHead(). ` +
      `(Node's ServerResponse raises ERR_HTTP_HEADERS_SENT here for the same reason.)`,
  )
}

/**
 * The response half of the shim: a `ShimResponse` whose writes feed the live
 * body above, plus the `toResponse` the adapter awaits.
 *
 * Split out of `createWebShim` because the two halves share nothing — the
 * request side drains an incoming body, this side produces an outgoing one.
 */
function createResponseSide(): {
  res: ShimResponse
  toResponse: (pending?: Promise<unknown>) => Promise<Response>
} {
  const responseHeaders: Record<string, string> = {}
  const body = createOutboundBody()
  let resolveResponse!: (r: Response) => void
  let rejectResponse!: (err: unknown) => void
  const responsePromise = new Promise<Response>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })
  // The caller always awaits `toResponse()`, but a rejection raised before it
  // does would surface as an unhandled rejection. Marking the promise handled
  // here does not stop the real awaiter from seeing the rejection.
  void responsePromise.catch(() => undefined)

  // `settled` covers both endings: a Response handed out, or a failure raised
  // before one could be. Either way status + headers are frozen.
  let settled = false

  /**
   * Freeze status + headers and hand the Response to `toResponse()`. Called by
   * `writeHead()`, and by the first `write()`/`end()` when the caller never
   * called `writeHead()` — whichever happens first.
   */
  function materializeResponse(): void {
    if (settled) return
    settled = true
    res.headersSent = true
    const status = res.statusCode
    if (NULL_BODY_STATUSES.has(status)) {
      // Fetch forbids a body on these; a stream would make `new Response` throw.
      body.close()
      resolveResponse(new Response(null, { status, headers: responseHeaders }))
      return
    }
    resolveResponse(new Response(body.stream, { status, headers: responseHeaders }))
  }

  /**
   * The handler failed. Before the headers went out this is still a status code
   * the adapter can choose; after, the only honest signal left is a broken body
   * stream — a short body closed cleanly would report an abnormal ending as a
   * normal one (ADR-0002).
   */
  function failResponse(err: unknown): void {
    const beforeHeaders = !settled
    settled = true
    res.headersSent = true
    body.error(err)
    if (beforeHeaders) rejectResponse(err)
  }

  const res: ShimResponse = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    writeHead(status, headers) {
      if (this.headersSent) refuseFrozenHeader('writeHead', String(status))
      this.statusCode = status
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          responseHeaders[k.toLowerCase()] = v
        }
      }
      materializeResponse()
    },
    setHeader(key, value) {
      if (this.headersSent) refuseFrozenHeader('setHeader', key)
      responseHeaders[key.toLowerCase()] = value
    },
    getHeader(key) {
      return responseHeaders[key.toLowerCase()]
    },
    write(chunk) {
      if (this.writableEnded) return false
      materializeResponse()
      if (!body.push(chunkToBytes(chunk))) return false
      return body.hasRoom()
    },
    end(chunk) {
      if (this.writableEnded) return
      materializeResponse()
      if (chunk !== undefined) body.push(chunkToBytes(chunk))
      this.writableEnded = true
      body.close()
    },
    once(event, listener) {
      // Only `drain` is meaningful here; there is no socket under this response.
      if (event !== 'drain') return res
      if (this.writableEnded || !body.isOpen()) {
        queueMicrotask(listener)
        return res
      }
      body.onDrain(listener)
      return res
    },
  }

  function toResponse(pending?: Promise<unknown>): Promise<Response> {
    if (pending) {
      void pending.then(
        () => {
          // A handler that returned without ending would leave `toResponse()`
          // pending forever. Close it out instead of hanging the platform.
          if (!res.writableEnded) res.end()
        },
        (err: unknown) => {
          failResponse(err)
        },
      )
    }
    return responsePromise
  }

  return { res, toResponse }
}

/**
 * Build Node-style req/res objects around a Web Standard Request.
 * `toResponse()` returns a Promise that resolves as soon as status + headers
 * are known, carrying a live `ReadableStream` body that `res.write()` feeds.
 */
export function createWebShim(request: Request, options?: CreateWebShimOptions): ShimContext {
  const url = new URL(request.url)
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  const pumpState = { consumed: false }

  // Consume the request body once, then dispatch data/end events to whatever
  // listener attaches later (executeRoute's body parser).
  const dataListeners: ((chunk: Uint8Array) => void)[] = []
  const endListeners: (() => void)[] = []
  const errorListeners: ((err: unknown) => void)[] = []

  async function pumpBody(): Promise<void> {
    if (pumpState.consumed) return
    pumpState.consumed = true
    if (!request.body) {
      for (const cb of endListeners) cb()
      return
    }
    try {
      const reader = request.body.getReader()
      let done = false
      while (!done) {
        const chunk = await reader.read()
        done = chunk.done
        if (!done && chunk.value) {
          for (const cb of dataListeners) cb(chunk.value)
        }
      }
      for (const cb of endListeners) cb()
    } catch (err) {
      for (const cb of errorListeners) cb(err)
    }
  }

  const trustedProxy = options?.trustedProxy ?? 'platform'

  const req: ShimRequest = {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    socket: {
      remoteAddress: resolveRemoteAddress(headers, trustedProxy),
    },
    on(event, cb) {
      if (event === 'data') dataListeners.push(cb)
      if (event === 'end') endListeners.push(cb)
      if (event === 'error') errorListeners.push(cb)
      // Lazily start pumping when end is registered (executeRoute always
      // listens for end before doing anything with the body).
      if (event === 'end') void pumpBody()
      return req
    },
  }

  const { res, toResponse } = createResponseSide()

  return {
    req,
    res,
    toResponse,
  }
}
