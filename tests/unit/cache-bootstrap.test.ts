import { describe, it, expect, beforeEach } from 'vitest'

import {
  _resetCacheEngine,
  getCacheEngine,
  isCacheEngineInitialized,
} from '../../packages/theo/src/cache/engine-singleton.js'
import { initCacheEngineFromConfig } from '../../packages/theo/src/server/cache-bootstrap.js'
import { revalidateTag } from '../../packages/theo/src/cache/revalidate.js'

/**
 * B-009 / usetheokit/theokit#352 — `initCacheEngine` had no production caller
 * while `getCacheEngine` had three, so `revalidateTag`, `updateTag` and
 * `revalidatePath` — all exported publicly — threw "Cache engine not
 * initialized" in every application. The subsystem was not dead code; it was a
 * bridge with one half published and the other half never built.
 *
 * The wrapper is deliberately idempotent rather than wrapped in a `catch`.
 * `initCacheEngine` throws on a second call and throws again when `enabled` is
 * false, and both are states a boot legitimately reaches — HMR, a second server
 * in one process, `cache: { enabled: false }`. Catching them would swallow the
 * real double-init error along with them.
 */

beforeEach(() => {
  _resetCacheEngine()
})

describe('cache engine bootstrap (B-009)', () => {
  it('test_absent_cache_config_leaves_the_engine_uninitialised', async () => {
    await initCacheEngineFromConfig(undefined)

    expect(isCacheEngineInitialized()).toBe(false)
  })

  it('test_empty_cache_config_opts_in_with_defaults', async () => {
    await initCacheEngineFromConfig({})

    expect(isCacheEngineInitialized()).toBe(true)
    expect(() => getCacheEngine()).not.toThrow()
  })

  it('test_revalidate_tag_no_longer_throws_once_the_boot_has_run', async () => {
    await initCacheEngineFromConfig({})

    await expect(revalidateTag('posts')).resolves.not.toThrow()
  })

  it('test_disabled_cache_does_not_crash_the_boot', async () => {
    await expect(initCacheEngineFromConfig({ enabled: false })).resolves.toBeUndefined()

    expect(isCacheEngineInitialized()).toBe(false)
  })

  it('test_second_boot_in_the_same_process_is_a_no_op_not_a_crash', async () => {
    await initCacheEngineFromConfig({})
    const first = getCacheEngine()

    await expect(initCacheEngineFromConfig({})).resolves.toBeUndefined()

    expect(getCacheEngine()).toBe(first)
  })

  it('test_a_malformed_cache_config_is_refused_by_name_rather_than_booting_half_configured', async () => {
    await expect(initCacheEngineFromConfig({ maxEntries: -1 })).rejects.toThrow(/maxEntries/)

    expect(isCacheEngineInitialized()).toBe(false)
  })
})
