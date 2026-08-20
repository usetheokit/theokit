/**
 * TheoCloudObservabilityAdapter — OTLP/HTTP batched export for TheoCloud.
 *
 * Zero-config via env vars (THEO_CLOUD_INGEST_URL, THEO_CLOUD_API_KEY).
 * Batches spans and flushes via native fetch() POST.
 *
 * EC-1: flush failure logs warning, does NOT throw, does NOT retry (KISS).
 * EC-2: startSpan after shutdown returns noop span.
 */
import { serializeSpansToOtlp } from '../otlp-serializer.js'
import { SpanImpl, NoopSpan, type SpanData } from '../span.js'

import type { ObservabilityAdapter, SpanHandle, SpanAttributes, SpanContextInput } from './types.js'

interface TheoCloudAdapterOptions {
  /** TheoCloud ingest endpoint URL. */
  ingestUrl: string
  /** TheoCloud API key for authentication. */
  token: string
  /** Flush interval in ms (default: 5000). */
  flushIntervalMs?: number
  /**
   * Most spans held before the oldest are dropped (default: 10 000).
   *
   * A collector that is unreachable does not make the spans stop arriving, and a
   * buffer with no ceiling turns a telemetry outage into an out-of-memory. The
   * drop is counted rather than silent: losing data is a real cost, losing it
   * without saying so is a worse one.
   */
  maxPendingSpans?: number
  /** Mock fetch for testing (never in production). */
  _mockFetch?: typeof globalThis.fetch
}

export class TheoCloudObservabilityAdapter implements ObservabilityAdapter {
  readonly name = 'theo-cloud'
  private pendingSpans: SpanData[] = []
  private isShutdown = false
  private dropped = 0
  private readonly flushTimer: ReturnType<typeof setInterval>
  private readonly opts: Required<
    Pick<TheoCloudAdapterOptions, 'ingestUrl' | 'token' | 'flushIntervalMs' | 'maxPendingSpans'>
  > &
    TheoCloudAdapterOptions

  constructor(options: TheoCloudAdapterOptions) {
    this.opts = { flushIntervalMs: 5000, maxPendingSpans: 10_000, ...options }

    // `flushIntervalMs` was accepted and defaulted here and read nowhere — there
    // was no timer in the file. `shutdown()` was the only drain, and nothing
    // called it, so a long-running server exported nothing at all
    // (usetheokit/theokit#353).
    //
    // `unref()` is not optional: a telemetry exporter that pins the event loop
    // turns a clean process exit into a hang, which is worse than the defect it
    // was added to fix.
    this.flushTimer = setInterval(() => {
      void this.flush()
    }, this.opts.flushIntervalMs)
    this.flushTimer.unref()
  }

  /** How many spans were dropped because the buffer was full. */
  droppedSpanCount(): number {
    return this.dropped
  }

  /**
   * Whether the periodic flush is unref'd. A test seam: "the timer does not hold
   * the process open" is otherwise only observable by hanging.
   */
  hasUnrefdFlushTimer(): boolean {
    return !this.flushTimer.hasRef()
  }

  startSpan(name: string, attributes?: SpanAttributes, context?: SpanContextInput): SpanHandle {
    if (this.isShutdown) return new NoopSpan()
    const span = new SpanImpl(name, attributes, context)
    return {
      setAttribute: (k, v) => {
        span.setAttribute(k, v)
      },
      setStatus: (s, m) => {
        span.setStatus(s, m)
      },
      end: () => {
        span.end()
        if (this.pendingSpans.length >= this.opts.maxPendingSpans) {
          this.pendingSpans.shift()
          this.dropped++
        }
        this.pendingSpans.push(span.getData())
      },
    }
  }

  /* eslint-disable @typescript-eslint/no-empty-function -- metrics not shipped by this adapter yet; an empty body is honest, a fabricated one is not */
  counter(_name: string, _value: number, _attributes?: SpanAttributes): void {}
  histogram(_name: string, _value: number, _attributes?: SpanAttributes): void {}
  log(
    _level: 'debug' | 'info' | 'warn' | 'error',
    _message: string,
    _attributes?: SpanAttributes,
  ): void {}
  /* eslint-enable @typescript-eslint/no-empty-function */

  async flush(): Promise<void> {
    if (this.isShutdown || this.pendingSpans.length === 0) return

    const spans = this.pendingSpans.splice(0)
    const body = serializeSpansToOtlp(spans) as unknown as BodyInit
    const fetchFn = this.opts._mockFetch ?? globalThis.fetch

    try {
      await fetchFn(this.opts.ingestUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.opts.token}`,
        },
        body,
      })
    } catch (err) {
      // EC-1: log warning, don't throw, don't retry
      console.error(
        `[theokit:observability] flush failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      )
    }
  }

  async shutdown(): Promise<void> {
    if (this.isShutdown) return
    // Cleared, not merely ignored: `isShutdown` would make later ticks no-ops,
    // and a live handle on a process that is trying to exit is the thing to
    // remove rather than to tolerate.
    clearInterval(this.flushTimer)
    await this.flush()
    this.isShutdown = true
  }
}
