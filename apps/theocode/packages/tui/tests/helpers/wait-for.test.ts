/**
 * The helper that replaced the fixed sleeps, tested for the two properties that make it worth having.
 *
 * A sleep is not wrong because it is slow; it is wrong because the pass depends on the scheduler
 * rather than on the product. `waitFor` moves that dependency onto the condition itself: it returns
 * the moment the condition holds, and when it never holds it says WHICH condition — which is the
 * difference between `expected [] to contain 'earlier turn'` and a sentence naming the thing that
 * never happened.
 */
import { describe, expect, it } from 'vitest'

import { waitFor } from './wait-for.js'

describe('waitFor', () => {
  it('test_a_condition_that_never_holds_fails_naming_the_condition', async () => {
    // The fixture that MUST fail, first: a helper that resolved regardless would turn every caller
    // into a test that asserts nothing, which is strictly worse than the sleeps it replaces.
    await expect(
      waitFor(() => false, 'the window to close', { timeoutMs: 40, intervalMs: 5 }),
    ).rejects.toThrow('the window to close')
  })

  it('test_it_returns_as_soon_as_the_condition_holds', async () => {
    // Anti-vacuity in the other direction: a helper that always waited out its timeout would pass
    // the case above and reintroduce the fixed sleep under a better name.
    let ready = false
    setTimeout(() => {
      ready = true
    }, 10)
    const started = Date.now()

    await waitFor(() => ready, 'the flag to flip', { timeoutMs: 5_000, intervalMs: 2 })

    expect(Date.now() - started, 'it waited out the timeout instead of the condition').toBeLessThan(
      1_000,
    )
  })

  it('test_a_condition_already_true_never_waits_at_all', async () => {
    // The common case in these suites: the frame was already painted by the time the test asked.
    const started = Date.now()

    await waitFor(() => true, 'nothing at all', { timeoutMs: 5_000, intervalMs: 500 })

    expect(Date.now() - started).toBeLessThan(500)
  })
})
