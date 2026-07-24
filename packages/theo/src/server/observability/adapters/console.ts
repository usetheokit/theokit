/**
 * ConsoleObservabilityAdapter — dev-mode console output.
 *
 * Emits JSON-structured lines to a configurable writer (default: process.stderr).
 * Inspired by Hono middleware timing pattern.
 */
import { SpanImpl, NoopSpan, type SpanData } from '../span.js'

import type { ObservabilityAdapter, SpanHandle, SpanAttributes } from './types.js'

interface ConsoleAdapterOptions {
  /** Writer function — defaults to process.stderr.write. */
  write?: (line: string) => void
}

export class ConsoleObservabilityAdapter implements ObservabilityAdapter {
  readonly name = 'console'
  private write: (line: string) => void
  private isShutdown = false
  private spans: SpanImpl[] = []

  constructor(options: ConsoleAdapterOptions = {}) {
    this.write = options.write ?? ((line: string) => process.stderr.write(line + '\n'))
  }

  startSpan(name: string, attributes?: SpanAttributes): SpanHandle {
    if (this.isShutdown) return new NoopSpan()
    const span = new SpanImpl(name, attributes)
    this.spans.push(span)
    return {
      setAttribute: (k, v) => {
        span.setAttribute(k, v)
      },
      setStatus: (s, m) => {
        span.setStatus(s, m)
      },
      end: () => {
        span.end()
        this.emitSpan(span.getData())
      },
    }
  }

  counter(name: string, value: number, attributes?: SpanAttributes): void {
    if (this.isShutdown) return
    this.emit({
      type: 'counter',
      metric: name,
      value,
      attributes: attributes ?? {},
      timestamp: Date.now(),
    })
  }

  histogram(name: string, value: number, attributes?: SpanAttributes): void {
    if (this.isShutdown) return
    this.emit({
      type: 'histogram',
      metric: name,
      value,
      attributes: attributes ?? {},
      timestamp: Date.now(),
    })
  }

  log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    attributes?: SpanAttributes,
  ): void {
    if (this.isShutdown) return
    this.emit({ type: 'log', level, message, attributes: attributes ?? {}, timestamp: Date.now() })
  }

  // Not `async`: this adapter writes synchronously, so there is nothing to await.
  flush(): Promise<void> {
    return Promise.resolve()
  }

  shutdown(): Promise<void> {
    this.isShutdown = true
    return Promise.resolve()
  }

  private emitSpan(data: SpanData): void {
    this.emit({
      type: 'span',
      name: data.name,
      status: data.status,
      duration_ms: data.durationMs ?? 0,
      attributes: data.attributes,
      timestamp: data.startTimeMs,
    })
  }

  private emit(record: Record<string, unknown>): void {
    this.write(JSON.stringify(record))
  }
}
