/**
 * SpanHandle implementation — records timing + attributes.
 *
 * Used by console and theo-cloud adapters. Noop adapter uses NoopSpan.
 */
import type { SpanHandle, SpanAttributes } from './adapters/types.js'

export interface SpanData {
  name: string
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

  constructor(name: string, attributes?: SpanAttributes) {
    this.data = {
      name,
      attributes: {},
      status: 'ok',
      startTimeMs: Date.now(),
    }
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

/** Noop span — used by NoopAdapter and post-shutdown fallback (EC-2). */
export class NoopSpan implements SpanHandle {
  setAttribute(): void {}
  setStatus(): void {}
  end(): void {}
}
