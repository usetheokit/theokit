/**
 * How many attempts the current turn spent, read from the SDK's own rate-limit event.
 *
 * The retry policy on the critical path is the transport's — three attempts with a growing delay,
 * measured 2026-08-25 as `retry 1/3 in 20ms` then `retry 2/3 in 403ms`. Nothing in this product
 * declares it or can change it, and until this module existed nothing could SEE it either. That last
 * part is what had a cost: `packages/cli/src/commands/run.ts:56` records an auth failure that, after
 * those retries, reached the user as `rate_limit (HTTP 429)` — "which reads as a quota problem and
 * sends the user off to check a usage page".
 *
 * This does not add a retry policy and does not pretend to own one. It reports what happened, so a
 * failure that cost three attempts says so instead of looking like a first-try refusal.
 *
 * The number is NOT counted here: `RunRateLimitEvent.attempt` is 1-based and supplied by the SDK, so
 * this remembers the highest one seen. Counting events instead would inflate the figure the moment
 * an event were re-delivered, and a wrong number shown to a user is worse than no number.
 *
 * The holder pattern is `mcp-failure-record.ts`'s and the split is the same: the mechanism is here,
 * pure and testable; where the instance lives is the surface's decision.
 */

/** The `rate_limit` member of the SDK's `RunEvent` union, as much of it as this module reads. */
export interface RateLimitLike {
  readonly type?: unknown
  readonly attempt?: unknown
}

export interface RetryRecord {
  /** Feed a run event. Anything that is not `rate_limit` is ignored. */
  sink: (event: RateLimitLike) => void
  /** The highest attempt the provider reached this turn; `0` when it never retried. */
  attempts: () => number
  /** Called when a turn begins — a stale count is worse than an absent one. */
  startTurn: () => void
}

export function createRetryRecord(): RetryRecord {
  let highest = 0

  return {
    sink(event) {
      if (event.type !== 'rate_limit') return
      const attempt = event.attempt
      // The event crosses a package boundary, so the shape is checked rather than trusted: a
      // non-integer would otherwise reach the user as "after NaN attempts".
      if (typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 1) return
      if (attempt > highest) highest = attempt
    },
    attempts: () => highest,
    startTurn() {
      highest = 0
    },
  }
}
