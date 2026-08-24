/**
 * ObservabilityAdapter — interface contract for all observability backends.
 *
 * Per ADR D455: framework adapter owns request/response spans.
 * SDK adapter owns agent/tool/LLM spans. Both can emit to the same backend.
 *
 * Per ADR D456: implementations can be lightweight (50 LoC OTLP serializer)
 * or full OTel SDK wrappers via defineObservabilityAdapter().
 */

export type SpanAttributes = Record<string, string | number | boolean | undefined>

/**
 * Where a span sits in a trace, supplied by whoever knows — the caller.
 *
 * A span cannot work this out for itself: `agent.tool` belongs under the
 * `agent.run` that opened it, and only the code holding both knows that. It
 * lives beside the adapter contract rather than beside `SpanImpl` because it is
 * part of what an adapter is asked to honour, including one written with
 * `defineObservabilityAdapter`.
 */
export interface SpanContextInput {
  /** The trace this span belongs to. 32 hex chars. */
  readonly traceId: string
  /** Pin this span's own id, so a child can name it as parent. Generated when absent. */
  readonly spanId?: string
  /** The span this one hangs under. Absent means this is the root of the trace. */
  readonly parentSpanId?: string
}

/** Handle to an active span — setAttribute, setStatus, end. */
export interface SpanHandle {
  /** Set a key-value attribute on this span. */
  setAttribute(key: string, value: string | number | boolean): void
  /** Set the span's status (ok, error). */
  setStatus(status: 'ok' | 'error', message?: string): void
  /** End the span (records duration). Idempotent — second call is a no-op. */
  end(): void
}

/** Core adapter interface. Every observability backend implements this. */
export interface ObservabilityAdapter {
  /** Human-readable adapter name (e.g., 'console', 'theo-cloud', 'noop'). */
  readonly name: string

  /**
   * Start a new span. Returns a handle to set attributes and end it.
   *
   * `context` places the span in a trace (usetheokit/theokit#368). It is optional
   * because most callers open a root span and do not care; a caller that opens
   * several spans for one logical operation passes it so they arrive at the
   * collector as one trace instead of N. It is passed IN rather than read back
   * off the handle because the handle deliberately exposes no identity, and
   * because a custom adapter then receives the ids whatever shape it stores.
   */
  startSpan(name: string, attributes?: SpanAttributes, context?: SpanContextInput): SpanHandle

  /** Increment a counter metric. */
  counter(name: string, value: number, attributes?: SpanAttributes): void

  /** Record a histogram value (e.g., duration, size). */
  histogram(name: string, value: number, attributes?: SpanAttributes): void

  /** Emit a structured log. */
  log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    attributes?: SpanAttributes,
  ): void

  /** Flush any buffered telemetry (async — may involve I/O). */
  flush(): Promise<void>

  /** Shutdown the adapter (flush + release resources). Idempotent. */
  shutdown(): Promise<void>
}
