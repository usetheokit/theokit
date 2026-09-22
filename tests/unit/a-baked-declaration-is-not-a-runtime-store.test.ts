import { describe, expect, it } from 'vitest'

import { createRouteRateLimiter } from 'theokit/server/rate-limit'

/**
 * B-257 — `store` means two different things, and one runner receives both.
 *
 * `config/schemas/rate-limit.ts` accepts `store: { module, factory, options }` — a BUILD-time
 * declaration an adapter bakes into a deployed entry. `RouteRateLimitConfig.store` is a
 * `RateLimitStore` INSTANCE — a runtime object with `incr`. They share a key, and `theokit start`
 * hands the parsed config straight to `createRouteRateLimiter`.
 *
 * Measured before the fix: the declaration reached `cfg.store ?? new InMemoryStore()`, missed the
 * `instanceof InMemoryStore` check, and threw
 * `"async RateLimitStore implementations require a dedicated async middleware path"` — during
 * CONSTRUCTION, so `theokit start` refused to boot.
 *
 * The config was valid. `node` and `bun` declare `enforcesRateLimit: 'always'`, so a project may
 * legitimately deploy to Cloudflare with a durable store AND run `theokit start` locally from the
 * same config — and that project could not start its dev server at all. An error naming a concept
 * the operator never used is worse than a crash: it sends them to read about async middleware.
 *
 * A declaration is not a store, so this runner IGNORES it. Its in-process counter already survives
 * between requests, which is exactly why `node` and `bun` enforce without one.
 */
describe('a baked store declaration is not a runtime store (B-257)', () => {
  const declaration = { module: '@upstash/ratelimit', factory: 'createStore' }

  it('test_a_declaration_does_not_stop_the_limiter_from_being_built', () => {
    expect(() =>
      createRouteRateLimiter({ default: { windowMs: 1000, max: 2 }, store: declaration } as never),
    ).not.toThrow()
  })

  it('test_a_declaration_leaves_the_in_process_counter_limiting', async () => {
    const limit = createRouteRateLimiter({
      default: { windowMs: 60_000, max: 1 },
      store: declaration,
    } as never)
    // Two requests from one caller, budget of one: the second must be refused. A runner that
    // silently dropped the limit would pass the construction test above and fail this one —
    // which is the whole reason this case exists beside it.
    const req = { url: '/x', socket: { remoteAddress: '203.0.113.9' }, headers: {} }
    expect((await limit(req as never)).limited, 'first request inside the budget').toBe(false)
    expect((await limit(req as never)).limited, 'second request over the budget').toBe(true)
  })

  it('test_a_real_foreign_store_still_throws', () => {
    // The existing guard must survive: an object WITH `incr` is a genuine async store, and the sync
    // facade cannot await it. Ignoring that one would swap a loud refusal for a silent no-op.
    const foreign = { incr: async () => ({ count: 1, resetAt: 0 }), get: async () => null }
    expect(() =>
      createRouteRateLimiter({ default: { windowMs: 1000, max: 2 }, store: foreign as never }),
    ).toThrow(/async middleware path/)
  })
})
