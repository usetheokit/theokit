import { describe, expect, it } from 'vitest'

import {
  InMemoryStore,
  slidingCount,
} from '../../packages/theo/src/server/rate-limit/rate-limit-store.js'

/**
 * B-261 follow-up, found by the FULL suite rather than by the item's own tests.
 *
 * The sliding window B-261 introduced weights the previous window's count by how far the current
 * window has NOT yet slid. `incrSync` opened each new window at `now`, so `windowStart` equalled
 * the moment of the request and `throughCurrent` was always 0 on the first request of a window —
 * weighting the previous count at **100%, forever, regardless of how much time had passed.**
 *
 * The consequence is the opposite of the defect B-261 fixed. A caller who spent its budget and then
 * WAITED — minutes, hours — is refused on the first request it makes on returning, because a window
 * that closed long ago still counts in full. That is a self-inflicted denial of service wearing the
 * costume of a rate limit.
 *
 * The item's four tests could not see it: every one of them measures a burst ACROSS a boundary,
 * which is the case where the previous window genuinely should count. None waits.
 *
 * ## What correct looks like
 *
 * A window that closed a full `windowMs` ago has slid entirely out of view and contributes nothing.
 * A window that closed more recently contributes in proportion to the overlap that remains — which
 * requires the new window to be anchored to the END of the previous one, not to the request that
 * happened to open it.
 */

describe('a caller who waited out the window is not refused (B-261 follow-up)', () => {
  it('test_a_window_that_closed_long_ago_contributes_nothing', () => {
    const store = new InMemoryStore()
    const windowMs = 50

    // Spend a budget, so there is a previous count worth carrying.
    store.incrSync('waiter', windowMs)
    store.incrSync('waiter', windowMs)
    store.incrSync('waiter', windowMs)

    // Wait out several whole windows. Busy-wait rather than a timer: the assertion is about what
    // the clock says, and a fake timer would let the code under test pass for the wrong reason.
    const until = Date.now() + windowMs * 4
    while (Date.now() < until) {
      /* wait */
    }

    const state = store.incrSync('waiter', windowMs)
    expect(
      slidingCount(state, windowMs),
      'a caller that waited four whole windows is being charged for a window that closed long ' +
        'ago. The weighting exists to stop a burst ACROSS a boundary; applied to a caller who ' +
        'waited, it refuses service to exactly the behaviour a rate limit is meant to encourage.',
    ).toBe(1)
  })

  it('test_a_window_that_just_closed_still_contributes_in_proportion', () => {
    // The mirror case, and the reason the fix cannot simply be "always discard". Immediately after a
    // boundary the previous window overlaps almost entirely, so its count must still land — that IS
    // B-261. A fix that zeroed the carry unconditionally would reintroduce the 2x burst.
    const store = new InMemoryStore()
    const windowMs = 10_000

    store.incrSync('burster', windowMs)
    store.incrSync('burster', windowMs)
    store.incrSync('burster', windowMs)
    store.incrSync('burster', windowMs)

    // Force the window to be expired without letting real time pass, by rewriting resetAt to now.
    // `peek` is read-only, so reach the entry the way the store stores it.
    const entry = (
      store as unknown as { store: Map<string, { count: number; resetAt: number }> }
    ).store.get('burster')
    expect(entry, 'the entry vanished — this test is about it').toBeDefined()
    if (entry) entry.resetAt = Date.now()

    const state = store.incrSync('burster', windowMs)
    expect(
      slidingCount(state, windowMs),
      'the previous window closed this instant, so its 4 requests must still count almost in ' +
        'full. A carry of zero here is the boundary burst B-261 exists to prevent.',
    ).toBeGreaterThan(4)
  })
})
