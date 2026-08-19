import type { IncomingMessage } from 'node:http'

import { describe, it, expect } from 'vitest'

import { createRouteRateLimiter } from '../../packages/theo/src/server/rate-limit/rate-limit-per-route.js'

/**
 * `theokit start` used to build a limiter ONLY for the legacy flat config shape. A per-route config
 * produced `null`, the request handler skipped limiting on every request, and nothing anywhere said
 * so: the app booted clean and the config validated.
 *
 * The cost lands on exactly the endpoint the nested shape exists to protect — an expensive,
 * unauthenticated one given a tighter budget than the rest of the app. Measured on the site that
 * found this: 20 POSTs against a 12-per-minute agent route and 150 GETs against a 120-per-minute
 * API route, back to back, and not one 429.
 *
 * These tests drive `createRouteRateLimiter` — what `start` now calls for every shape the schema
 * accepts — so a future refactor cannot quietly narrow it back to one shape.
 *
 * Regression tests for usetheokit/theokit#321.
 */
function request(url: string, ip = '203.0.113.7'): IncomingMessage {
  return { url, socket: { remoteAddress: ip }, headers: {} } as unknown as IncomingMessage
}

/** Sends `count` requests and reports how many were refused. */
async function countLimited(
  check: (req: IncomingMessage) => Promise<{ limited: boolean }>,
  url: string,
  count: number,
  ip?: string,
): Promise<number> {
  let limited = 0
  for (let i = 0; i < count; i++) {
    if ((await check(request(url, ip))).limited) limited++
  }
  return limited
}

describe('per-route config shape', () => {
  const config = {
    default: { windowMs: 60_000, max: 120 },
    routes: { '/api/agents/ask-theo': { windowMs: 60_000, max: 12 } },
    keyBy: 'ip' as const,
  }

  it('enforces the tighter per-route budget', async () => {
    const check = createRouteRateLimiter(config)

    // 20 requests against a budget of 12 — the exact measurement that exposed the bug.
    expect(await countLimited(check, '/api/agents/ask-theo', 20)).toBe(8)
  })

  it('enforces the default budget on everything else', async () => {
    const check = createRouteRateLimiter(config)

    expect(await countLimited(check, '/api/health', 150)).toBe(30)
  })

  it('keeps the route bucket separate from the default one', async () => {
    const check = createRouteRateLimiter(config)

    // Exhaust the strict route; the loose one must still answer.
    await countLimited(check, '/api/agents/ask-theo', 20)

    expect((await check(request('/api/health'))).limited).toBe(false)
  })
})

describe('legacy flat config shape', () => {
  it('still limits, so the fix is not a breaking change', async () => {
    const check = createRouteRateLimiter({ windowMs: 60_000, max: 5 })

    expect(await countLimited(check, '/api/health', 8)).toBe(3)
  })
})

describe('bucket identity', () => {
  it('does not let one client consume another client budget', async () => {
    const check = createRouteRateLimiter({
      routes: { '/api/agents/ask-theo': { windowMs: 60_000, max: 12 } },
      keyBy: 'ip' as const,
    })

    await countLimited(check, '/api/agents/ask-theo', 20, '203.0.113.7')

    // This is the property that breaks behind a proxy when every visitor keys on the same address —
    // see the companion suite for #322.
    expect((await check(request('/api/agents/ask-theo', '198.51.100.4'))).limited).toBe(false)
  })

  it('reads the forwarded address when a proxy is trusted', async () => {
    const check = createRouteRateLimiter({
      routes: { '/api/agents/ask-theo': { windowMs: 60_000, max: 2 } },
      keyBy: 'ip' as const,
      trustProxy: true,
    })

    const behindProxy = (forwardedFor: string) =>
      ({
        url: '/api/agents/ask-theo',
        socket: { remoteAddress: '172.18.0.2' },
        headers: { 'x-forwarded-for': forwardedFor },
      }) as unknown as IncomingMessage

    // Same proxy address, two visitors: without trustProxy they would share a bucket and the second
    // visitor's first request would already be refused.
    await check(behindProxy('203.0.113.7'))
    await check(behindProxy('203.0.113.7'))
    expect((await check(behindProxy('203.0.113.7'))).limited).toBe(true)
    expect((await check(behindProxy('198.51.100.4'))).limited).toBe(false)
  })
})
