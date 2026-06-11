/**
 * defineObservabilityAdapter() — public API for custom adapters.
 *
 * The escape hatch for self-host users who want Datadog, Grafana, Honeycomb, etc.
 * Validates the adapter shape and returns a typed ObservabilityAdapter.
 *
 * @example
 * ```ts
 * const datadogAdapter = defineObservabilityAdapter({
 *   name: 'datadog',
 *   startSpan: (name, attrs) => { ... },
 *   counter: (name, value) => { ... },
 *   histogram: (name, value) => { ... },
 *   log: (level, message) => { ... },
 *   flush: async () => { ... },
 *   shutdown: async () => { ... },
 * })
 *
 * // theo.config.ts
 * export default defineConfig({
 *   observability: { provider: datadogAdapter },
 * })
 * ```
 */
import type { ObservabilityAdapter, SpanHandle, SpanAttributes } from './adapters/types.js'

export interface DefineAdapterConfig {
  name: string
  startSpan(name: string, attributes?: SpanAttributes): SpanHandle
  counter(name: string, value: number, attributes?: SpanAttributes): void
  histogram(name: string, value: number, attributes?: SpanAttributes): void
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, attributes?: SpanAttributes): void
  flush(): Promise<void>
  shutdown(): Promise<void>
}

export function defineObservabilityAdapter(config: DefineAdapterConfig): ObservabilityAdapter {
  return {
    name: config.name,
    startSpan: (name, attrs) => config.startSpan(name, attrs),
    counter: (name, value, attrs) => config.counter(name, value, attrs),
    histogram: (name, value, attrs) => config.histogram(name, value, attrs),
    log: (level, message, attrs) => config.log(level, message, attrs),
    flush: () => config.flush(),
    shutdown: () => config.shutdown(),
  }
}
