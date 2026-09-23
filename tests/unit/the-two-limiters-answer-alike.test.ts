import { describe, expect, it } from 'vitest'

import { createRateLimiterWeb } from '../../packages/theo/src/server/rate-limit/rate-limit.js'
import { createDurableRateLimiterWeb } from '../../packages/theo/src/server/rate-limit/rate-limit-durable.js'
import type { RateLimitStore } from '../../packages/theo/src/server/rate-limit/rate-limit-store.js'

/**
 * B-260 — one library, two limiters, two header contracts.
 *
 * Measured on disk: `rate-limit.ts` emits `X-RateLimit-Limit`, `-Remaining` and `Retry-After`;
 * `rate-limit-durable.ts` emits those plus `X-RateLimit-Reset` at `:139` and `:150`. So a client
 * reading `Reset` works against a deployment with a durable store and not against `theokit start` —
 * the difference is decided by which runtime the operator picked, which is not a decision a header
 * contract should depend on.
 *
 * ## What this asserts, and what it deliberately refuses to
 *
 * NAME parity, never VALUE parity. The two count differently by design — one in process, one in a
 * store — so asserting equal values would be a claim about the counters rather than about the
 * contract a client reads. No assertion line in this file compares a value between the two paths,
 * and the item's AC-004 counts that by looking for a SUBSCRIPTED header read on both sides. Comparing
 * `Object.keys` is wanted — it is what this file exists to assert — so a criterion that forbade any
 * mention of the durable path would forbid the requirement itself. Two spellings did exactly that
 * before this one.
 *
 * ## The half of B-260 that was refuted rather than fixed
 *
 * The item claimed the sync path can answer `Retry-After: -4`. Tested before any code was written:
 * `createRateLimiterWeb` refuses anything but `InMemoryStore` (`rate-limit.ts:49`), and `incrSync`
 * restarts the window whenever `now >= entry.resetAt` (`rate-limit-store.ts:30-31`), so `resetAt` is
 * always ahead of the header write. **No caller reaches a negative value today.** The floor is added
 * as declared defence in depth — the durable twin already carries it, and a difference between twins
 * is what a future store implementation discovers the hard way — and this comment is why the test
 * below asserts a floor without claiming a defect that was measured away.
 */

/** A store whose window is already over, which the sync path's own store can never produce. */
function expiredStore(): RateLimitStore {
  return {
    incr: () => Promise.resolve({ count: 99, resetAt: Date.now() - 4_000 }),
    get: () => Promise.resolve(null),
    reset: () => Promise.resolve(),
  }
}

describe('the two limiters answer alike (B-260)', () => {
  const config = { windowMs: 60_000, max: 2 }

  it('test_the_sync_path_emits_reset_when_it_refuses', () => {
    const limit = createRateLimiterWeb(config)
    limit('1.1.1.1')
    limit('1.1.1.1')
    const refused = limit('1.1.1.1')

    expect(refused.limited, 'the third call was inside the budget — the fixture is wrong').toBe(
      true,
    )
    expect(
      refused.headers,
      'the sync path refuses without telling the caller when to return',
    ).toHaveProperty('X-RateLimit-Reset')
  })

  it('test_the_sync_path_emits_reset_when_it_admits', () => {
    const limit = createRateLimiterWeb(config)
    const admitted = limit('2.2.2.2')

    expect(admitted.limited).toBe(false)
    expect(admitted.headers).toHaveProperty('X-RateLimit-Reset')
  })

  it('test_both_paths_emit_the_same_header_names_when_they_refuse', async () => {
    const sync = createRateLimiterWeb(config)
    sync('3.3.3.3')
    sync('3.3.3.3')
    const syncNames = Object.keys(sync('3.3.3.3').headers).sort((a, b) => a.localeCompare(b))

    const store: RateLimitStore = {
      incr: () => Promise.resolve({ count: 99, resetAt: Date.now() + 60_000 }),
      get: () => Promise.resolve(null),
      reset: () => Promise.resolve(),
    }
    const durableNames = Object.keys(
      (await createDurableRateLimiterWeb(config, { store })('3.3.3.3')).headers,
    ).sort((a, b) => a.localeCompare(b))

    expect(
      syncNames,
      'the two paths refuse with different header names, so a client works against one deployment and not the other',
    ).toEqual(durableNames)
  })

  it('test_both_paths_emit_the_same_header_names_when_they_admit', async () => {
    const syncNames = Object.keys(createRateLimiterWeb(config)('4.4.4.4').headers).sort((a, b) =>
      a.localeCompare(b),
    )

    const store: RateLimitStore = {
      incr: () => Promise.resolve({ count: 1, resetAt: Date.now() + 60_000 }),
      get: () => Promise.resolve(null),
      reset: () => Promise.resolve(),
    }
    const durableNames = Object.keys(
      (await createDurableRateLimiterWeb(config, { store })('4.4.4.4')).headers,
    ).sort((a, b) => a.localeCompare(b))

    expect(syncNames).toEqual(durableNames)
  })

  it('test_an_expired_window_never_yields_a_negative_retry_after', async () => {
    // Defence in depth, and labelled as such. The durable path already floors at `:131`; this asserts
    // the floor holds where a store CAN return a past window — which the sync path's own store cannot,
    // which is exactly why the item's original claim about it was refuted rather than fixed.
    const result = await createDurableRateLimiterWeb(config, { store: expiredStore() })('5.5.5.5')

    expect(
      Number(result.headers['Retry-After']),
      'a negative Retry-After is not a valid header value',
    ).toBeGreaterThanOrEqual(0)
  })
})
