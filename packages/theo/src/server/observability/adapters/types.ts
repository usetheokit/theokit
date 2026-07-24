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

  /** Start a new span. Returns a handle to set attributes and end it. */
  startSpan(name: string, attributes?: SpanAttributes): SpanHandle

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
