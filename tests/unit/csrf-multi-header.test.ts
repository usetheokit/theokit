/**
 * RED tests for T2.1 — server/security/csrf-multi-header.ts
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 2 / T2.1.
 * EC absorbed: EC-5 (trustForwardedHeaders), EC-10 (multiple Origin reject).
 */
import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'

import { evaluateCsrfMultiHeader } from '../../packages/theo/src/server/security/csrf-multi-header.js'

function mockReq(headers: Record<string, string | string[]>): IncomingMessage {
  return { headers } as IncomingMessage
}

describe('evaluateCsrfMultiHeader — Sec-Fetch-Site (primary)', () => {
  it('should allow same-origin', () => {
    const d = evaluateCsrfMultiHeader(mockReq({ 'sec-fetch-site': 'same-origin' }))
    expect(d.allow).toBe(true)
    expect(d.signal).toBe('sec-fetch-site')
  })

  it('should allow none (direct navigation)', () => {
    const d = evaluateCsrfMultiHeader(mockReq({ 'sec-fetch-site': 'none' }))
    expect(d.allow).toBe(true)
  })

  it('should reject cross-site', () => {
    const d = evaluateCsrfMultiHeader(mockReq({ 'sec-fetch-site': 'cross-site' }))
    expect(d.allow).toBe(false)
    expect(d.signal).toBe('sec-fetch-site')
  })
})

describe('evaluateCsrfMultiHeader — Origin (fallback)', () => {
  it('should allow same-origin via Origin matching host', () => {
    const d = evaluateCsrfMultiHeader(
      mockReq({ origin: 'http://example.com', host: 'example.com' }),
    )
    expect(d.allow).toBe(true)
    expect(d.signal).toBe('origin')
  })

  it('should allow Origin in allowedOrigins via wildcard', () => {
    const d = evaluateCsrfMultiHeader(
      mockReq({ origin: 'http://app.example.com', host: 'api.example.com' }),
      { allowedOrigins: ['*.example.com'] },
    )
    expect(d.allow).toBe(true)
  })

  it('should reject Origin not in allowlist', () => {
    const d = evaluateCsrfMultiHeader(mockReq({ origin: 'http://evil.com', host: 'example.com' }))
    expect(d.allow).toBe(false)
    expect(d.signal).toBe('origin')
  })

  it('should allow Origin=null from sandboxed iframe', () => {
    const d = evaluateCsrfMultiHeader(mockReq({ origin: 'null', host: 'example.com' }))
    expect(d.allow).toBe(true)
  })
})

describe('evaluateCsrfMultiHeader — Referer (fallback)', () => {
  it('should allow when Referer matches own origin', () => {
    const d = evaluateCsrfMultiHeader(
      mockReq({ referer: 'http://example.com/page', host: 'example.com' }),
    )
    expect(d.allow).toBe(true)
    expect(d.signal).toBe('referer')
  })

  it('should reject when Referer origin mismatches', () => {
    const d = evaluateCsrfMultiHeader(
      mockReq({ referer: 'http://evil.com/page', host: 'example.com' }),
    )
    expect(d.allow).toBe(false)
  })

  it('should reject invalid Referer URL', () => {
    const d = evaluateCsrfMultiHeader(mockReq({ referer: 'not a url', host: 'example.com' }))
    expect(d.allow).toBe(false)
  })
})

describe('evaluateCsrfMultiHeader — no headers', () => {
  it('should reject by default when all 3 headers missing', () => {
    const d = evaluateCsrfMultiHeader(mockReq({ host: 'example.com' }))
    expect(d.allow).toBe(false)
    expect(d.signal).toBe('no-headers')
  })

  it('should allow when allowRequestsWithoutOriginCheck=true', () => {
    const d = evaluateCsrfMultiHeader(mockReq({ host: 'example.com' }), {
      allowRequestsWithoutOriginCheck: true,
    })
    expect(d.allow).toBe(true)
  })
})

describe('evaluateCsrfMultiHeader — EC-5 trustForwardedHeaders', () => {
  it('should ignore x-forwarded-host when flag is false (default)', () => {
    // attacker injects x-forwarded-host but real host is example.com
    const d = evaluateCsrfMultiHeader(
      mockReq({
        origin: 'http://example.com',
        host: 'example.com',
        'x-forwarded-host': 'evil.com',
      }),
    )
    // Origin matches real host (example.com), so allow
    expect(d.allow).toBe(true)
  })

  it('should reject spoofed x-forwarded-host when flag is false', () => {
    // Attacker sends Origin=evil.com hoping x-forwarded-host moves the goalposts
    const d = evaluateCsrfMultiHeader(
      mockReq({
        origin: 'http://evil.com',
        host: 'example.com',
        'x-forwarded-host': 'evil.com',
      }),
      { trustForwardedHeaders: false },
    )
    // Own origin derived from real host = example.com; evil.com Origin rejected
    expect(d.allow).toBe(false)
  })

  it('should respect x-forwarded-host when flag is true', () => {
    const d = evaluateCsrfMultiHeader(
      mockReq({
        origin: 'http://app.example.com',
        host: 'internal-host',
        'x-forwarded-host': 'app.example.com',
      }),
      { trustForwardedHeaders: true },
    )
    expect(d.allow).toBe(true)
  })
})

describe('evaluateCsrfMultiHeader — EC-10 multiple Origin headers', () => {
  it('should reject when Origin is an array', () => {
    const d = evaluateCsrfMultiHeader(
      mockReq({
        origin: ['http://example.com', 'http://evil.com'],
        host: 'example.com',
      }),
    )
    expect(d.allow).toBe(false)
    expect(d.signal).toBe('multiple-origin')
  })
})

describe('evaluateCsrfMultiHeader — no DEV bypass', () => {
  it('should reject in test/dev env when conditions fail', () => {
    // Confirm there is no NODE_ENV bypass
    const d = evaluateCsrfMultiHeader(mockReq({ origin: 'http://evil.com', host: 'example.com' }))
    expect(d.allow).toBe(false)
  })
})
