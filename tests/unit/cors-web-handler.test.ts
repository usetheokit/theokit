/**
 * T5a.2 Phase B slice 5/6 — Web-Standards CORS handler tests.
 *
 * Verifies `createCorsWebHandler(config): CorsWebHandler` is a behaviour-
 * equivalent mirror of `createCorsHandler(config): CorsHandler` for the
 * Web Request shape. Same `matchesOrigin` policy (pure helper shared),
 * same security guarantees (echo matched origin only, never `'*'` when
 * credentials enabled).
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase B. The IncomingMessage tests in `cors.test.ts` cover the
 * legacy path; this file covers the Web Request path.
 */
import { describe, it, expect } from 'vitest'

import { createCorsWebHandler } from '../../packages/theo/src/server/http/cors.js'

describe('createCorsWebHandler (T5a.2 Phase B slice 5/6 — Web shape)', () => {
  // === handlePreflightRequest: non-preflight bypass ===

  it('non-OPTIONS request → null (not a preflight)', () => {
    const handler = createCorsWebHandler({ origins: 'http://example.com' })
    const request = new Request('http://example.com/api', { method: 'POST' })
    expect(handler.handlePreflightRequest(request)).toBeNull()
  })

  it('OPTIONS without access-control-request-method → null (not a preflight)', () => {
    const handler = createCorsWebHandler({ origins: 'http://example.com' })
    const request = new Request('http://example.com/api', { method: 'OPTIONS' })
    expect(handler.handlePreflightRequest(request)).toBeNull()
  })

  it('OPTIONS preflight without Origin → null', () => {
    const handler = createCorsWebHandler({ origins: 'http://example.com' })
    const request = new Request('http://example.com/api', {
      method: 'OPTIONS',
      headers: { 'access-control-request-method': 'POST' },
    })
    expect(handler.handlePreflightRequest(request)).toBeNull()
  })

  // === handlePreflightRequest: origin allow / deny ===

  it('preflight from disallowed origin → 403', () => {
    const handler = createCorsWebHandler({ origins: 'http://example.com' })
    const request = new Request('http://example.com/api', {
      method: 'OPTIONS',
      headers: {
        'access-control-request-method': 'POST',
        origin: 'http://attacker.com',
      },
    })
    const response = handler.handlePreflightRequest(request)
    expect(response).not.toBeNull()
    expect(response!.status).toBe(403)
  })

  it('preflight from allowed origin → 204 + echoes origin + CORS headers', () => {
    const handler = createCorsWebHandler({
      origins: 'http://example.com',
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'X-Custom'],
      maxAge: 3600,
    })
    const request = new Request('http://example.com/api', {
      method: 'OPTIONS',
      headers: {
        'access-control-request-method': 'POST',
        origin: 'http://example.com',
      },
    })
    const response = handler.handlePreflightRequest(request)
    expect(response).not.toBeNull()
    expect(response!.status).toBe(204)
    expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com')
    expect(response!.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(response!.headers.get('Access-Control-Allow-Headers')).toContain('X-Custom')
    expect(response!.headers.get('Access-Control-Max-Age')).toBe('3600')
    expect(response!.headers.get('Vary')).toBe('Origin')
  })

  it("preflight with credentials echoes matched origin (NEVER '*')", () => {
    const handler = createCorsWebHandler({ origins: '*', credentials: true })
    const request = new Request('http://example.com/api', {
      method: 'OPTIONS',
      headers: {
        'access-control-request-method': 'POST',
        origin: 'http://example.com',
      },
    })
    const response = handler.handlePreflightRequest(request)
    expect(response).not.toBeNull()
    // Echo the request's origin — never '*' when credentials enabled
    expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com')
    expect(response!.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  it('preflight from regex-matched origin → 204', () => {
    const handler = createCorsWebHandler({ origins: /^https:\/\/.*\.example\.com$/ })
    const request = new Request('https://api.example.com/v1', {
      method: 'OPTIONS',
      headers: {
        'access-control-request-method': 'POST',
        origin: 'https://app.example.com',
      },
    })
    const response = handler.handlePreflightRequest(request)
    expect(response).not.toBeNull()
    expect(response!.status).toBe(204)
    expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
  })

  it('preflight with callback origin matcher → respects boolean return', () => {
    const handler = createCorsWebHandler({
      origins: (origin) => origin.endsWith('.allowed.com'),
    })
    const okReq = new Request('http://example.com/api', {
      method: 'OPTIONS',
      headers: {
        'access-control-request-method': 'POST',
        origin: 'http://x.allowed.com',
      },
    })
    expect(handler.handlePreflightRequest(okReq)!.status).toBe(204)

    const denyReq = new Request('http://example.com/api', {
      method: 'OPTIONS',
      headers: {
        'access-control-request-method': 'POST',
        origin: 'http://x.evil.com',
      },
    })
    expect(handler.handlePreflightRequest(denyReq)!.status).toBe(403)
  })

  // === applyCorsHeaders: response decoration ===

  it('applyCorsHeaders adds Allow-Origin + Vary when origin matches', () => {
    const handler = createCorsWebHandler({ origins: 'http://example.com' })
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { origin: 'http://example.com' },
    })
    const target = new Headers()
    handler.applyCorsHeaders(request, target)
    expect(target.get('Access-Control-Allow-Origin')).toBe('http://example.com')
    expect(target.get('Vary')).toBe('Origin')
  })

  it('applyCorsHeaders is no-op when origin missing', () => {
    const handler = createCorsWebHandler({ origins: 'http://example.com' })
    const request = new Request('http://example.com/api', { method: 'POST' })
    const target = new Headers()
    handler.applyCorsHeaders(request, target)
    expect(target.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('applyCorsHeaders is no-op when origin disallowed', () => {
    const handler = createCorsWebHandler({ origins: 'http://example.com' })
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { origin: 'http://attacker.com' },
    })
    const target = new Headers()
    handler.applyCorsHeaders(request, target)
    expect(target.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('applyCorsHeaders includes Expose-Headers when configured', () => {
    const handler = createCorsWebHandler({
      origins: 'http://example.com',
      exposedHeaders: ['X-Total-Count', 'X-Request-Id'],
    })
    const request = new Request('http://example.com/api', {
      method: 'GET',
      headers: { origin: 'http://example.com' },
    })
    const target = new Headers()
    handler.applyCorsHeaders(request, target)
    expect(target.get('Access-Control-Expose-Headers')).toBe('X-Total-Count, X-Request-Id')
  })

  it('applyCorsHeaders includes Allow-Credentials when configured', () => {
    const handler = createCorsWebHandler({ origins: 'http://example.com', credentials: true })
    const request = new Request('http://example.com/api', {
      method: 'GET',
      headers: { origin: 'http://example.com' },
    })
    const target = new Headers()
    handler.applyCorsHeaders(request, target)
    expect(target.get('Access-Control-Allow-Credentials')).toBe('true')
  })
})
