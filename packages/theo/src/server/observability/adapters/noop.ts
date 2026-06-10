/**
 * NoopObservabilityAdapter — silent fallback.
 *
 * All methods are no-ops. Never throws, never blocks.
 * Used as the default when no other adapter is configured.
 * EC-2: startSpan after shutdown returns a noop span (no crash).
 */
import type { ObservabilityAdapter, SpanHandle, SpanAttributes } from './types.js'
import { NoopSpan } from '../span.js'

export class NoopObservabilityAdapter implements ObservabilityAdapter {
  readonly name = 'noop'
  private isShutdown = false

  startSpan(_name: string, _attributes?: SpanAttributes): SpanHandle {
    return new NoopSpan()
  }

  counter(_name: string, _value: number, _attributes?: SpanAttributes): void {}
  histogram(_name: string, _value: number, _attributes?: SpanAttributes): void {}
  log(_level: 'debug' | 'info' | 'warn' | 'error', _message: string, _attributes?: SpanAttributes): void {}

  async flush(): Promise<void> {}

  async shutdown(): Promise<void> {
    this.isShutdown = true
  }
}
