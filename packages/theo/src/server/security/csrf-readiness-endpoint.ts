/**
 * T2.2 — `/__theo/csrf-readiness` endpoint.
 *
 *   GET  /__theo/csrf-readiness        → 200 + JSON summary
 *   POST /__theo/csrf-readiness/reset  → 204; clears the store
 *
 * The reset endpoint enforces CSRF (own dog food) — requires
 * `X-Theo-Action: 1` AND a matching Origin header (EC-15). This avoids
 * the endpoint being weaponizable from a cross-origin page when the
 * endpoint is opt-in exposed in production.
 *
 * Mount opt-in: in dev mode, the host wires this in unconditionally. In
 * production, only mount when `config.security.csrfTelemetry.exposeReadinessEndpoint === true`.
 * EC-10 parallel: returns 404 (via boolean false return) when the URL
 * does not match — the caller continues normal request handling.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { CsrfReadinessStore } from './csrf-readiness-store.js'

export const CSRF_READINESS_PATH = '/__theo/csrf-readiness'
export const CSRF_READINESS_RESET_PATH = '/__theo/csrf-readiness/reset'

function originMatchesHost(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (typeof origin !== 'string') return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  try {
    const parsed = new URL(origin)
    return parsed.host === host
  } catch {
    return false
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function sendNoContent(res: ServerResponse): void {
  res.writeHead(204)
  res.end()
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { code, message } }))
}

// eslint-disable-next-line @typescript-eslint/require-await -- async return for future telemetry hooks
export async function handleCsrfReadiness(
  req: IncomingMessage,
  res: ServerResponse,
  store: CsrfReadinessStore,
): Promise<boolean> {
  const url = (req.url ?? '').split('?')[0]
  const method = req.method ?? 'GET'

  if (url === CSRF_READINESS_PATH) {
    if (method === 'GET') {
      sendJson(res, 200, store.summary())
      return true
    }
    sendError(res, 405, 'METHOD_NOT_ALLOWED', `Use GET on ${CSRF_READINESS_PATH}`)
    return true
  }

  if (url === CSRF_READINESS_RESET_PATH) {
    if (method !== 'POST') {
      sendError(res, 405, 'METHOD_NOT_ALLOWED', `Use POST on ${CSRF_READINESS_RESET_PATH}`)
      return true
    }
    // Enforce CSRF on our own endpoint (dog-food).
    const hasHeader = req.headers['x-theo-action'] === '1'
    if (!hasHeader || !originMatchesHost(req)) {
      sendError(res, 403, 'CSRF_INVALID', 'Reset requires X-Theo-Action: 1 + same-origin')
      return true
    }
    store.reset()
    sendNoContent(res)
    return true
  }

  return false
}

/**
 * T5a.2 Phase B slice 3/6 — Web-Standards-shaped CSRF readiness handler.
 *
 * Mirror of `handleCsrfReadiness(req: IncomingMessage, res: ServerResponse,
 * store): Promise<boolean>` for the Web `Request` shape. Returns
 * `Response | null` instead of mutating `res` and returning a boolean:
 *   - `Response` → this handler claimed the URL; caller short-circuits.
 *   - `null` → URL doesn't match our endpoint; caller continues normal dispatch.
 *
 * Same routes (GET `CSRF_READINESS_PATH`, POST `CSRF_READINESS_RESET_PATH`).
 * Same CSRF dog-food on reset (X-Theo-Action + same-origin).
 *
 * Wire into `executeWebRequest` integration via a future Phase B sub-slice
 * (consumer can also call this directly today via the
 * `theokit/server/security` sub-path).
 */
function buildJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function buildErrorResponse(status: number, code: string, message: string): Response {
  return buildJsonResponse(status, { error: { code, message } })
}

/**
 * Returns true when `Origin` header and request URL host match (RFC 6454
 * same-origin check). Web-Standards counterpart of `originMatchesHost`.
 */
function originMatchesHostFromRequest(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (origin === null || origin.length === 0) return false
  const host = request.headers.get('host')
  if (host === null || host.length === 0) {
    // Fallback: derive host from request.url (Web Request guarantees absolute URL)
    try {
      const reqHost = new URL(request.url).host
      const originHost = new URL(origin).host
      return originHost === reqHost
    } catch {
      return false
    }
  }
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

// eslint-disable-next-line @typescript-eslint/require-await -- async return for future telemetry hooks
export async function handleCsrfReadinessRequest(
  request: Request,
  store: CsrfReadinessStore,
): Promise<Response | null> {
  const url = new URL(request.url).pathname
  const method = request.method.toUpperCase()

  if (url === CSRF_READINESS_PATH) {
    if (method === 'GET') {
      return buildJsonResponse(200, store.summary())
    }
    return buildErrorResponse(405, 'METHOD_NOT_ALLOWED', `Use GET on ${CSRF_READINESS_PATH}`)
  }

  if (url === CSRF_READINESS_RESET_PATH) {
    if (method !== 'POST') {
      return buildErrorResponse(
        405,
        'METHOD_NOT_ALLOWED',
        `Use POST on ${CSRF_READINESS_RESET_PATH}`,
      )
    }
    // Enforce CSRF on our own endpoint (dog-food).
    const hasHeader = request.headers.get('x-theo-action') === '1'
    if (!hasHeader || !originMatchesHostFromRequest(request)) {
      return buildErrorResponse(
        403,
        'CSRF_INVALID',
        'Reset requires X-Theo-Action: 1 + same-origin',
      )
    }
    store.reset()
    return new Response(null, { status: 204 })
  }

  return null
}
