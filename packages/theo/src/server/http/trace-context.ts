// T5a.1b — Web Crypto migration. randomUUID() moved to globalThis.crypto.
// IncomingMessage stays as a type-only import (runtime-clean — TS erases at
// build); full IncomingMessage→Request boundary migration deferred to a
// later T5a.1c+ slice per ADR-0028 incremental leaf-first sequence.
import type { IncomingMessage } from 'node:http'

/**
 * Phase 7 — Observability: traceId propagation (D7).
 *
 * Extract a stable identifier from incoming requests so a single value
 * correlates the client request, every server log line, the response
 * envelope, and any downstream span. Precedence:
 *
 *   1. `traceparent` (W3C Trace Context — `00-{32-hex}-{16-hex}-{flags}`)
 *   2. `x-request-id` (Heroku / GCP / generic proxy header)
 *   3. Generated UUID (fresh per request)
 *
 * UUIDs are accepted as trace identifiers by every major vendor that
 * does not enforce strict 32-hex (Datadog, Honeycomb, Sentry, Logflare,
 * Axiom, etc). We don't need ULIDs to ship this surface.
 */

export const TRACE_HEADER = 'x-trace-id'
export const TRACE_PARENT_HEADER = 'traceparent'
const REQUEST_ID_HEADER = 'x-request-id'

// W3C Trace Context: 00-<trace-id 32 hex>-<span-id 16 hex>-<flags 2 hex>
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/

/**
 * Parse a W3C Trace Context `traceparent` header value. Returns the
 * 32-hex trace-id when valid (and not the reserved all-zeros), else
 * `null`.
 */
export function parseTraceparent(value: string): string | null {
  if (!value) return null
  const m = TRACEPARENT_RE.exec(value)
  if (!m) return null
  const traceId = m[1]
  // W3C: trace-id of all zeroes is invalid by spec
  if (/^0+$/.test(traceId)) return null
  return traceId
}

/**
 * Pick the first string value out of an IncomingMessage header. Node
 * collapses repeated headers into arrays; proxies sometimes do this for
 * `x-request-id`. Empty strings count as absent.
 */
function pickHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === 'string' && v.length > 0) return v
    }
    return null
  }
  if (typeof value === 'string' && value.length > 0) return value
  return null
}

/**
 * T5a.2 Phase C slice 1/2 — pure traceId resolution from pre-extracted
 * header values. Shared between IncomingMessage and Web Request wrappers.
 */
function resolveTraceIdFromHeaders(traceparent: string | null, requestId: string | null): string {
  if (traceparent !== null) {
    const parsed = parseTraceparent(traceparent)
    if (parsed !== null) return parsed
  }
  if (requestId !== null) return requestId
  return globalThis.crypto.randomUUID()
}

/**
 * Resolve the request's traceId following the precedence above.
 */
export function extractTraceId(req: IncomingMessage): string {
  return resolveTraceIdFromHeaders(
    pickHeader(req.headers[TRACE_PARENT_HEADER]),
    pickHeader(req.headers[REQUEST_ID_HEADER]),
  )
}

/**
 * T5a.2 Phase C slice 1/2 — Web-Standards-shaped traceId resolver.
 *
 * Mirror of `extractTraceId(req: IncomingMessage)` for the Web `Request`
 * shape. Same precedence (`traceparent` → `x-request-id` → generated
 * UUID). Uses `request.headers.get(name)` (native Web `Headers` API)
 * instead of the Node indexer.
 *
 * **Multi-value note:** Web `Headers` collapses repeated headers into a
 * single comma-separated string at parse. The IncomingMessage path's
 * `pickHeader` "first non-empty value" semantic is naturally satisfied
 * because there's no array to pick from on the Web side — `.get()`
 * returns the comma-joined value, which for `traceparent` / `x-request-id`
 * is treated as a single string anyway (both headers are conventionally
 * single-valued).
 */
export function extractTraceIdFromRequest(request: Request): string {
  return resolveTraceIdFromHeaders(
    request.headers.get(TRACE_PARENT_HEADER),
    request.headers.get(REQUEST_ID_HEADER),
  )
}
