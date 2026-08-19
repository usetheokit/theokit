import type { IncomingMessage } from 'node:http'

import { describe, it, expect } from 'vitest'

import { resolveClientIp } from '../../packages/theo/src/server/rate-limit/client-ip.js'

/**
 * The address a rate-limit bucket keys on decides who shares a budget with whom, so both ways of
 * getting it wrong are security bugs with opposite signs:
 *
 * - Read the socket behind a proxy and the whole internet shares one bucket. A handful of requests
 *   exhausts it and everyone else is refused — a denial of service any single client can trigger.
 * - Read `x-forwarded-for` without being told to and the limiter is bypassed by a header, since a
 *   client can put anything there and rotate it per request.
 *
 * Regression tests for usetheokit/theokit#322.
 */
function request(socketAddress: string, headers: Record<string, string> = {}): IncomingMessage {
  return { socket: { remoteAddress: socketAddress }, headers } as unknown as IncomingMessage
}

describe('resolveClientIp — trusting nothing (the default)', () => {
  it('uses the socket address', () => {
    expect(resolveClientIp(request('203.0.113.7'))).toBe('203.0.113.7')
  })

  it('ignores x-forwarded-for entirely', () => {
    // Without this, `curl -H 'x-forwarded-for: <random>'` is a complete bypass of every limit.
    const req = request('203.0.113.7', { 'x-forwarded-for': '9.9.9.9' })

    expect(resolveClientIp(req)).toBe('203.0.113.7')
    expect(resolveClientIp(req, false)).toBe('203.0.113.7')
    expect(resolveClientIp(req, 0)).toBe('203.0.113.7')
  })
})

describe('resolveClientIp — one trusted proxy', () => {
  it('reads the address the proxy appended', () => {
    // The proxy's own address is what the socket reports, identical for every visitor.
    const req = request('172.18.0.2', { 'x-forwarded-for': '203.0.113.7' })

    expect(resolveClientIp(req, true)).toBe('203.0.113.7')
  })

  it('ignores an entry the client forged to the left of the real one', () => {
    // The client sent `x-forwarded-for: 9.9.9.9`; the proxy appended the address it saw. Counting
    // from the right lands on the proxy's entry, and the forgery is inert.
    const req = request('172.18.0.2', { 'x-forwarded-for': '9.9.9.9, 203.0.113.7' })

    expect(resolveClientIp(req, true)).toBe('203.0.113.7')
  })

  it('gives each visitor a distinct key', () => {
    const first = request('172.18.0.2', { 'x-forwarded-for': '203.0.113.7' })
    const second = request('172.18.0.2', { 'x-forwarded-for': '198.51.100.4' })

    expect(resolveClientIp(first, true)).not.toBe(resolveClientIp(second, true))
  })

  it('falls back to the socket when the header is absent', () => {
    // A request that reached the app's port directly did not come through the proxy at all.
    expect(resolveClientIp(request('203.0.113.7'), true)).toBe('203.0.113.7')
  })
})

describe('resolveClientIp — longer chains', () => {
  it('counts in from the right by the declared hop count', () => {
    // CDN in front of our own proxy: `client, cdn` after both have appended.
    const req = request('172.18.0.2', { 'x-forwarded-for': '203.0.113.7, 198.51.100.4' })

    expect(resolveClientIp(req, 2)).toBe('203.0.113.7')
  })

  it('falls back to the socket when the chain is shorter than declared', () => {
    // Fewer hops than configured means the request skipped a proxy — reading what is there would
    // mean reading an entry the client could have written.
    const req = request('172.18.0.2', { 'x-forwarded-for': '203.0.113.7' })

    expect(resolveClientIp(req, 2)).toBe('172.18.0.2')
  })
})

describe('resolveClientIp — header shapes', () => {
  it('trims whitespace around entries', () => {
    const req = request('172.18.0.2', { 'x-forwarded-for': '9.9.9.9 ,  203.0.113.7 ' })

    expect(resolveClientIp(req, true)).toBe('203.0.113.7')
  })

  it('reads x-real-ip when there is no forwarded chain', () => {
    const req = request('172.18.0.2', { 'x-real-ip': '203.0.113.7' })

    expect(resolveClientIp(req, true)).toBe('203.0.113.7')
  })

  it('takes the last value when Node hands back an array', () => {
    const req = {
      socket: { remoteAddress: '172.18.0.2' },
      headers: { 'x-forwarded-for': ['9.9.9.9', '203.0.113.7'] },
    } as unknown as IncomingMessage

    expect(resolveClientIp(req, true)).toBe('203.0.113.7')
  })

  it('survives a request with no socket at all', () => {
    expect(resolveClientIp({ headers: {} } as unknown as IncomingMessage)).toBe('unknown')
  })
})
