/**
 * T5a.2 Phase D slice 1/3 — Web-Standards rate-limiter tests.
 *
 * Verifies `deriveKeyFromRequest(request, keyBy, cookieName, ctx)` +
 * `createRouteRateLimiterWeb(config)` are behaviour-equivalent mirrors of
 * `deriveKey` + `createRouteRateLimiter` for the Web Request shape.
 *
 * Web Request has no `req.socket.remoteAddress` or `req.user` — the
 * Web-shaped helpers accept `DeriveKeyRequestContext = { clientIp?, userId? }`
 * resolved by the caller per-runtime (Node adapter pulls from socket;
 * CF Workers from cf-connecting-ip; etc.).
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase D.
 */
import { describe, it, expect } from 'vitest'

import {
  createRouteRateLimiterWeb,
  deriveKeyFromRequest,
} from '../../packages/theo/src/server/rate-limit/rate-limit-per-route.js'

describe('deriveKeyFromRequest (T5a.2 Phase D slice 1/3 — Web shape)', () => {
  it("keyBy='ip' uses ctx.clientIp", async () => {
    const request = new Request('http://example.com/api', { method: 'GET' })
    const key = await deriveKeyFromRequest(request, 'ip', 'theo_session', { clientIp: '1.2.3.4' })
    expect(key).toBe('ip:1.2.3.4')
  })

  it("keyBy='ip' falls back to 'unknown' when ctx.clientIp missing", async () => {
    const request = new Request('http://example.com/api', { method: 'GET' })
    const key = await deriveKeyFromRequest(request, 'ip', 'theo_session')
    expect(key).toBe('ip:unknown')
  })

  it("keyBy='session' hashes the cookie value (not raw)", async () => {
    const request = new Request('http://example.com/api', {
      method: 'GET',
      headers: { cookie: 'theo_session=secret-token' },
    })
    const key = await deriveKeyFromRequest(request, 'session', 'theo_session', {
      clientIp: '1.2.3.4',
    })
    expect(key).toMatch(/^session:[A-Za-z0-9_-]+$/)
    expect(key).not.toContain('secret-token')
  })

  it("keyBy='session' falls back to IP when cookie missing", async () => {
    const request = new Request('http://example.com/api', { method: 'GET' })
    const key = await deriveKeyFromRequest(request, 'session', 'theo_session', {
      clientIp: '5.6.7.8',
    })
    expect(key).toBe('ip:5.6.7.8')
  })

  it("keyBy='session' uses configured cookieName (EC-6)", async () => {
    const request = new Request('http://example.com/api', {
      method: 'GET',
      headers: { cookie: 'app_session=token123' },
    })
    const key = await deriveKeyFromRequest(request, 'session', 'app_session', {
      clientIp: '1.2.3.4',
    })
    expect(key).toMatch(/^session:/)
    // Wrong cookie name → fall back to IP
    const fallback = await deriveKeyFromRequest(request, 'session', 'theo_session', {
      clientIp: '1.2.3.4',
    })
    expect(fallback).toBe('ip:1.2.3.4')
  })

  it("keyBy='user' uses ctx.userId when present", async () => {
    const request = new Request('http://example.com/api', { method: 'GET' })
    const key = await deriveKeyFromRequest(request, 'user', 'theo_session', { userId: 'u-42' })
    expect(key).toBe('user:u-42')
  })

  it("keyBy='user' falls back to IP when ctx.userId missing", async () => {
    const request = new Request('http://example.com/api', { method: 'GET' })
    const key = await deriveKeyFromRequest(request, 'user', 'theo_session', { clientIp: '9.9.9.9' })
    expect(key).toBe('ip:9.9.9.9')
  })
})

describe('createRouteRateLimiterWeb (T5a.2 Phase D slice 1/3 — Web shape)', () => {
  it('per-route config applied when path matches', async () => {
    const limiter = createRouteRateLimiterWeb({
      default: { windowMs: 60_000, max: 100 },
      routes: { '/api/login': { windowMs: 60_000, max: 3 } },
    })
    const ctx = { clientIp: '1.2.3.4' }
    const mkReq = () => new Request('http://example.com/api/login', { method: 'POST' })

    // 3 allowed
    for (let i = 0; i < 3; i++) {
      const result = await limiter(mkReq(), ctx)
      expect(result.limited).toBe(false)
    }
    // 4th should be limited
    const fourth = await limiter(mkReq(), ctx)
    expect(fourth.limited).toBe(true)
    expect(fourth.headers['Retry-After']).toBeDefined()
  })

  it('default config used when path is unmatched', async () => {
    const limiter = createRouteRateLimiterWeb({
      default: { windowMs: 60_000, max: 2 },
      routes: { '/api/login': { windowMs: 60_000, max: 5 } },
    })
    const ctx = { clientIp: '1.2.3.4' }
    const mkReq = () => new Request('http://example.com/api/users', { method: 'GET' })

    expect((await limiter(mkReq(), ctx)).limited).toBe(false)
    expect((await limiter(mkReq(), ctx)).limited).toBe(false)
    expect((await limiter(mkReq(), ctx)).limited).toBe(true)
  })

  it('no rate limit when no default and no route matches', async () => {
    const limiter = createRouteRateLimiterWeb({
      routes: { '/api/login': { windowMs: 60_000, max: 5 } },
    })
    const ctx = { clientIp: '1.2.3.4' }
    const mkReq = () => new Request('http://example.com/api/health', { method: 'GET' })
    // Reasonable bound (1000 takes too long with async overhead per the
    // adjusted T5a.1d test; 200 is sufficient).
    for (let i = 0; i < 200; i++) {
      expect((await limiter(mkReq(), ctx)).limited).toBe(false)
    }
  })

  it('EC-5: trailing slash normalized — /api/login matches /api/login/', async () => {
    const limiter = createRouteRateLimiterWeb({
      routes: { '/api/login': { windowMs: 60_000, max: 2 } },
    })
    const ctx = { clientIp: '1.2.3.4' }
    expect(
      (await limiter(new Request('http://example.com/api/login', { method: 'POST' }), ctx)).limited,
    ).toBe(false)
    expect(
      (await limiter(new Request('http://example.com/api/login/', { method: 'POST' }), ctx))
        .limited,
    ).toBe(false)
    // Third hit (regardless of trailing slash form) should be limited
    expect(
      (await limiter(new Request('http://example.com/api/login', { method: 'POST' }), ctx)).limited,
    ).toBe(true)
  })

  it('legacy flat config { windowMs, max } works as default', async () => {
    const limiter = createRouteRateLimiterWeb({ windowMs: 60_000, max: 2 })
    const ctx = { clientIp: '1.2.3.4' }
    const mkReq = () => new Request('http://example.com/api/anywhere', { method: 'POST' })
    expect((await limiter(mkReq(), ctx)).limited).toBe(false)
    expect((await limiter(mkReq(), ctx)).limited).toBe(false)
    expect((await limiter(mkReq(), ctx)).limited).toBe(true)
  })

  it('different ctx.clientIp values get separate buckets', async () => {
    const limiter = createRouteRateLimiterWeb({
      default: { windowMs: 60_000, max: 1 },
    })
    const mkReq = () => new Request('http://example.com/api/x', { method: 'GET' })

    // First IP exhausts its bucket
    expect((await limiter(mkReq(), { clientIp: '1.1.1.1' })).limited).toBe(false)
    expect((await limiter(mkReq(), { clientIp: '1.1.1.1' })).limited).toBe(true)

    // Second IP still has full bucket
    expect((await limiter(mkReq(), { clientIp: '2.2.2.2' })).limited).toBe(false)
  })
})
