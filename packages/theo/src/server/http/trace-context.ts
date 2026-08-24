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
 * What a valid `traceparent` says: the trace to join, and the caller's span
 * inside it.
 *
 * Both halves are on the wire and only the first was ever read, so a span this
 * process opened for an incoming request became a SECOND root of the caller's
 * trace instead of a child of the caller's span — the trace correlated and the
 * waterfall lost its shape (usetheokit/theokit#385).
 */
export interface W3CTraceContext {
  /** The trace this request belongs to. 32 hex chars. */
  readonly traceId: string
  /**
   * The caller's span, which a span opened for this request hangs under.
   *
   * Absent when the caller sent the reserved all-zero parent id, which W3C
   * defines as "no parent" rather than as a span to point at.
   */
  readonly parentSpanId?: string
}

/**
 * Parse a W3C Trace Context `traceparent` header value into the trace it names
 * and the caller's span within it. `null` when the value is not a well-formed
 * `traceparent` or names the reserved all-zero trace.
 */
export function parseTraceparentContext(value: string): W3CTraceContext | null {
  if (!value) return null
  const m = TRACEPARENT_RE.exec(value)
  if (!m) return null
  const traceId = m[1]
  // W3C: trace-id of all zeroes is invalid by spec
  if (/^0+$/.test(traceId)) return null
  const parentSpanId = m[2]
  // Same rule one field over: an all-zero parent-id is the spec's way of saying
  // there is no parent, so it is dropped rather than exported as a span id no
  // backend can resolve.
  return /^0+$/.test(parentSpanId) ? { traceId } : { traceId, parentSpanId }
}

/**
 * Parse a W3C Trace Context `traceparent` header value. Returns the
 * 32-hex trace-id when valid (and not the reserved all-zeros), else
 * `null`.
 */
export function parseTraceparent(value: string): string | null {
  return parseTraceparentContext(value)?.traceId ?? null
}

/**
 * Shape a correlation id must have to be trusted: printable, unpunctuated beyond
 * the separators real id formats use, and bounded.
 *
 * `x-request-id` is chosen by the caller and ends up in the structured logs an
 * operator reads. Unvalidated, a newline in it splits one log line into two with
 * the second forged, and a megabyte of it is a megabyte per request through the
 * whole log pipeline (usetheokit/theokit#353). The character set covers what real
 * id formats use — UUID, ULID, hex, dotted and colon-separated ids — and excludes
 * whitespace and control characters, which no id format needs and every injection
 * does.
 *
 * 128 is comfortably above any of those formats and far below a payload.
 */
const REQUEST_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/

function isTrustedRequestId(value: string): boolean {
  return REQUEST_ID_RE.test(value)
}

/**
 * Pick the first TRUSTED string value out of an IncomingMessage header. Node
 * collapses repeated headers into arrays; proxies sometimes do this for
 * `x-request-id`. Empty strings count as absent.
 *
 * "First trusted" rather than "first non-empty": taking the first value and
 * validating afterwards would let a proxy prepending a hostile value defeat a
 * good one sitting behind it.
 */
function pickHeader(
  value: string | string[] | undefined,
  isTrusted: (candidate: string) => boolean = () => true,
): string | null {
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === 'string' && v.length > 0 && isTrusted(v)) return v
    }
    return null
  }
  if (typeof value === 'string' && value.length > 0 && isTrusted(value)) return value
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
    pickHeader(req.headers[REQUEST_ID_HEADER], isTrustedRequestId),
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
/**
 * The request's W3C trace context — the trace to join and the caller's span
 * within it — or `undefined` when the caller supplied no usable `traceparent`.
 *
 * Deliberately narrower than {@link extractTraceIdFromRequest}, which always
 * returns something and may return an `x-request-id` or a generated UUID. Those
 * are fine as a log correlation key and are NOT trace ids: OTLP wants 32 hex
 * characters, and a dashed UUID exported as a `traceId` is a malformed span.
 *
 * So a span-emitting caller asks this question instead — "is there a real trace
 * to join?" — and mints its own when the answer is no (usetheokit/theokit#368).
 *
 * It answers with the whole context rather than the trace id alone, because a
 * span opened for this request belongs in the caller's trace AND under the
 * caller's span. Returning only the first half is what made one request arrive
 * as a trace with two roots (usetheokit/theokit#385).
 */
export function extractW3CTraceContext(request: Request): W3CTraceContext | undefined {
  const traceparent = request.headers.get(TRACE_PARENT_HEADER)
  if (traceparent === null) return undefined
  return parseTraceparentContext(traceparent) ?? undefined
}

export function extractTraceIdFromRequest(request: Request): string {
  const requestId = request.headers.get(REQUEST_ID_HEADER)
  return resolveTraceIdFromHeaders(
    request.headers.get(TRACE_PARENT_HEADER),
    // Same policy on both resolvers. A validation living on one side only is the
    // gap an attacker picks the other transport to reach.
    requestId !== null && isTrustedRequestId(requestId) ? requestId : null,
  )
}
