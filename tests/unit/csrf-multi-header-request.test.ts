/**
 * T5a.2 Phase B slice 2/6 — Web-Standards-shaped multi-header CSRF tests.
 *
 * Verifies `evaluateCsrfMultiHeaderRequest(request: Request, options)` is
 * a behaviour-equivalent mirror of `evaluateCsrfMultiHeader(req:
 * IncomingMessage, options)` for the Web Standards path. The pure
 * `evaluateCsrfMultiHeaderFromInputs` helper is shared between both
 * wrappers — these tests cover the wrapper's input extraction + decision
 * shape.
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase B. The IncomingMessage tests in `csrf-multi-header.test.ts`
 * cover the legacy path; this file covers the Web Request path.
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

  it('allows when Sec-Fetch-Site: same-site', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-site' },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    expect(decision.allow).toBe(true)
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

  it('allows Origin: null (sandboxed iframe RFC 6454)', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        origin: 'null',
        host: 'example.com',
      },
    })
    const decision = evaluateCsrfMultiHeaderRequest(request)
    expect(decision).toEqual({ allow: true, signal: 'origin' })
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
