/**
 * T5a.2 Phase B slice 2/6 — Web-Standards multi-header CSRF tests.
 *
 * `evaluateCsrfMultiHeaderRequest(request: Request, options)` is the only
 * shape of this gate. Its `IncomingMessage` twin was removed once the Web
 * `Request` covered every target, so the cases that used to live in
 * `csrf-multi-header.test.ts` are here.
 */
import { describe, it, expect } from 'vitest'

import { evaluateCsrfMultiHeaderRequest } from '../../packages/theo/src/server/security/csrf-multi-header.js'

describe('evaluateCsrfMultiHeaderRequest (T5a.2 Phase B slice 2/6 — Web shape)', () => {
  // === Sec-Fetch-Site path ===

  it('allows when Sec-Fetch-Site: same-origin', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin' },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    expect(decision).toEqual({ allow: true, signal: 'sec-fetch-site' })
  })

  it('allows when Sec-Fetch-Site: none (direct browser navigation)', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'none' },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    expect(decision.allow).toBe(true)
    if (decision.allow) expect(decision.signal).toBe('sec-fetch-site')
  })

  it('rejects when Sec-Fetch-Site: same-site (a sibling subdomain is not us)', () => {
    // `same-site` covers any host under the same registrable domain, so a
    // compromised subdomain -- or one owned by another tenant -- can forge a
    // plain form POST that carries this value. The gate demands no custom
    // header, so accepting it would accept the whole eTLD+1 as trusted.
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-site' },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    expect(decision.allow).toBe(false)
    if (!decision.allow) {
      expect(decision.signal).toBe('sec-fetch-site')
      expect(decision.reason).toContain('same-site')
    }
  })

  it('rejects when Sec-Fetch-Site: cross-site', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    expect(decision.allow).toBe(false)
    if (!decision.allow) {
      expect(decision.signal).toBe('sec-fetch-site')
      expect(decision.reason).toContain('cross-site')
    }
  })

  // === Origin path ===

  it('allows when Origin matches host (same-origin)', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        origin: 'http://example.com',
        host: 'example.com',
      },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    expect(decision).toEqual({ allow: true, signal: 'origin' })
  })

  it('rejects when Origin does not match host (cross-origin attack)', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        origin: 'http://attacker.com',
        host: 'example.com',
      },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    expect(decision.allow).toBe(false)
    if (!decision.allow) {
      expect(decision.signal).toBe('origin')
      expect(decision.reason).toContain('allowlist')
    }
  })

  it('rejects Origin: null (opaque origin, e.g. a sandboxed iframe)', () => {
    // `<iframe sandbox="allow-scripts allow-forms">` sends exactly this, and
    // an opaque origin proves nothing about who sent the request. `null` is a
    // valid header value per RFC 6454; it is not a valid proof of same-origin.
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        origin: 'null',
        host: 'example.com',
      },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    expect(decision.allow).toBe(false)
    if (!decision.allow) {
      expect(decision.signal).toBe('origin')
      expect(decision.reason).toContain('null')
    }
  })

  it('allows Origin in wildcard allowedOrigins list', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        origin: 'http://app.staging.example.com',
        host: 'example.com',
      },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request, {
      allowedOrigins: ['*.staging.example.com'],
    })
    expect(decision).toEqual({ allow: true, signal: 'origin' })
  })

  // === Referer path ===

  it('allows when Referer origin matches own origin', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        referer: 'http://example.com/some/page',
        host: 'example.com',
      },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    expect(decision).toEqual({ allow: true, signal: 'referer' })
  })

  it('rejects when the Referer origin is a different host', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        referer: 'http://evil.com/page',
        host: 'example.com',
      },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    expect(decision.allow).toBe(false)
    if (!decision.allow) expect(decision.signal).toBe('referer')
  })

  it('rejects when Referer URL is malformed', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        referer: 'not-a-valid-url',
        host: 'example.com',
      },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    expect(decision.allow).toBe(false)
    if (!decision.allow) expect(decision.signal).toBe('referer')
  })

  // === No headers path ===

  it('rejects when no CSRF headers present (default allowRequestsWithoutOriginCheck = false)', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { host: 'example.com' },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    expect(decision.allow).toBe(false)
    if (!decision.allow) expect(decision.signal).toBe('no-headers')
  })

  it('allows when no CSRF headers present + allowRequestsWithoutOriginCheck=true', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { host: 'example.com' },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request, {
      allowRequestsWithoutOriginCheck: true,
    })
    expect(decision).toEqual({ allow: true, signal: 'no-headers-allowed' })
  })

  // === Forwarded headers path ===

  it('respects x-forwarded-host when trustForwardedHeaders=true', () => {
    const request = new Request('http://internal-lb.local/api', {
      method: 'POST',
      headers: {
        origin: 'https://public.example.com',
        host: 'internal-lb.local',
        'x-forwarded-host': 'public.example.com',
        'x-forwarded-proto': 'https',
      },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request, { trustForwardedHeaders: true })
    expect(decision).toEqual({ allow: true, signal: 'origin' })
  })

  it('derives own origin from the real host when trustForwardedHeaders=false', () => {
    // An injected x-forwarded-host must not move the goalposts: the Origin
    // matches the real host, so the request is allowed on that basis alone.
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        origin: 'http://example.com',
        host: 'example.com',
        'x-forwarded-host': 'evil.com',
      },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    expect(decision).toEqual({ allow: true, signal: 'origin' })
  })

  it('ignores x-forwarded-host when trustForwardedHeaders=false (default)', () => {
    const request = new Request('http://internal-lb.local/api', {
      method: 'POST',
      headers: {
        origin: 'https://public.example.com',
        host: 'internal-lb.local',
        'x-forwarded-host': 'public.example.com',
      },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    expect(decision.allow).toBe(false)
  })

  // === Fallback ownOrigin from request.url ===

  it('falls back to request.url origin when host header absent', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { origin: 'http://example.com' },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    // request.url provides http://example.com → matches Origin
    expect(decision.allow).toBe(true)
    if (decision.allow) expect(decision.signal).toBe('origin')
  })
})
