import { describe, expect, it } from 'vitest'

import { createDurableRateLimiterWeb } from 'theokit/server/rate-limit'
import type { RateLimitStore } from 'theokit/server/rate-limit'

/**
 * B-257 / T3.1 — EC-5 of the edge review, decided by
 * [ADR 0019](../../docs/adr/0019-an-unreachable-rate-limit-store-answers-503.md).
 *
 * A durable store is a network dependency and a network dependency fails. ADR 0018 built the path
 * and left this open in its own words: *"fail open and the limit is not a limit; fail closed and a
 * store outage is an app outage."*
 *
 * It fails CLOSED, and the precedent is this repository's own: when a runtime cannot NAME a caller,
 * the generated entry answers 503 rather than keying everyone on a constant
 * (`deployed-rate-limit.ts:315`). A limiter that cannot identify a caller and one that cannot count
 * one are both a limiter that is not limiting.
 *
 * `rules/testing.md` § 4.1 — a negative-case test asserts the SPECIFIC typed error and message, not
 * merely that something went wrong.
 */

const unreachable: RateLimitStore = {
  incr: () => Promise.reject(new Error('ECONNREFUSED 10.0.0.1:6379')),
  get: () => Promise.reject(new Error('ECONNREFUSED')),
  reset: () => Promise.reject(new Error('ECONNREFUSED')),
}

describe('an unreachable store fails closed (B-257 T3.1, ADR 0019)', () => {
  it('test_a_rejected_store_refuses_the_request_rather_than_serving_it', async () => {
    const check = createDurableRateLimiterWeb({ windowMs: 60_000, max: 10 }, { store: unreachable })

    const result = await check('1.2.3.4')

    expect(result.limited).toBe(true)
  })

  it('test_the_refusal_carries_a_retry_after_so_a_caller_can_act', async () => {
    const check = createDurableRateLimiterWeb({ windowMs: 60_000, max: 10 }, { store: unreachable })

    const result = await check('1.2.3.4')

    expect(Number(result.headers['Retry-After'])).toBeGreaterThan(0)
  })

  it('test_the_answer_names_the_store_rather_than_looking_like_a_budget_refusal', async () => {
    // An operator reading headers must tell "this caller is over budget" from "the counter is down".
    // Without it, a store outage reads as every caller suddenly being rate limited.
    const check = createDurableRateLimiterWeb({ windowMs: 60_000, max: 10 }, { store: unreachable })

    const result = await check('1.2.3.4')

    expect(result.headers['X-RateLimit-Unavailable']).toBe('store')
  })

  it('test_the_rejection_is_not_swallowed_into_a_served_request', async () => {
    // The anti-pattern `rules/error-handling.md` § 5 lists first: a catch that returns
    // `{ limited: false }` makes the failure invisible exactly while the limit is not limiting.
    const check = createDurableRateLimiterWeb({ windowMs: 60_000, max: 10 }, { store: unreachable })

    const results = await Promise.all([check('1.2.3.4'), check('5.6.7.8'), check('9.10.11.12')])

    // EC — several requests in flight when the store fails all get the same decided answer, not one
    // for whoever observed the failure first.
    expect(results.every((r) => r.limited)).toBe(true)
  })
})
