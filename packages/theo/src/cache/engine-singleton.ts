import { processSingleton } from '../core/process-singleton.js'

import type { CacheEngine, CacheEngineOptions } from './cache-engine.js'
import { createCacheEngine } from './cache-engine.js'
import { InMemoryCacheAdapter } from './in-memory-adapter.js'
import type { CacheStorageAdapter } from './storage-adapter.js'

export interface NormalizedCacheConfig {
  enabled: boolean
  storage: 'memory' | CacheStorageAdapter
  maxEntries: number
  defaults: {
    maxAge: number
    swr?: number
    cacheErrors: boolean
  }
}

// One engine per PROCESS, not per module instance. `theokit start` initializes the engine from the
// CLI build and `revalidateTag` reads it from the library build; a module-level `let` gave each
// build its own copy, so the route side always saw "not initialized" (usetheokit/theokit#1018).
const holder = processSingleton('cache-engine', () => ({
  engine: undefined as CacheEngine | undefined,
}))

/**
 * Initialize the singleton cache engine for this process.
 * Throws if called twice; tests should call `_resetCacheEngine()` between.
 */
export function initCacheEngine(
  config: NormalizedCacheConfig,
  hooks: Pick<CacheEngineOptions, 'onError'> = {},
): CacheEngine {
  if (holder.engine) {
    throw new Error(
      'Cache engine already initialized — call _resetCacheEngine() in tests, or check init order in production.',
    )
  }
  if (!config.enabled) {
    throw new Error(
      'initCacheEngine: config.enabled is false. Skip this call entirely when cache is disabled.',
    )
  }
  const adapter =
    config.storage === 'memory'
      ? new InMemoryCacheAdapter({ maxEntries: config.maxEntries })
      : config.storage
  holder.engine = createCacheEngine({
    storage: adapter,
    defaults: config.defaults,
    onError: hooks.onError,
  })
  return holder.engine
}

/**
 * Resolve the singleton cache engine.
 * Throws a clear error if not initialized — usually means the framework
 * bootstrap missed calling initCacheEngine, or cache.enabled is false.
 */
export function getCacheEngine(): CacheEngine {
  const engine = holder.engine
  if (!engine) {
    throw new Error(
      'Cache engine not initialized. Ensure theo.config.ts has `cache.enabled: true` and the framework bootstrap called initCacheEngine.',
    )
  }
  return engine
}

/**
 * Whether `initCacheEngine` has already run in this process.
 *
 * Exists so a caller can be idempotent WITHOUT wrapping `initCacheEngine` in a
 * `catch`. A boot legitimately reaches this state more than once — HMR, a second
 * server started in one process, an integration test booting twice in one worker
 * — and catching the throw to absorb that would swallow the genuine
 * double-initialisation bug the throw exists to report.
 */
export function isCacheEngineInitialized(): boolean {
  return holder.engine !== undefined
}

/**
 * Test-only: clear the singleton so the next test can re-init.
 * Production code MUST NOT call this.
 */
export function _resetCacheEngine(): void {
  holder.engine = undefined
}
