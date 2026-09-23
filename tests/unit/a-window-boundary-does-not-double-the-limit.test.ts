import { describe, expect, it } from 'vitest'

import { createDurableRateLimiterWeb } from '../../packages/theo/src/server/rate-limit/rate-limit-durable.js'
import { InMemoryStore } from '../../packages/theo/src/server/rate-limit/rate-limit-store.js'
import type { RateLimitStore } from '../../packages/theo/src/server/rate-limit/rate-limit-store.js'

/**
 * B-261 — a fixed window lets twice the limit through at its boundary.
 *
 * Measured by execution before any code: `windowMs: 400, max: 5` admitted **10 requests in ~405ms**,
 * a factor of exactly 2. The cause is the contract, not an implementation slip — `incr(key, windowMs)`
 * returns `{ count, resetAt }` with `resetAt` pinned at the first request of a window
 * (`rate-limit-store.ts:30-31`), which is a fixed-window counter. Fill it late, cross `resetAt`, fill
 * the next one early, and two budgets are spent inside one window's worth of time.
 *
 * Every store inherits it, because it IS the interface.
 *
 * ## Why a sliding-window counter and not a token bucket
 *
 * A token bucket admits bursts by design, so adopting one would change what a declared `max` MEANS.
 * The sliding-window counter keeps the declared meaning — at most `max` in any `windowMs` — and
 * removes the doubling, by weighting the previous window's count by how much of it is still inside
 * the sliding window.
 *
 * ## Why `previousCount` is optional
 *
 * A third-party store that has not been updated returns `{ count, resetAt }` and nothing else. It
 * keeps working, with the burst it already had, rather than breaking. `RateLimitState` is a type and
 * `docs/api/rate-limit-subpath-surface.md` excludes types from its verdicts by design, so the field
 * is additive with no surface decision to make.
 */
describe('a window boundary does not double the limit (B-261)', () => {
  it('test_the_total_admitted_across_a_boundary_stays_within_the_budget', async () => {
    // The measurement that defines the item. Before the fix this admitted 10 of a nominal 5.
    const store = new InMemoryStore()
    const limit = createDurableRateLimiterWeb({ windowMs: 400, max: 5 }, { store })

    let admitted = 0
    for (let i = 0; i < 5; i += 1) {
      if (!(await limit('1.1.1.1')).limited) admitted += 1
    }
    const state = await store.get('1.1.1.1')
    const wait = (state?.resetAt ?? Date.now()) - Date.now() + 5
    await new Promise((resolve) => setTimeout(resolve, wait))

    for (let i = 0; i < 5; i += 1) {
      if (!(await limit('1.1.1.1')).limited) admitted += 1
    }

    expect(
      admitted,
      `${String(admitted)} admitted across the boundary against a nominal 5 — the fixed-window burst`,
    ).toBeLessThanOrEqual(5)
  })

  it('test_a_store_that_omits_previous_count_still_limits', async () => {
    // FR-003. An un-updated third-party store keeps its current behaviour rather than throwing or
    // admitting everything — the compatibility line that makes the field safe to add.
    let count = 0
    const legacy: RateLimitStore = {
      incr: () => {
        count += 1
        return Promise.resolve({ count, resetAt: Date.now() + 60_000 })
      },
      get: () => Promise.resolve(null),
      reset: () => Promise.resolve(),
    }
    const limit = createDurableRateLimiterWeb({ windowMs: 60_000, max: 2 }, { store: legacy })

    expect((await limit('2.2.2.2')).limited, 'first, inside the budget').toBe(false)
    expect((await limit('2.2.2.2')).limited, 'second, inside the budget').toBe(false)
    expect((await limit('2.2.2.2')).limited, 'third, over the budget').toBe(true)
  })

  it('test_an_idle_caller_pays_nothing_for_a_neighbour', async () => {
    // AC-004. A weighting that charged one key for another's traffic would be worse than the burst,
    // so this drives two keys through the same store and asserts the second is unaffected.
    const store = new InMemoryStore()
    const limit = createDurableRateLimiterWeb({ windowMs: 60_000, max: 3 }, { store })

    for (let i = 0; i < 3; i += 1) await limit('3.3.3.3')
    expect((await limit('3.3.3.3')).limited, 'the busy key should be over budget').toBe(true)

    expect(
      (await limit('9.9.9.9')).limited,
      'an idle key was refused — the weighting is mixing callers',
    ).toBe(false)
  })
  it('test_the_sync_path_gets_the_same_boundary_guarantee', async () => {
    // Found by review, by driving the OTHER path. I fixed the durable limiter and left the sync one
    // admitting 10 — which is the exact divergence B-260 had just closed on the header contract,
    // reintroduced on a different axis one item later. Two limiters over one store must not disagree
    // about what `max` means.
    const { createRateLimiterWeb } =
      await import('../../packages/theo/src/server/rate-limit/rate-limit.js')
    const limit = createRateLimiterWeb({ windowMs: 300, max: 5 })

    let admitted = 0
    for (let i = 0; i < 5; i += 1) if (!limit('7.7.7.7').limited) admitted += 1
    await new Promise((resolve) => setTimeout(resolve, 320))
    for (let i = 0; i < 5; i += 1) if (!limit('7.7.7.7').limited) admitted += 1

    expect(
      admitted,
      `${String(admitted)} admitted on the sync path against a nominal 5 — the two limiters disagree about max`,
    ).toBeLessThanOrEqual(5)
  })
})
