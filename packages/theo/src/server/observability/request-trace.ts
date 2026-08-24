/**
 * One request, one trace — the side table both consumers read (usetheokit/theokit#404).
 *
 * ## The defect this exists to remove
 *
 * Two places decide what trace a request belongs to: the observability plugin, which opens the
 * `http.request` span, and `observeServedRun`, which opens `agent.run`. Both used to answer the
 * question the same way and *independently* — by reading the inbound `traceparent` header. That
 * agrees only while the header is there. A browser sends none, and neither does `curl` or an
 * uninstrumented `fetch`, so on the majority path each side took its own `?? newTraceId()` branch
 * and one request reached the collector as two disconnected traces, neither naming the other.
 *
 * Reading the same header is not sharing. This module is the sharing: the request's trace is
 * resolved ONCE, on first ask, and every later ask gets the same answer.
 *
 * ## Why a `WeakMap` keyed on the `Request`
 *
 * The two consumers already hold the same `Request` object — `serveThroughPluginLifecycle` builds
 * it once and hands that instance both to the hooks (as `PluginContext.request`) and to the
 * handler that calls `mountAgent`. So the request itself is already the shared thing, and a side
 * table keyed on it needs no new parameter threaded through `mountAgent`, no decoration contract,
 * and no signature change on either side.
 *
 * The two alternatives were weighed and rejected for reasons that outlive this comment:
 *
 * - `AsyncLocalStorage` is what an OTel Node SDK does, and it would work here — but it imports
 *   `node:async_hooks`, and `server/` holds a no-`node:*` invariant precisely so the same code
 *   serves the Web, Tauri and TUI targets (`rules/three-target-parity.md`). A `WeakMap` is plain
 *   ECMAScript and runs unchanged on every one of them.
 * - Threading a resolved context through `mountAgent`'s options is explicit, and it puts a
 *   telemetry concern in the signature of every route that might one day open a span. The entry
 *   above is the same value, reachable without the parameter.
 *
 * Keying on the object also disposes of the entry: the record dies with the request, with no cap,
 * no eviction and no leak — unlike the plugin's own span map, which is keyed by `requestId` and
 * needs `evictUntilRoom` for exactly that reason.
 *
 * ## What this does NOT do
 *
 * It does not open a span, and it does not claim one was opened. `outermostSpanId` stays unset
 * until something actually emits the request's outermost span, so a run with no `http.request`
 * span in scope stays the root of its own trace rather than naming a parent this process never
 * emitted. A dangling parent reads as a span that was lost in transit, which is a worse report
 * than an honest root.
 */
import { extractW3CTraceContext } from '../http/trace-context.js'

import { newTraceId } from './trace-context-propagation.js'

export interface RequestTrace {
  /** The trace every span caused by this request belongs to. 32 hex chars. */
  readonly traceId: string
  /** The CALLER's span, when the caller sent a well-formed `traceparent`. */
  readonly parentSpanId?: string
  /**
   * The outermost span THIS process opened for the request, once one has been opened.
   *
   * Undefined means nothing opened one — no observability plugin on this path, or a run started
   * outside an HTTP turn. Consumers treat it as "no local parent", never as an id to point at.
   */
  outermostSpanId?: string
}

const resolved = new WeakMap<Request, RequestTrace>()

/**
 * The request's trace, resolved once and memoized on the request itself.
 *
 * Idempotent by construction: the first caller decides — from the inbound `traceparent` when there
 * is one, from a fresh mint when there is not — and every caller after it, on either side of the
 * request, is handed that same decision.
 */
export function requestTrace(request: Request): RequestTrace {
  const existing = resolved.get(request)
  if (existing !== undefined) return existing

  const trace = resolve(request)
  resolved.set(request, trace)
  return trace
}

/** Decide a request's trace from what it carries. Called once per request, by `requestTrace`. */
function resolve(request: Request): RequestTrace {
  const inbound = extractW3CTraceContext(request)
  if (inbound === undefined) return { traceId: newTraceId() }
  if (inbound.parentSpanId === undefined) return { traceId: inbound.traceId }
  return { traceId: inbound.traceId, parentSpanId: inbound.parentSpanId }
}

/**
 * Record the span this process opened as the request's outermost one, so spans opened later in the
 * same request hang under it instead of beside it.
 *
 * First writer wins. A second outermost span for one request is a bug in the caller, and silently
 * re-pointing every later child at it would hide that bug behind a plausible waterfall.
 */
export function recordOutermostSpan(request: Request, spanId: string): void {
  const trace = requestTrace(request)
  trace.outermostSpanId ??= spanId
}
