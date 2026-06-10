/**
 * Adapter registry — resolves the active observability adapter.
 *
 * Per ADR D457 (v1.1) priority chain:
 *   1. Explicit config (theo.config.ts observability.provider) — ALWAYS wins
 *   2. THEO_CLOUD_INGEST_URL env → theo-cloud adapter
 *   3. NODE_ENV=development → console adapter
 *   4. Fallback → noop adapter
 */
import type { ObservabilityAdapter } from './adapters/types.js'
import { NoopObservabilityAdapter } from './adapters/noop.js'
import { ConsoleObservabilityAdapter } from './adapters/console.js'
import { TheoCloudObservabilityAdapter } from './adapters/theo-cloud.js'

export interface ResolveAdapterOptions {
  env: Record<string, string | undefined>
  config?: {
    provider?: ObservabilityAdapter
  }
}

/**
 * Resolve the observability adapter from config + env.
 * Called once at boot — returns the active adapter for the process lifetime.
 */
export function resolveAdapter(options: ResolveAdapterOptions): ObservabilityAdapter {
  // 1. Explicit config ALWAYS wins (EC-4)
  if (options.config?.provider) {
    return options.config.provider
  }

  // 2. TheoCloud env vars → theo-cloud adapter
  const ingestUrl = options.env.THEO_CLOUD_INGEST_URL
  const apiKey = options.env.THEO_CLOUD_API_KEY
  if (ingestUrl && apiKey) {
    return new TheoCloudObservabilityAdapter({ ingestUrl, apiKey })
  }

  // 3. Development → console adapter
  if (options.env.NODE_ENV === 'development') {
    return new ConsoleObservabilityAdapter()
  }

  // 4. Fallback → noop
  return new NoopObservabilityAdapter()
}
