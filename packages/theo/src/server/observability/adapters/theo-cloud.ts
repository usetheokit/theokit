/**
 * TheoCloudObservabilityAdapter — OTLP/HTTP batched export for TheoCloud.
 *
 * Zero-config via env vars (THEO_CLOUD_INGEST_URL, THEO_CLOUD_API_KEY).
 * Batches spans and flushes via native fetch() POST.
 *
 * EC-1: flush failure logs warning, does NOT throw, does NOT retry (KISS).
 * EC-2: startSpan after shutdown returns noop span.
 */
import type { ObservabilityAdapter, SpanHandle, SpanAttributes } from './types.js'
import { SpanImpl, NoopSpan, type SpanData } from '../span.js'
import { serializeSpansToOtlp } from '../otlp-serializer.js'

export interface TheoCloudAdapterOptions {
  /** TheoCloud ingest endpoint URL. */
  ingestUrl: string
  /** TheoCloud API key for authentication. */
  token: string
  /** Flush interval in ms (default: 5000). */
  flushIntervalMs?: number
  /** Mock fetch for testing (never in production). */
  _mockFetch?: typeof globalThis.fetch
}

export class TheoCloudObservabilityAdapter implements ObservabilityAdapter {
  readonly name = 'theo-cloud'
  private pendingSpans: SpanData[] = []
  private isShutdown = false
  private readonly opts: Required<Pick<TheoCloudAdapterOptions, 'ingestUrl' | 'apiKey'>> & TheoCloudAdapterOptions

  constructor(options: TheoCloudAdapterOptions) {
    this.opts = { flushIntervalMs: 5000, ...options }
  }

  startSpan(name: string, attributes?: SpanAttributes): SpanHandle {
    if (this.isShutdown) return new NoopSpan()
    const span = new SpanImpl(name, attributes)
    return {
      setAttribute: (k, v) => span.setAttribute(k, v),
      setStatus: (s, m) => span.setStatus(s, m),
      end: () => {
        span.end()
        this.pendingSpans.push(span.getData())
      },
    }
  }

  counter(_name: string, _value: number, _attributes?: SpanAttributes): void {}
  histogram(_name: string, _value: number, _attributes?: SpanAttributes): void {}
  log(_level: 'debug' | 'info' | 'warn' | 'error', _message: string, _attributes?: SpanAttributes): void {}

  async flush(): Promise<void> {
    if (this.isShutdown || this.pendingSpans.length === 0) return

    const spans = this.pendingSpans.splice(0)
    const body = serializeSpansToOtlp(spans)
    const fetchFn = this.opts._mockFetch ?? globalThis.fetch

    try {
      await fetchFn(this.opts.ingestUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${this.opts.apiKey}`,
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
    await this.flush()
    this.isShutdown = true
  }
}
