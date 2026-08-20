/**
 * Auto-instrumentation plugin — one span per HTTP request.
 *
 * Per blueprint Pattern 2 (Hono middleware timing):
 * - onRequest: start span with method + path
 * - onResponse: end span with status + duration
 * - onError: set span status to error
 *
 * ## It used to be unregistrable, and nothing said so
 *
 * This returned `{ name, onRequest, onResponse, onError }` against a plugin
 * contract of `{ name, register }`, so the obvious wiring — putting it in
 * `config.plugins` — threw `InvalidPluginShapeError` at boot
 * (`../plugins/load-plugins.ts:20`). Its own context type was a second, narrower
 * invention: `request: { method, url }` where the real hook receives a Web
 * `Request` with an ABSOLUTE url, and `response?: { statusCode }` where the real
 * one is a `ServerResponse`. The tests passed because they called the hooks
 * directly with the invented shape, which verified the implementation and never
 * the contract (usetheokit/theokit#353).
 *
 * ## Span state is per-instance, and bounded
 *
 * The active-span map used to be a module-level `Map` with no cap and no TTL.
 * Two consequences, both real once anything registered this:
 *
 *   - two plugin instances shared one map, so one app's response closed
 *     another's span;
 *   - a request whose `onResponse` never fires leaked its span forever. That is
 *     not an edge case here: the SSE path is exactly where `onResponse` does not
 *     fire on stream open, and an agent run is the longest-lived stream the
 *     framework serves.
 *
 * The map now lives in the closure and is capped. An evicted span is ENDED with
 * an `span.abandoned` attribute rather than dropped, so it still reaches the
 * exporter carrying the reason it was cut — trading a memory leak for a silent
 * hole in the trace would be the worse bargain.
 */
import { extractW3CTraceContext } from '../http/trace-context.js'
import type { PluginContext, PluginErrorContext, TheoApp, TheoPlugin } from '../plugin-types.js'

import type { ObservabilityAdapter, SpanContextInput, SpanHandle } from './adapters/types.js'
import { newTraceId } from './trace-context-propagation.js'

/**
 * How many requests may be in flight with an unclosed span before the oldest is
 * force-ended. Sized to be far above any real concurrent-request count on a
 * single Node process, so eviction signals a leak rather than back-pressure.
 */
const DEFAULT_MAX_ACTIVE_SPANS = 1024

export interface ObservabilityPluginOptions {
  /** Override the in-flight span cap. Mainly a test seam. */
  maxActiveSpans?: number
}

export function createObservabilityPlugin(
  adapter: ObservabilityAdapter,
  options: ObservabilityPluginOptions = {},
): TheoPlugin {
  const maxActiveSpans = options.maxActiveSpans ?? DEFAULT_MAX_ACTIVE_SPANS
  const activeSpans = new Map<string, SpanHandle>()

  /** Force-end the oldest spans until there is room for one more. */
  function evictUntilRoom(): void {
    while (activeSpans.size >= maxActiveSpans) {
      const oldest = activeSpans.keys().next()
      if (oldest.done === true) return
      const span = activeSpans.get(oldest.value)
      activeSpans.delete(oldest.value)
      if (span === undefined) continue
      span.setAttribute('span.abandoned', true)
      span.setStatus('error', 'span abandoned: onResponse never fired for this request')
      span.end()
    }
  }

  /**
   * Where the request's span sits: in the caller's trace, under the caller's
   * span, when the caller sent a `traceparent` (usetheokit/theokit#385).
   *
   * This is the OUTERMOST span of a request, which makes it precisely the caller
   * `startSpan`'s optional `context` was written for — and precisely the caller
   * that went on passing the two-argument form. The consequence was worse than
   * "the HTTP span is a root": once `mountAgent` learned to continue an incoming
   * trace, one request that ran an agent reached the collector as TWO
   * disconnected traces, and the caller's trace id was present on the HTTP span
   * as the `requestId` attribute rather than as its `traceId` — resolved,
   * carried, and written to a field no tracing backend correlates on.
   *
   * No `traceparent` (or a malformed one) mints a fresh trace, which is the
   * correct answer for a request nothing upstream traced. `extractW3CTraceContext`
   * deliberately refuses `x-request-id` and dashed UUIDs: those are fine
   * correlation keys and are not trace ids.
   */
  function inboundContext(request: Request): SpanContextInput {
    const inbound = extractW3CTraceContext(request)
    if (inbound === undefined) return { traceId: newTraceId() }
    return inbound.parentSpanId === undefined
      ? { traceId: inbound.traceId }
      : { traceId: inbound.traceId, parentSpanId: inbound.parentSpanId }
  }

  /** Take the span for a request, if one is still open. */
  function claim(requestId: string): SpanHandle | undefined {
    const span = activeSpans.get(requestId)
    if (span === undefined) return undefined
    activeSpans.delete(requestId)
    return span
  }

  return {
    name: 'theokit:observability',

    register(app: TheoApp): void {
      app.addHook('onRequest', (ctx: PluginContext) => {
        evictUntilRoom()
        const span = adapter.startSpan(
          'http.request',
          {
            method: ctx.request.method,
            // `ctx.request.url` is absolute, because that is what a Web `Request`
            // carries (`plugin-types.ts` says so, at length, for this reason).
            path: new URL(ctx.request.url).pathname,
            requestId: ctx.requestId,
          },
          inboundContext(ctx.request),
        )
        activeSpans.set(ctx.requestId, span)
      })

      app.addHook('onResponse', (ctx: PluginContext) => {
        const span = claim(ctx.requestId)
        if (span === undefined) return

        const status = ctx.response.statusCode
        span.setAttribute('status', status)
        span.setStatus('ok')
        span.end()

        // Deliberately no `path` label: a counter is an aggregated series, and
        // a dynamic route would mint one series per id.
        adapter.counter('http.requests', 1, { method: ctx.request.method, status })
      })

      app.addHook('onError', (ctx: PluginErrorContext) => {
        const span = claim(ctx.requestId)
        if (span === undefined) return

        const message = ctx.error instanceof Error ? ctx.error.message : 'unknown error'
        span.setAttribute('error', true)
        span.setStatus('error', message)
        span.end()

        adapter.counter('http.errors', 1, { method: ctx.request.method })
      })
    },
  }
}
