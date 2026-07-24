/**
 * NoopObservabilityAdapter — silent fallback.
 *
 * All methods are no-ops. Never throws, never blocks.
 * Used as the default when no other adapter is configured.
 * EC-2: startSpan after shutdown returns a noop span (no crash).
 */
import { NoopSpan } from '../span.js'

import type { ObservabilityAdapter, SpanHandle, SpanAttributes } from './types.js'

export class NoopObservabilityAdapter implements ObservabilityAdapter {
  readonly name = 'noop'
  private isShutdown = false

  startSpan(_name: string, _attributes?: SpanAttributes): SpanHandle {
    return new NoopSpan()
  }

  // Null Object: discarding the call IS the behaviour. An empty body is the honest
  // implementation — a fabricated one would only hide that from the next reader.
  /* eslint-disable @typescript-eslint/no-empty-function -- no-op adapter by design */
  counter(_name: string, _value: number, _attributes?: SpanAttributes): void {}
  histogram(_name: string, _value: number, _attributes?: SpanAttributes): void {}
  log(
    _level: 'debug' | 'info' | 'warn' | 'error',
    _message: string,
    _attributes?: SpanAttributes,
  ): void {}
  /* eslint-enable @typescript-eslint/no-empty-function */

  // Not `async`: there is nothing to await, and declaring it so would claim otherwise.
  flush(): Promise<void> {
    return Promise.resolve()
  }

  shutdown(): Promise<void> {
    this.isShutdown = true
    return Promise.resolve()
  }
}
