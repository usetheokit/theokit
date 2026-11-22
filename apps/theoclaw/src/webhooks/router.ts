import { BodyTooLargeError, readCappedBody } from '@theokit/agents/bridge'
import type { PlatformName } from '@theokit/gateway'
/** One webhook route: what it answers, and the methods it takes. */
export interface WebhookRoute {
  readonly methods: readonly string[]
  readonly handle: (request: Request) => Promise<Response>
}

export interface RouterOptions {
  /**
   * Every `/webhooks/<platform>` that is not one of `named`: the gateway's webhook handler, which
   * answers 404 for an unknown platform, 503 before it starts, 405, 413 and 500 itself.
   */
  readonly channels: (request: Request) => Promise<Response>
  /** Where a route that throws is written; the process output mask keeps credentials out. */
  readonly write: (line: string) => void
  /**
   * A route per configured signed trigger, at `/hooks/<name>` (B-397 FR-001); a name with no route
   * answers 404. A trigger route answers 503 itself, since it waits on its reply platform only.
   */
  readonly triggers?: ReadonlyMap<string, WebhookRoute>
  /** Routes at `/webhooks/<name>` that are not gateway platforms (the phone-call webhook); they take precedence. */
  readonly named?: ReadonlyMap<string, WebhookRoute>
}

/**
 * The largest webhook body the router reads: 1 MiB, far above any provider's message (EC-1). A
 * webhook policy of its own, equal today to the bridge's `MAX_REQUEST_BODY_BYTES` for the API.
 */
export const MAX_BODY_BYTES = 1_048_576

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const WEBHOOK_PATH = /^\/webhooks\/([a-z_]+)$/
const TRIGGER_PATH = /^\/hooks\/([a-z][a-z0-9-]{0,31})$/

function pathOf(url: URL): string {
  return url.pathname.replace(/(.)\/$/, '$1')
}

/** The platform `/webhooks/<platform>` names (a single trailing slash ignored), for the gateway's webhook handler. */
export function webhookPlatformOf(url: URL): PlatformName | undefined {
  return WEBHOOK_PATH.exec(pathOf(url))?.[1] as PlatformName | undefined
}

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
  const body = await readCappedBody(request, MAX_BODY_BYTES)
  // The body is in memory now: the framing headers of the original no longer describe it.
  const headers = new Headers(request.headers)
  headers.delete('content-length')
  headers.delete('transfer-encoding')
  return new Request(request.url, { method: request.method, headers, body })
}

/** A trigger's route (`/hooks/<name>`), labelled `trigger <name>` in what the router writes. */
function resolveTrigger(path: string, request: Request, options: RouterOptions): { readonly label: string; readonly route: WebhookRoute } | Response | undefined {
  const name = TRIGGER_PATH.exec(path)?.[1]
  if (name === undefined) return path.startsWith('/hooks/') ? answer(404) : undefined
  const route = options.triggers?.get(name)
  if (route === undefined) return answer(404)
  if (!route.methods.includes(request.method)) return answer(405)
  return { label: `trigger ${name}`, route }
}

/** The route a request names, or the status that answers it before any route runs; a gateway platform is `undefined`. */
function resolveRoute(
  request: Request,
  options: RouterOptions,
): { readonly label: string; readonly route: WebhookRoute } | Response | undefined {
  const path = pathOf(new URL(request.url))
  const trigger = resolveTrigger(path, request, options)
  if (trigger !== undefined) return trigger
  const name = WEBHOOK_PATH.exec(path)?.[1]
  const named = name === undefined ? undefined : options.named?.get(name)
  if (name === undefined) return answer(404)
  if (named === undefined) return undefined
  return named.methods.includes(request.method) ? { label: name, route: named } : answer(405)
}

/** The request with its body capped in memory, or the status that refuses the body. */
async function readBody(
  request: Request,
  label: string,
  write: (line: string) => void,
): Promise<Request | Response> {
  if (request.body === null) return request
  try {
    return await cappedRequest(request)
  } catch (error) {
    if (error instanceof BodyTooLargeError) return tooLarge()
    // The client went away or sent a broken body: its request, not a defect of ours.
    write(`${label}: request body could not be read: ${describeError(error)}`)
    return answer(400)
  }
}

/**
 * Route `/hooks/<name>` to a configured trigger and `/webhooks/<name>` to a named route (the voice
 * call): 404 or 405 as each says, 413 for a body past the cap (EC-1). Every other
 * `/webhooks/<platform>` goes to the gateway's webhook handler, which owns the platform statuses
 * (404, 503 before start, 405, 413, 500). A single trailing slash is ignored (EC-4).
 */
export function createWebhookRouter(options: RouterOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    const resolved = resolveRoute(request, options)
    if (resolved === undefined) return options.channels(request)
    if (resolved instanceof Response) return resolved
    const { label, route } = resolved
    const routed = await readBody(request, label, options.write)
    if (routed instanceof Response) return routed
    try {
      return await route.handle(routed)
    } catch (error) {
      // A route that throws is a defect, not the provider's fault: written, and answered 500 with
      // no body, so nothing about it reaches the caller.
      options.write(`${label}: webhook failed: ${describeError(error)}`)
      return answer(500)
    }
  }
}
