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
 *   startSpan: (name, attrs, context) => { ... },
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
import type {
  ObservabilityAdapter,
  SpanHandle,
  SpanAttributes,
  SpanContextInput,
} from './adapters/types.js'

interface DefineAdapterConfig {
  name: string
  /**
   * `context` is optional to implement and NOT optional to receive: the wrapper
   * forwards it verbatim. An adapter that ignores it still works — it simply
   * exports spans with identities of its own — but one that wants to place a
   * span in a trace is not prevented from doing so by this seam. Dropping the
   * argument here would have made the built-in adapters trace-aware and every
   * custom one permanently trace-blind, with nothing in the types saying so
   * (usetheokit/theokit#368).
   */
  startSpan(name: string, attributes?: SpanAttributes, context?: SpanContextInput): SpanHandle
  counter(name: string, value: number, attributes?: SpanAttributes): void
  histogram(name: string, value: number, attributes?: SpanAttributes): void
  log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    attributes?: SpanAttributes,
  ): void
  flush(): Promise<void>
  shutdown(): Promise<void>
}

export function defineObservabilityAdapter(config: DefineAdapterConfig): ObservabilityAdapter {
  return {
    name: config.name,
    startSpan: (name, attrs, context) => config.startSpan(name, attrs, context),
    counter: (name, value, attrs) => {
      config.counter(name, value, attrs)
    },
    histogram: (name, value, attrs) => {
      config.histogram(name, value, attrs)
    },
    log: (level, message, attrs) => {
      config.log(level, message, attrs)
    },
    flush: () => config.flush(),
    shutdown: () => config.shutdown(),
  }
}
