import type { RateLimitStore } from './rate-limit-store.js'
import type { RateLimitConfig, RateLimitResult } from './rate-limit.js'

/**
 * A rate limiter that AWAITS the store it was given — B-257, decided by
 * [ADR 0018](../../../../../docs/adr/0018-a-durable-rate-limit-gets-its-own-path-beside-the-sync-facade.md).
 *
 * ## Why this is new surface rather than a reshaped `createRateLimiterWeb`
 *
 * That facade declares `opts.store` and then refuses anything that is not an `InMemoryStore`
 * (`rate-limit.ts:110`, throwing at `:118-121`), because its closure returns `RateLimitResult`
 * synchronously and cannot await. Every durable store is network-backed and therefore async, so the
 * declared seam rejects exactly the class of store the problem requires.
 *
 * Changing that signature would spend a breaking change on a **promise owed** — the symbol is
 * recorded as one in `docs/api/rate-limit-subpath-surface.md:25` — reached through `theokit/server`,
 * an umbrella the same row records as **DEPRECATED, removal at `0.x+2`**. A break on a path that
 * disappears two minors later costs a break's full price for two minors of use. The path beside it
 * costs two code paths for one concept, which is bounded and reversible: when the umbrella goes, the
 * facade can follow.
 *
 * So the facade keeps its signature, its guard and its throw. Its error message stays accurate.
 *
 * ## What this does NOT do
 *
 * It ships no store. `rate-limit-store.ts:5-7` names Redis and Cloudflare KV as what a deployment
 * OPTS INTO, and `docs/adr/0017:32-34` states the principle: *"a framework that shipped one would be
 * choosing everybody's datastore."* This is the path by which an application reaches a store it
 * brought.
 *
 * `unstorage` is not a shortcut: its declared surface (`server/storage/use-unstorage.ts:32-40`) has
 * no atomic increment, so a read-then-write over it is the race `rate-limit-store.ts:10-12` exists
 * to prevent.
 */
export function createDurableRateLimiterWeb(
  config: RateLimitConfig,
  opts: { store: RateLimitStore },
): (clientIp: string) => Promise<RateLimitResult> {
  const { store } = opts

  return async function checkDurableRateLimitWeb(clientIp: string): Promise<RateLimitResult> {
    // The same fallback the sync facade uses: an address the runtime could not resolve keys on a
    // constant, and every caller sharing one bucket is the self-inflicted denial of service
    // `client-ip.ts:8-12` names. The deployed entry answers 503 before reaching here rather than
    // letting that happen, so this is the library's floor and not the deployment's behaviour.
    const key = clientIp.length > 0 ? clientIp : 'unknown'

    // No `instanceof` guard, and that is the whole point: this closure can await, so any
    // implementation of the contract works. `server/auth/auth-throttle.ts` already consumes it this
    // way, at `:59`, `:92` and `:99`, with zero guards.
    try {
      const state = await store.incr(key, config.windowMs)
      return resultFromDurableState(state, config)
    } catch (reason) {
      // ADR 0019 — a request that could not be COUNTED is refused, not served.
      //
      // The precedent is this repository's own and one item old: when a runtime cannot NAME a
      // caller, the generated entry answers 503 rather than keying everyone on a constant
      // (`adapters/deployed-rate-limit.ts:315`). A limiter that cannot identify a caller and one
      // that cannot count one are both a limiter that is not limiting, and answering differently
      // would mean one deployment refusing an unresolvable address and serving an unreachable
      // counter with no argument for the difference.
      //
      // Failing OPEN was the alternative, and it is rejected because `rateLimit` is, in
      // `adapters/config-support.ts:213-215`'s words, "the one whose absence looks exactly like
      // success" — invisible at the moment it matters, during the incident that made the store fail.
      //
      // The error is not re-thrown: a limiter's contract is to answer whether this caller may
      // proceed, and "the counter is down" is an answer. It is not swallowed either — the refusal
      // carries a header naming the store, so an operator can tell a store outage from every caller
      // suddenly being over budget.
      // The wiring triad's third pillar (`rules/cycle-implement.md`): without a runtime signal the
      // behaviour is invisible exactly when it breaks. `X-RateLimit-Unavailable: store` is
      // addressed to the CALLER and says a store is down; it cannot say WHY, because a timeout, an
      // auth failure and a DNS error produce the identical header and this `catch` is the last
      // place the cause exists. An operator watching 503s would have the symptom and nothing to act
      // on, during the incident that made the store fail.
      //
      // `console.warn` with this prefix is what this package already uses for a failure it cannot
      // return — `server/http/web-middleware-runner.ts:214`, `server/jobs/job-backend-memory.ts:77`,
      // `server/index.ts:50` — rather than a logger this module would have to invent and every
      // consumer would have to configure.
      const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
      console.warn(
        `[theokit] the rate-limit store could not count a caller, so the request was refused ` +
          `with 503 rather than served unlimited: ${detail}`,
      )
      return unavailable(config)
    }
  }
}

/**
 * The answer to a request that could not be counted — ADR 0019.
 *
 * `limited: true` refuses it. `X-RateLimit-Unavailable: store` says WHY, because a refusal that
 * looks like a budget refusal turns a dependency outage into "every caller is suddenly rate
 * limited", which is the wrong incident to page for.
 *
 * `Retry-After` is one window: the deployment has no signal about when the store returns, and one
 * window is the interval the limit already made the caller wait for.
 */
function unavailable(config: RateLimitConfig): RateLimitResult {
  return {
    limited: true,
    headers: {
      'X-RateLimit-Limit': String(config.max),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Unavailable': 'store',
      'Retry-After': String(Math.ceil(config.windowMs / 1000)),
    },
  }
}

/**
 * The same boundary the synchronous path uses, deliberately duplicated rather than imported.
 *
 * `rate-limit.ts`'s `resultFromState` is module-private and the two paths must agree exactly:
 * `count > max`, so the Nth request inside a budget of N passes and the N+1th is refused. Two
 * entries in one deployment counting differently is the defect this alignment worried about, and
 * `tests/unit/an-async-limiter-awaits-its-store.test.ts` pins both sides of that boundary.
 *
 * `retryAfter` floors at 0: it is derived from a timestamp the STORE produced, on a host whose clock
 * is not this invocation's, and `Retry-After: -4` is not a valid header value.
 */
function resultFromDurableState(
  state: { count: number; resetAt: number },
  config: RateLimitConfig,
): RateLimitResult {
  const remaining = Math.max(0, config.max - state.count)
  const retryAfter = Math.max(0, Math.ceil((state.resetAt - Date.now()) / 1000))

  if (state.count > config.max) {
    return {
      limited: true,
      headers: {
        'X-RateLimit-Limit': String(config.max),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(state.resetAt / 1000)),
        'Retry-After': String(retryAfter),
      },
    }
  }

  return {
    limited: false,
    headers: {
      'X-RateLimit-Limit': String(config.max),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(Math.ceil(state.resetAt / 1000)),
    },
  }
}
