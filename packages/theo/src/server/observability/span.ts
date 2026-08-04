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

/**
 * Noop span — used by NoopAdapter and post-shutdown fallback (EC-2).
 *
 * Os três corpos vazios são o Null Object, não esquecimento (agent-builder#319): **não fazer nada**
 * é o comportamento contratado. Preenchê-los com um `void 0` ou um log só para calar o lint trocaria
 * uma intenção legível por ruído — e um log aqui rodaria no caminho pós-shutdown, que é justamente
 * onde não deve haver efeito nenhum.
 */
export class NoopSpan implements SpanHandle {
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- Null Object, ver acima
  setAttribute(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- Null Object, ver acima
  setStatus(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- Null Object, ver acima
  end(): void {}
}
