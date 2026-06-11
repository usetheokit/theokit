/**
 * T5a.2 Phase B slice 6/6 — Web-Standards cookie helpers tests.
 *
 * Verifies the 3 Web siblings of the IncomingMessage/ServerResponse
 * cookie helpers:
 *   - `getCookieFromRequest(request, name)` — mirrors `getCookie`
 *   - `appendCookieToHeaders(target, name, value, opts)` — mirrors `setCookie`
 *   - `appendDeleteCookieToHeaders(target, name, opts)` — mirrors `deleteCookie`
 *   - `serializeCookie(name, value, opts)` — pure helper shared by both paths
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase B (closes Phase B with leaf #6 of 6 — header-only cluster
 * complete).
 */
import { describe, it, expect } from 'vitest'

import {
  getCookieFromRequest,
  appendCookieToHeaders,
  appendDeleteCookieToHeaders,
  serializeCookie,
} from '../../packages/theo/src/server/http/cookies.js'

describe('serializeCookie (T5a.2 Phase B slice 6/6 — pure shared helper)', () => {
  it('emits HttpOnly + SameSite=Lax + Path=/ by default', () => {
    const s = serializeCookie('foo', 'bar')
    expect(s).toContain('foo=bar')
    expect(s).toContain('HttpOnly')
    expect(s).toContain('SameSite=Lax')
    expect(s).toContain('Path=/')
  })

  it('URL-encodes the value', () => {
    const s = serializeCookie('token', 'a b/c')
    expect(s).toContain('token=a%20b%2Fc')
  })

  it('includes Max-Age when provided', () => {
    const s = serializeCookie('sid', 'x', { maxAge: 3600 })
    expect(s).toContain('Max-Age=3600')
  })

  it('includes Domain when provided', () => {
    const s = serializeCookie('sid', 'x', { domain: '.example.com' })
    expect(s).toContain('Domain=.example.com')
  })

  it('omits HttpOnly when explicitly false', () => {
    const s = serializeCookie('sid', 'x', { httpOnly: false })
    expect(s).not.toContain('HttpOnly')
  })

  it('emits SameSite=Strict when configured', () => {
    const s = serializeCookie('sid', 'x', { sameSite: 'strict' })
    expect(s).toContain('SameSite=Strict')
  })

  it('emits Secure when explicitly true', () => {
    const s = serializeCookie('sid', 'x', { secure: true })
    expect(s).toContain('Secure')
  })

  it('uses custom Path', () => {
    const s = serializeCookie('sid', 'x', { path: '/api' })
    expect(s).toContain('Path=/api')
  })
})

describe('getCookieFromRequest (T5a.2 Phase B slice 6/6 — Web shape)', () => {
  it('returns undefined when no Cookie header present', () => {
    const request = new Request('http://example.com', { method: 'GET' })
    expect(getCookieFromRequest(request, 'sid')).toBeUndefined()
  })

  it('returns undefined when cookie name not in header', () => {
    const request = new Request('http://example.com', {
      method: 'GET',
      headers: { cookie: 'other=value' },
    })
    expect(getCookieFromRequest(request, 'sid')).toBeUndefined()
  })

  it('returns the URL-decoded value when present', () => {
    const request = new Request('http://example.com', {
      method: 'GET',
      headers: { cookie: 'sid=abc%20def' },
    })
    expect(getCookieFromRequest(request, 'sid')).toBe('abc def')
  })

  it('handles multiple cookies in the header (last wins for duplicates)', () => {
    const request = new Request('http://example.com', {
      method: 'GET',
      headers: { cookie: 'a=1; b=2; c=3' },
    })
    expect(getCookieFromRequest(request, 'b')).toBe('2')
  })

  it('returns undefined for cookies with malformed percent-encoding (CR-009 safety)', () => {
    // CR-009 regex catches `%[non-hex]` (e.g. `%G1`) AND `%[hex]$` (single
    // hex char at end). A bare `%` at end is NOT caught — that mirrors the
    // legacy IncomingMessage getCookie behavior; the regex is documented
    // as not-exhaustive (mostly catches `%XX` invalid hex pairs).
    const request = new Request('http://example.com', {
      method: 'GET',
      headers: { cookie: 'broken=%G1' }, // %G1 is invalid (G is not hex)
    })
    expect(getCookieFromRequest(request, 'broken')).toBeUndefined()
  })

  it('skips malformed entries (no = sign)', () => {
    const request = new Request('http://example.com', {
      method: 'GET',
      headers: { cookie: 'flag; sid=abc' },
    })
    expect(getCookieFromRequest(request, 'sid')).toBe('abc')
  })
})

describe('appendCookieToHeaders + appendDeleteCookieToHeaders (T5a.2 Phase B slice 6/6 — Web shape)', () => {
  it('appendCookieToHeaders adds Set-Cookie via Headers.append', () => {
    const target = new Headers()
    appendCookieToHeaders(target, 'sid', 'abc123')
    const setCookies = target.getSetCookie()
    expect(setCookies).toHaveLength(1)
    expect(setCookies[0]).toContain('sid=abc123')
    expect(setCookies[0]).toContain('HttpOnly')
  })

  it('multiple appendCookieToHeaders produce multiple Set-Cookie headers (Web spec)', () => {
    const target = new Headers()
    appendCookieToHeaders(target, 'sid', 'abc')
    appendCookieToHeaders(target, 'csrf', 'xyz', { sameSite: 'strict' })
    const setCookies = target.getSetCookie()
    expect(setCookies).toHaveLength(2)
    expect(setCookies.some((c) => c.startsWith('sid=abc'))).toBe(true)
    expect(setCookies.some((c) => c.includes('csrf=xyz') && c.includes('SameSite=Strict'))).toBe(
      true,
    )
  })

  it('appendDeleteCookieToHeaders emits Set-Cookie with Max-Age=0', () => {
    const target = new Headers()
    appendDeleteCookieToHeaders(target, 'sid')
    const setCookies = target.getSetCookie()
    expect(setCookies).toHaveLength(1)
    expect(setCookies[0]).toContain('sid=')
    expect(setCookies[0]).toContain('Max-Age=0')
    expect(setCookies[0]).toContain('Path=/')
  })

  it('appendDeleteCookieToHeaders respects custom path', () => {
    const target = new Headers()
    appendDeleteCookieToHeaders(target, 'sid', { path: '/admin' })
    const setCookies = target.getSetCookie()
    expect(setCookies[0]).toContain('Path=/admin')
  })

  it('appendCookieToHeaders + Response constructor round-trip', () => {
    // Real-world pattern: build Set-Cookie headers, attach to Response
    const headers = new Headers({ 'content-type': 'application/json' })
    appendCookieToHeaders(headers, 'sid', 'session-token')
    const response = new Response('{}', { status: 200, headers })
    expect(response.headers.getSetCookie()).toHaveLength(1)
    expect(response.headers.getSetCookie()[0]).toContain('sid=session-token')
  })
})
