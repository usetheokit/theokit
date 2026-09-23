import { describe, it, expect, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { createRateLimiter } from '../../packages/theo/src/server/rate-limit/rate-limit.js'

function mockReq(ip = '127.0.0.1'): IncomingMessage {
  return { socket: { remoteAddress: ip } } as unknown as IncomingMessage
}

describe('Rate Limiter', () => {
  it('should allow requests under the limit', () => {
    const check = createRateLimiter({ windowMs: 10_000, max: 3 })
    expect(check(mockReq()).limited).toBe(false)
    expect(check(mockReq()).limited).toBe(false)
    expect(check(mockReq()).limited).toBe(false)
  })

  it('should block after exceeding the limit', () => {
    const check = createRateLimiter({ windowMs: 10_000, max: 3 })
    check(mockReq())
    check(mockReq())
    check(mockReq())
    const result = check(mockReq())
    expect(result.limited).toBe(true)
  })

  /**
   * Was `should reset after window expires`, and asserted that 150ms of waiting cleared a spent
   * budget on a 100ms window. B-261 replaced the fixed window with a SLIDING one, deliberately, and
   * a sliding window does not reset — it slides. Under it those 150ms are not enough: three requests
   * inside 150ms against a limit of one per 100ms is genuinely over the limit, and refusing is the
   * correct answer rather than a regression.
   *
   * So the assertion the old name made is no longer true, and keeping it by loosening the limiter
   * would undo the item. What IS true, and is the property a caller actually cares about, is that
   * waiting long enough restores service. The threshold is a full window past the close of the
   * previous one, which is when the previous window has slid entirely out of view — held from the
   * store's side by `a-caller-who-waited-is-not-refused.test.ts`.
   */
  it('a caller that waits out the whole window is served again', async () => {
    const check = createRateLimiter({ windowMs: 100, max: 1 })
    check(mockReq())
    expect(check(mockReq()).limited).toBe(true)

    // 250ms: the first window closed at 100ms, so by 250ms it has been closed for 150ms — more than
    // the 100ms it takes to slide out of view entirely. 150ms would leave half of it still counting.
    await new Promise((r) => setTimeout(r, 250))
    expect(
      check(mockReq()).limited,
      'a caller that waited two and a half windows is still refused. The sliding weight is meant ' +
        'to stop a burst ACROSS a boundary, not to charge a caller for a window that closed long ago.',
    ).toBe(false)
  })

  it('and half a window of waiting is NOT enough, which is the point of the slide', async () => {
    // The mirror of the case above, and the reason the item exists. Under the fixed window this
    // passed at 150ms — which is exactly how a caller got 2x the limit by straddling a boundary.
    const check = createRateLimiter({ windowMs: 100, max: 1 })
    check(mockReq())
    expect(check(mockReq()).limited).toBe(true)

    await new Promise((r) => setTimeout(r, 150))
    expect(
      check(mockReq()).limited,
      'half a window of waiting cleared a spent budget, so the previous window stopped counting ' +
        'too early. That is the boundary burst B-261 closed, reopened.',
    ).toBe(true)
  })

  it('should include X-RateLimit-Limit header', () => {
    const check = createRateLimiter({ windowMs: 10_000, max: 5 })
    const result = check(mockReq())
    expect(result.headers['X-RateLimit-Limit']).toBe('5')
  })

  it('should include X-RateLimit-Remaining header', () => {
    const check = createRateLimiter({ windowMs: 10_000, max: 5 })
    check(mockReq())
    const result = check(mockReq())
    expect(result.headers['X-RateLimit-Remaining']).toBe('3')
  })

  it('should include Retry-After when limited', () => {
    const check = createRateLimiter({ windowMs: 10_000, max: 1 })
    check(mockReq())
    const result = check(mockReq())
    expect(result.limited).toBe(true)
    expect(Number(result.headers['Retry-After'])).toBeGreaterThan(0)
  })

  it('should track different IPs separately', () => {
    const check = createRateLimiter({ windowMs: 10_000, max: 1 })
    check(mockReq('10.0.0.1'))
    // Second IP should not be limited
    expect(check(mockReq('10.0.0.2')).limited).toBe(false)
    // First IP should be limited
    expect(check(mockReq('10.0.0.1')).limited).toBe(true)
  })

  it('should use fallback key when IP is unavailable', () => {
    const check = createRateLimiter({ windowMs: 10_000, max: 1 })
    const noIpReq = { socket: {} } as unknown as IncomingMessage
    check(noIpReq)
    expect(check(noIpReq).limited).toBe(true)
  })

  it('should clean up expired entries periodically (EC-1)', () => {
    const check = createRateLimiter({ windowMs: 1, max: 1000 })

    // Create 1000+ unique IP entries
    for (let i = 0; i < 1001; i++) {
      check(mockReq(`10.0.${Math.floor(i / 256)}.${i % 256}`))
    }

    // Wait for window to expire
    vi.useFakeTimers()
    vi.advanceTimersByTime(10)

    // The 1001st check triggers cleanup (checkCount % 1000 === 0 happens at 1000)
    // After cleanup, expired entries should be removed
    // This just verifies no crash and the function continues working
    const result = check(mockReq('10.0.0.1'))
    expect(result.limited).toBe(false) // window expired, should be allowed
    vi.useRealTimers()
  })
})
