import { describe, expect, it, vi } from 'vitest'

import type { RateLimitState, RateLimitStore } from 'theokit/server/rate-limit'

/**
 * B-257 / T4.1 — the item's first Definition-of-done bullet, and the claim the whole item is named
 * after: *"a declared limit holds ACROSS invocations on at least one per-invocation runtime, proven
 * by a test that exercises two separate invocations rather than two calls in one process."*
 *
 * ## Why the existing test could not prove this
 *
 * `every-deployed-entry-limits-its-caller.test.ts:336-343` drives two requests against ONE
 * dynamically-imported module instance. That proves the limiter counts; it cannot prove the count
 * survives, because nothing in it ever discards the process state a per-invocation runtime discards
 * between requests.
 *
 * `vi.resetModules()` is what makes the second invocation COLD: the limiter, its closure and any
 * in-process map are constructed again from scratch, exactly as they are when a Worker or a Lambda
 * serves a request on a fresh isolate. The store is the only thing that crosses, which is the whole
 * point.
 *
 * ## The canary, and why it is the important half
 *
 * `test_the_same_shape_with_an_in_memory_store_does_NOT_survive` runs the identical sequence against
 * a store scoped to the invocation. It must FAIL to limit — and if it ever passes, this file is
 * measuring something other than survival, because a green that both stores satisfy proves nothing
 * about either.
 */

/** A counter that outlives the module registry, the way a network-backed store outlives a process. */
function durableStore(): RateLimitStore {
  const counts = new Map<string, RateLimitState>()
  return {
    async incr(key, windowMs) {
      const now = Date.now()
      const prev = counts.get(key)
      const state =
        prev === undefined || now >= prev.resetAt
          ? { count: 1, resetAt: now + windowMs }
          : { count: prev.count + 1, resetAt: prev.resetAt }
      counts.set(key, state)
      return state
    },
    async get(key) {
      return counts.get(key) ?? null
    },
    async reset(key) {
      counts.delete(key)
    },
  }
}

/** Load the limiter as a COLD invocation would: a fresh module graph every time. */
async function coldInvocation(
  store: RateLimitStore,
  config: { windowMs: number; max: number },
): Promise<(ip: string) => Promise<boolean>> {
  vi.resetModules()
  const { createDurableRateLimiterWeb } = await import('theokit/server/rate-limit')
  const check = createDurableRateLimiterWeb(config, { store })
  return async (ip: string) => (await check(ip)).limited
}

describe('a declared limit survives a cold invocation (B-257 T4.1)', () => {
  it('test_the_budget_spent_in_one_invocation_is_gone_in_the_next', async () => {
    const store = durableStore()
    const config = { windowMs: 60_000, max: 2 }

    const first = await coldInvocation(store, config)
    expect(await first('203.0.113.7')).toBe(false) // 1 of 2
    expect(await first('203.0.113.7')).toBe(false) // 2 of 2

    // The invocation ends. The process, the closure and any in-process map are gone.
    const second = await coldInvocation(store, config)

    expect(await second('203.0.113.7')).toBe(true) // 3rd request, over budget, a COLD process
  })

  it('test_the_same_shape_with_an_in_memory_store_does_NOT_survive', async () => {
    // THE CANARY. A store scoped to the invocation gives the caller a fresh budget every time, which
    // is the defect this item is named after. If this ever asserts `true`, the test above is
    // measuring something other than survival.
    const config = { windowMs: 60_000, max: 2 }

    const first = await coldInvocation(durableStore(), config)
    await first('203.0.113.7')
    await first('203.0.113.7')

    const second = await coldInvocation(durableStore(), config) // a NEW store, as a new process gets

    expect(await second('203.0.113.7')).toBe(false) // served, because the counter forgot
  })

  it('test_a_cold_invocation_after_the_window_starts_fresh', async () => {
    // EC-7 of the edge review. Without it, the first test passes against a store that never expires
    // anything — a different bug wearing the same green.
    const store = durableStore()
    const config = { windowMs: 30, max: 1 }

    const first = await coldInvocation(store, config)
    expect(await first('203.0.113.7')).toBe(false)
    expect(await first('203.0.113.7')).toBe(true) // over budget, same window

    await new Promise((r) => setTimeout(r, 45)) // the window elapses between invocations

    const second = await coldInvocation(store, config)
    expect(await second('203.0.113.7')).toBe(false) // a fresh window, not a remembered refusal
  })

  it('test_two_callers_do_not_share_one_budget_across_invocations', async () => {
    const store = durableStore()
    const config = { windowMs: 60_000, max: 1 }

    const first = await coldInvocation(store, config)
    expect(await first('1.1.1.1')).toBe(false)

    const second = await coldInvocation(store, config)
    expect(await second('2.2.2.2')).toBe(false) // a different caller, its own budget
    expect(await second('1.1.1.1')).toBe(true) // the first caller, still over
  })
})
