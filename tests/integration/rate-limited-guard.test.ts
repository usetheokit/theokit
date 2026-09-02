import 'reflect-metadata'

import { describe, expect, it } from 'vitest'

// `dist`, not `src`: this project applies decorators through esbuild, and the built package is what
// a consumer imports — same reason as `authenticated-guard-wiring.test.ts`.
import {
  Controller,
  createDecoratorHandler,
  Get,
  UseGuards,
} from '../../packages/http/dist/index.js'
import { RateLimited } from '../../packages/theo/src/server/rate-limit/rate-limited-guard.js'

/**
 * `RateLimited(...)` — the controller adapter the limiter never had (usetheokit/theokit#612).
 *
 * `theokit/server/rate-limit` exported a complete limiter and nothing a `@Controller` route could
 * use, so every app wrote the adapter, and the adapter a `CanActivate` allows gets two things wrong
 * on its own: a boolean cannot answer 429, and a guard owns no response to hang `Retry-After` on.
 * Both came out as `403 Forbidden resource` with the budget discarded.
 *
 * These tests drive the DISPATCHER rather than `canActivate`, because "the guard decides correctly"
 * and "the caller receives 429 with a Retry-After" are different claims and only the second one is
 * what an adopter needed.
 */

const routeFor = (guard: ReturnType<typeof RateLimited>, path: string) => {
  @Controller(path)
  @UseGuards(guard)
  class Limited {
    @Get()
    read(): { ok: boolean } {
      return { ok: true }
    }
  }
  return Limited
}

const sessionRequest = (path: string, session: string): Request =>
  new Request(`http://x/${path}`, { headers: { cookie: `theo_session=${session}` } })

describe('RateLimited — refusal shape (#612)', () => {
  it('serves under the budget and refuses over it with 429', async () => {
    const handle = createDecoratorHandler([
      routeFor(RateLimited({ max: 2, windowMs: 60_000, keyBy: 'session' }), 'api/stt'),
    ])

    expect((await handle(sessionRequest('api/stt', 'a')))?.status).toBe(200)
    expect((await handle(sessionRequest('api/stt', 'a')))?.status).toBe(200)

    const refused = await handle(sessionRequest('api/stt', 'a'))
    expect(refused?.status).toBe(429)
  })

  it('carries the budget on the refusal, so a client knows when to return', async () => {
    const handle = createDecoratorHandler([
      routeFor(RateLimited({ max: 1, windowMs: 60_000, keyBy: 'session' }), 'api/tts'),
    ])

    await handle(sessionRequest('api/tts', 'b'))
    const refused = await handle(sessionRequest('api/tts', 'b'))

    expect(refused?.status).toBe(429)
    expect(refused?.headers.get('x-ratelimit-limit')).toBe('1')
    expect(refused?.headers.get('x-ratelimit-remaining')).toBe('0')
    expect(Number(refused?.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('buckets per caller, not globally', async () => {
    const handle = createDecoratorHandler([
      routeFor(RateLimited({ max: 1, windowMs: 60_000, keyBy: 'session' }), 'api/one'),
    ])

    await handle(sessionRequest('api/one', 'first'))
    // A different session must have its own budget — otherwise the first caller each window
    // exhausts it for everybody, which is a denial of service any single client can trigger.
    expect((await handle(sessionRequest('api/one', 'second')))?.status).toBe(200)
  })
})

describe('RateLimited — scope (#612)', () => {
  it('gives each route its own budget by default', async () => {
    const guard = RateLimited({ max: 1, windowMs: 60_000, keyBy: 'session' })
    const handle = createDecoratorHandler([
      routeFor(guard, 'api/scoped-a'),
      routeFor(guard, 'api/scoped-b'),
    ])

    expect((await handle(sessionRequest('api/scoped-a', 's')))?.status).toBe(200)
    expect((await handle(sessionRequest('api/scoped-b', 's')))?.status).toBe(200)
    expect((await handle(sessionRequest('api/scoped-a', 's')))?.status).toBe(429)
  })

  it("shares one budget across routes under scope: 'shared'", async () => {
    const guard = RateLimited({ max: 1, windowMs: 60_000, keyBy: 'session', scope: 'shared' })
    const handle = createDecoratorHandler([
      routeFor(guard, 'api/shared-a'),
      routeFor(guard, 'api/shared-b'),
    ])

    expect((await handle(sessionRequest('api/shared-a', 's')))?.status).toBe(200)
    // The case an app capping three routes that bill a third party per call actually wants: one
    // budget for the money, not one per URL.
    expect((await handle(sessionRequest('api/shared-b', 's')))?.status).toBe(429)
  })
})

describe('RateLimited — refuses a configuration that cannot bucket (#612)', () => {
  it("refuses keyBy: 'ip' with no way to learn the address", async () => {
    // A Web `Request` carries no socket address. Accepting this would put every visitor on earth in
    // one `ip:unknown` bucket — the limiter reading as protection while protecting nothing, which
    // is the exact failure the issue reports one layer up (a preHandler that enforced nothing).
    expect(() => RateLimited({ max: 5, windowMs: 1000, keyBy: 'ip' })).toThrow(
      /trustProxy|clientIp/,
    )
  })

  it("refuses keyBy: 'user' with no identify callback", () => {
    expect(() => RateLimited({ max: 5, windowMs: 1000, keyBy: 'user' })).toThrow(/identify/)
  })

  it("accepts keyBy: 'ip' when the proxy hop count is declared", async () => {
    const handle = createDecoratorHandler([
      routeFor(RateLimited({ max: 1, windowMs: 60_000, keyBy: 'ip', trustProxy: 1 }), 'api/by-ip'),
    ])
    const from = (address: string) =>
      new Request('http://x/api/by-ip', { headers: { 'x-forwarded-for': address } })

    expect((await handle(from('203.0.113.7')))?.status).toBe(200)
    expect((await handle(from('203.0.113.7')))?.status).toBe(429)
    // The rightmost entry past the trusted hops is the one the proxy wrote; a second address must
    // not inherit the first one's spent budget.
    expect((await handle(from('198.51.100.9')))?.status).toBe(200)
  })

  it('does not read x-forwarded-for that no proxy vouched for', async () => {
    const handle = createDecoratorHandler([
      routeFor(
        RateLimited({
          max: 1,
          windowMs: 60_000,
          keyBy: 'ip',
          identify: () => ({ clientIp: '10.0.0.1' }),
        }),
        'api/fixed-ip',
      ),
    ])
    const forged = (address: string) =>
      new Request('http://x/api/fixed-ip', { headers: { 'x-forwarded-for': address } })

    expect((await handle(forged('1.1.1.1')))?.status).toBe(200)
    // `identify` decided the address, so rotating a client-written header buys nothing.
    expect((await handle(forged('2.2.2.2')))?.status).toBe(429)
  })
})
