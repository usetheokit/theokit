import type { PlatformName } from '@theokit/gateway'

/** One webhook route: what it answers, and the methods it takes. */
export interface WebhookRoute {
  readonly methods: readonly string[]
  readonly handle: (request: Request) => Promise<Response>
}

export interface RouterOptions {
  /** A route per configured webhook platform; an absent platform answers 404. */
  readonly routes: ReadonlyMap<PlatformName, WebhookRoute>
  /** Whether the platform's runner has started; a configured platform that has not answers 503 (D7). */
  readonly isStarted: (platform: PlatformName) => boolean
  /** Where a route that throws is written; the process output mask keeps credentials out. */
  readonly write: (line: string) => void
}

/** The largest webhook body the router reads: 1 MiB, far above any provider's message (EC-1). */
export const MAX_BODY_BYTES = 1_048_576

/** A body that grew past the cap while it was being read. */
export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`request body exceeds ${maxBytes} bytes`)
    this.name = 'BodyTooLargeError'
  }
}

/**
 * Read the whole body, stopping as soon as it passes `maxBytes`, whether or not the request
 * declared a `content-length` (a chunked body declares none). The bytes are kept as they came, so
 * a signature over the raw body is computed over exactly what the provider sent.
 */
export async function readCapped(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (request.body === null) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new BodyTooLargeError(maxBytes)
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const WEBHOOK_PATH = /^\/webhooks\/([a-z]+)$/

function answer(status: number): Response {
  return new Response(null, { status })
}

/**
 * 413, closing the connection: the body was abandoned mid-stream, and a client that reused the
 * connection would otherwise find it reset under its next request.
 */
function tooLarge(): Response {
  return new Response(null, { status: 413, headers: { connection: 'close' } })
}

/** A request with a body, re-built over its capped, in-memory body, so no route or package verifier reads more. */
async function cappedRequest(request: Request): Promise<Request> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) throw new BodyTooLargeError(MAX_BODY_BYTES)
  const body = await readCapped(request, MAX_BODY_BYTES)
  // The body is in memory now: the framing headers of the original no longer describe it.
  const headers = new Headers(request.headers)
  headers.delete('content-length')
  headers.delete('transfer-encoding')
  return new Request(request.url, { method: request.method, headers, body })
}

/**
 * Route `/webhooks/<platform>` to its route: 404 for a platform with no route or an unknown path,
 * 503 while the platform's runner has not started (D7), 405 for a method the route does not take,
 * 413 for a body past the cap (EC-1). A single trailing slash is ignored (EC-4).
 */
export function createWebhookRouter(options: RouterOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    const path = new URL(request.url).pathname.replace(/(.)\/$/, '$1')
    const platform = WEBHOOK_PATH.exec(path)?.[1] as PlatformName | undefined
    const route = platform === undefined ? undefined : options.routes.get(platform)
    if (platform === undefined || route === undefined) return answer(404)
    if (!options.isStarted(platform)) return answer(503)
    if (!route.methods.includes(request.method)) return answer(405)
    let routed: Request = request
    if (request.body !== null) {
      try {
        routed = await cappedRequest(request)
      } catch (error) {
        if (error instanceof BodyTooLargeError) return tooLarge()
        // The client went away or sent a broken body: its request, not a defect of ours.
        options.write(`${platform}: request body could not be read: ${describeError(error)}`)
        return answer(400)
      }
    }
    try {
      return await route.handle(routed)
    } catch (error) {
      // A route that throws is a defect, not the provider's fault: written, and answered 500 with
      // no body, so nothing about it reaches the caller.
      options.write(`${platform}: webhook failed: ${describeError(error)}`)
      return answer(500)
    }
  }
}
