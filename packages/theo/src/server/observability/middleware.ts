/**
 * Auto-instrumentation middleware — creates spans for every HTTP request.
 *
 * Registers as a standard TheoKit plugin via existing hook system.
 * No changes to plugin-runner needed.
 *
 * Per blueprint Pattern 2 (Hono middleware timing):
 * - onRequest: start span with method + path
 * - onResponse: end span with status + duration
 * - onError: set span status to error
 */
import type { ObservabilityAdapter, SpanHandle } from './adapters/types.js'

export interface PluginContext {
  requestId: string
  request: { method: string; url: string }
  response?: { statusCode: number }
}

export interface ObservabilityPlugin {
  name: string
  onRequest(ctx: PluginContext): Promise<void>
  onResponse(ctx: PluginContext): Promise<void>
  onError(ctx: PluginContext & { error: unknown }): Promise<void>
}

// Active spans keyed by requestId — cleared on response/error
const activeSpans = new Map<string, SpanHandle>()

/**
 * Create an observability plugin that auto-instruments HTTP requests.
 *
 * EC-5: For SSE responses, span ends on response close, not headers sent.
 * The caller should invoke onResponse when the stream actually closes.
 */
export function createObservabilityPlugin(adapter: ObservabilityAdapter): ObservabilityPlugin {
  return {
    name: 'theokit:observability',

    async onRequest(ctx: PluginContext): Promise<void> {
      const url = new URL(ctx.request.url, 'http://localhost')
      const span = adapter.startSpan('http.request', {
        method: ctx.request.method,
        path: url.pathname,
        requestId: ctx.requestId,
      })
      activeSpans.set(ctx.requestId, span)
    },

    async onResponse(ctx: PluginContext): Promise<void> {
      const span = activeSpans.get(ctx.requestId)
      if (!span) return
      activeSpans.delete(ctx.requestId)

      if (ctx.response) {
        span.setAttribute('status', ctx.response.statusCode)
      }
      span.setStatus('ok')
      span.end()

      adapter.counter('http.requests', 1, {
        method: ctx.request.method,
        status: ctx.response?.statusCode ?? 0,
      })
    },

    async onError(ctx: PluginContext & { error: unknown }): Promise<void> {
      const span = activeSpans.get(ctx.requestId)
      if (!span) return
      activeSpans.delete(ctx.requestId)

      const message = ctx.error instanceof Error ? ctx.error.message : 'unknown error'
      span.setAttribute('error', true)
      span.setStatus('error', message)
      span.end()

      adapter.counter('http.errors', 1, {
        method: ctx.request.method,
      })
    },
  }
}
