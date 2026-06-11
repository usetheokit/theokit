export * from './logger.js'
export * from './audit-log.js'
export * from './suggest.js'

// Observability adapter registry
export type { ObservabilityAdapter, SpanHandle, SpanAttributes } from './adapters/types.js'
export { NoopObservabilityAdapter } from './adapters/noop.js'
export { ConsoleObservabilityAdapter } from './adapters/console.js'
export { TheoCloudObservabilityAdapter } from './adapters/theo-cloud.js'
export { resolveAdapter } from './adapter-registry.js'
export { createObservabilityPlugin } from './middleware.js'
export { defineObservabilityAdapter } from './define-adapter.js'
export { serializeSpansToOtlp } from './otlp-serializer.js'
export { SpanImpl, NoopSpan } from './span.js'
