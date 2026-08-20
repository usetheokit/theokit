import type { NormalizedCacheConfig } from '../cache/engine-singleton.js'

/**
 * Initialize the singleton cache engine from `theo.config.ts > cache` (#352).
 *
 * Until this existed, `initCacheEngine` had no production caller while
 * `getCacheEngine` had three — so `revalidateTag`, `updateTag` and
 * `revalidatePath`, all exported publicly, threw "Cache engine not initialized"
 * in every application. The subsystem was not unreachable code; it was a bridge
 * with one half published and the other half never built.
 *
 * Three states a boot legitimately reaches, each handled by a guard rather than
 * by a `catch`, because `initCacheEngine` throws on all three and absorbing the
 * throws would absorb the real double-init bug with them:
 *
 *   - no `cache` key at all — the framework stays backward compatible, no engine
 *   - `enabled: false` — an explicit opt-out, not an error
 *   - already initialized — HMR, a second server in one process, a test booting
 *     twice in one worker
 *
 * Unlike `configureStorageManagerFromConfig`, its sibling in the CLI bootstrap,
 * a malformed config is NOT
 * degraded into a warning here, and the divergence is deliberate. Warning and
 * continuing would boot an application whose `revalidateTag` still throws — the
 * exact defect this function exists to remove, restored silently and now
 * attributable to nothing.
 */
export async function initCacheEngineFromConfig(cacheConfig: unknown): Promise<void> {
  if (cacheConfig === undefined || cacheConfig === null) return

  const { initCacheEngine, isCacheEngineInitialized } = await import('../cache/engine-singleton.js')
  if (isCacheEngineInitialized()) return

  const { cacheSchema } = await import('../config/schemas/index.js')
  const parsed = cacheSchema.parse(cacheConfig)
  if (!parsed.enabled) return

  initCacheEngine({
    enabled: parsed.enabled,
    // The schema accepts `'memory'` or a caller-supplied adapter instance, which
    // it cannot type beyond `unknown` without importing the adapter contract
    // into the config layer.
    storage: parsed.storage as NormalizedCacheConfig['storage'],
    maxEntries: parsed.maxEntries,
    defaults: parsed.defaults,
  })
}
