/**
 * SpanHandle implementation — records timing + attributes.
 *
 * Used by console and theo-cloud adapters. Noop adapter uses NoopSpan.
 */
import type { SpanHandle, SpanAttributes, SpanContextInput } from './adapters/types.js'
import { newSpanId, newTraceId } from './trace-context-propagation.js'

export interface SpanData {
  name: string
  /**
   * The trace this span belongs to, and the span's own id within it.
   *
   * These used to not exist, and the OTLP serializer minted a `traceId` per span
   * at export time. Every export was well-formed and every span was an island: a
   * five-span agent run reached the collector as five unrelated single-span
   * traces, so "read the run back from an exported trace" had nothing to read
   * (usetheokit/theokit#368). Identity belongs to the span, decided when it
   * starts, not to the exporter, guessed when it leaves.
   */
  traceId: string
  spanId: string
  /** Absent on the root span of a trace. */
  parentSpanId?: string
  attributes: Record<string, string | number | boolean>
  status: 'ok' | 'error'
  statusMessage?: string
  startTimeMs: number
  endTimeMs?: number
  durationMs?: number
}

export class SpanImpl implements SpanHandle {
  private readonly data: SpanData
  private ended = false

  constructor(name: string, attributes?: SpanAttributes, context?: SpanContextInput) {
    this.data = {
      name,
      traceId: context?.traceId ?? newTraceId(),
      spanId: context?.spanId ?? newSpanId(),
      attributes: {},
      status: 'ok',
      startTimeMs: Date.now(),
    }
    if (context?.parentSpanId !== undefined) this.data.parentSpanId = context.parentSpanId
    if (attributes) {
      for (const [k, v] of Object.entries(attributes)) {
        if (v !== undefined) this.data.attributes[k] = v
      }
    }
  }

  setAttribute(key: string, value: string | number | boolean): void {
    if (!this.ended) this.data.attributes[key] = value
  }

  setStatus(status: 'ok' | 'error', message?: string): void {
    if (!this.ended) {
      this.data.status = status
      this.data.statusMessage = message
    }
  }

  end(): void {
    if (this.ended) return // idempotent
    this.ended = true
    this.data.endTimeMs = Date.now()
    this.data.durationMs = this.data.endTimeMs - this.data.startTimeMs
  }

  /** Read-only access to span data (for adapters to export). */
  getData(): SpanData {
    return { ...this.data, attributes: { ...this.data.attributes } }
  }

  isEnded(): boolean {
    return this.ended
  }
}

/**
 * Noop span — used by NoopAdapter and post-shutdown fallback (EC-2).
 *
 * The three empty bodies are the Null Object, not forgetfulness (agent-builder#319): **doing
 * nothing** is the contracted behaviour. Filling them with a `void 0` or a log just to silence the
 * lint would trade a readable intention for noise — and a log here would run on the post-shutdown
 * path, which is precisely where there must be no effect at all.
 */
export class NoopSpan implements SpanHandle {
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- Null Object, see above
  setAttribute(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- Null Object, see above
  setStatus(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- Null Object, see above
  end(): void {}
}
