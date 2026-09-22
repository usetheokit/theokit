import { describe, expect, it } from 'vitest'

import {
  createDurableRateLimiterWeb,
  type RateLimitState,
  type RateLimitStore,
} from 'theokit/server/rate-limit'

/**
 * B-257 / T1.1 — a limiter that awaits the store it was given.
 *
 * `createRateLimiterWeb` declares `opts.store` and then refuses anything that is not an
 * `InMemoryStore` (`rate-limit.ts:110`, throwing at `:118`), because its closure returns
 * `RateLimitResult` synchronously and cannot await. Every durable store is network-backed and
 * therefore async, so the declared seam rejects exactly the class of store the problem requires.
 *
 * ADR 0018 decides this is NEW surface rather than a reshaped facade: `createRateLimiterWeb` keeps
 * its signature, its guard and its throw, because changing it spends a break on a **promise owed**
 * reached through an umbrella `docs/api/rate-limit-subpath-surface.md:25` records as DEPRECATED with
 * removal at `0.x+2`.
 *
 * The contract this exercises is already written and already consumed:
 * `packages/theo/src/server/auth/auth-throttle.ts` awaits `store.get`, `reset` and `incr` with zero
 * `instanceof` guards. It is a credential throttle rather than a request limiter, so it is the
 * existence proof and not a drop-in.
 */

/** A store that records what it was asked, so the test can assert the call rather than the result. */
function recordingStore(initial = 0): RateLimitStore & { calls: string[] } {
  let count = initial
  const calls: string[] = []
  return {
    calls,
    async incr(key: string, windowMs: number): Promise<RateLimitState> {
      calls.push(`incr:${key}:${windowMs}`)
      count += 1
      return { count, resetAt: Date.now() + windowMs }
    },
    async get(key: string): Promise<RateLimitState | null> {
      calls.push(`get:${key}`)
      return count === 0 ? null : { count, resetAt: Date.now() + 60_000 }
    },
    async reset(key: string): Promise<void> {
      calls.push(`reset:${key}`)
      count = 0
    },
  }
}

describe('a durable limiter awaits the store it was given (B-257, ADR 0018)', () => {
  it('test_it_awaits_incr_rather_than_refusing_a_non_in_memory_store', async () => {
    const store = recordingStore()
    const check = createDurableRateLimiterWeb({ windowMs: 60_000, max: 3 }, { store })

    const result = await check('203.0.113.7')

    // The call reached the store — which `createRateLimiterWeb` would have refused outright.
    expect(store.calls).toEqual(['incr:203.0.113.7:60000'])
    expect(result.limited).toBe(false)
  })

  it('test_the_limiter_admits_the_last_request_in_the_budget', async () => {
    // EC-3. `resultFromState` (`rate-limit.ts:64`) branches on `count > config.max`, so the Nth
    // request passes and the N+1th is refused. The durable path must match that boundary exactly,
    // or two entries in one deployment count differently.
    const check = createDurableRateLimiterWeb(
      { windowMs: 60_000, max: 3 },
      { store: recordingStore(2) },
    )

    expect((await check('1.2.3.4')).limited).toBe(false) // count becomes 3, which is == max
  })

  it('test_it_refuses_the_first_request_past_the_budget', async () => {
    const check = createDurableRateLimiterWeb(
      { windowMs: 60_000, max: 3 },
      { store: recordingStore(3) },
    )

    const result = await check('1.2.3.4') // count becomes 4, which is > max
    expect(result.limited).toBe(true)
    expect(result.headers['X-RateLimit-Remaining']).toBe('0')
  })

  it('test_a_stale_reset_does_not_emit_a_negative_retry_after', async () => {
    // EC-4. `retryAfter` is `Math.ceil((resetAt - Date.now()) / 1000)`. Clock skew between the
    // store's host and the invocation makes it negative, and `Retry-After: -4` is not a valid
    // header value.
    const past: RateLimitStore = {
      incr: async () => ({ count: 99, resetAt: Date.now() - 60_000 }),
      get: async () => null,
      reset: async () => undefined,
    }
    const check = createDurableRateLimiterWeb({ windowMs: 60_000, max: 3 }, { store: past })

    const retryAfter = Number((await check('1.2.3.4')).headers['Retry-After'])
    expect(retryAfter).toBeGreaterThanOrEqual(0)
  })

  it('test_two_in_flight_calls_for_one_key_each_reach_the_store', async () => {
    // EC-6. Two requests for one key, in flight together: each must reach `incr`. A limiter that
    // deduplicated or coalesced them would count one increment for two requests, and a caller
    // would get twice the budget it was allocated.
    //
    // **What this does NOT prove, despite the shape:** that `incr` is ATOMIC. The name here said
    // "both observe one increment each" and that claim needs a store that can interleave, which
    // this one cannot — it is a plain object in a single-threaded runtime, so its two calls are
    // ordered whatever the limiter does. Atomicity is the STORE's contract
    // (`rate-limit-store.ts:29-32`) and belongs to whoever implements one against Redis or D1.
    // Renamed to what it measures, because a test whose name outruns its assertion is a coverage
    // claim nobody can check.
    const store = recordingStore()
    const check = createDurableRateLimiterWeb({ windowMs: 60_000, max: 10 }, { store })

    await Promise.all([check('1.2.3.4'), check('1.2.3.4')])

    expect(store.calls, 'two in-flight requests produced fewer than two increments').toHaveLength(2)
  })
})
