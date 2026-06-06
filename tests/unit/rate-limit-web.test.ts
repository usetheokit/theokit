/**
 * T5a.2 Phase D slice 2/3 — Web-Standards single-bucket rate limiter tests.
 *
 * Verifies `createRateLimiterWeb(config, opts?)` is a behaviour-equivalent
 * mirror of `createRateLimiter(config, opts?)` for the Web Request shape.
 * Same `RateLimitConfig`, same `InMemoryStore` default, same async-store
 * rejection.
 *
 * **Signature difference:** Web checker takes `(clientIp: string)` instead
 * of `(req: IncomingMessage)`. IP is resolved by the caller per-runtime
 * (Node adapter from socket; CF Workers from cf-connecting-ip; etc.) —
 * passing a Request object would force the caller to populate
 * `request.headers.get('x-forwarded-for')` without giving safer
 * extraction. KISS — accept the IP directly.
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase D.
 */
import { describe, it, expect } from 'vitest'

import { createRateLimiterWeb } from '../../packages/theo/src/server/rate-limit/rate-limit.js'
import {
  InMemoryStore,
  type RateLimitStore,
} from '../../packages/theo/src/server/rate-limit/rate-limit-store.js'

describe('createRateLimiterWeb (T5a.2 Phase D slice 2/3 — Web shape)', () => {
  it('returns not-limited when under threshold', () => {
    const check = createRateLimiterWeb({ windowMs: 60_000, max: 3 })
    const r = check('1.2.3.4')
    expect(r.limited).toBe(false)
    expect(r.headers['X-RateLimit-Limit']).toBe('3')
    expect(r.headers['X-RateLimit-Remaining']).toBe('2')
  })

  it('returns limited after exhausting the bucket', () => {
    const check = createRateLimiterWeb({ windowMs: 60_000, max: 2 })
    expect(check('1.2.3.4').limited).toBe(false)
    expect(check('1.2.3.4').limited).toBe(false)
    const r = check('1.2.3.4')
    expect(r.limited).toBe(true)
    expect(r.headers['Retry-After']).toBeDefined()
    expect(r.headers['X-RateLimit-Remaining']).toBe('0')
  })

  it('different clientIp values get separate buckets', () => {
    const check = createRateLimiterWeb({ windowMs: 60_000, max: 1 })
    expect(check('1.1.1.1').limited).toBe(false)
    expect(check('1.1.1.1').limited).toBe(true) // first IP exhausted
    expect(check('2.2.2.2').limited).toBe(false) // second IP fresh
  })

  it('empty clientIp falls back to bucket key "unknown"', () => {
    const check = createRateLimiterWeb({ windowMs: 60_000, max: 1 })
    expect(check('').limited).toBe(false)
    // Subsequent empty-IP requests share the "unknown" bucket
    expect(check('').limited).toBe(true)
  })

  it('accepts opt-in InMemoryStore', () => {
    const store = new InMemoryStore()
    const check = createRateLimiterWeb({ windowMs: 60_000, max: 1 }, { store })
    expect(check('1.2.3.4').limited).toBe(false)
    expect(check('1.2.3.4').limited).toBe(true)
  })

  it('rejects external async stores at request time (CR-005 parity)', () => {
    // Build an async-shaped store (not an InMemoryStore instance) — only
    // the `incr` method is exercised by the rejection path, so the other
    // RateLimitStore methods can be no-op stubs.
    const asyncStore: RateLimitStore = {
      incr: () => Promise.resolve({ count: 0, resetAt: Date.now() + 60_000 }),
      get: () => Promise.resolve(null),
      reset: () => Promise.resolve(),
    }
    const check = createRateLimiterWeb({ windowMs: 60_000, max: 3 }, { store: asyncStore })
    expect(() => check('1.2.3.4')).toThrow(/async RateLimitStore implementations are not supported/)
  })
})
