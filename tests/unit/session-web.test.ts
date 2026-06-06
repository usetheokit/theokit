/**
 * T5a.2 Phase D slice 3/3 — Web-Standards session manager tests.
 *
 * Verifies `createSessionManagerWeb<TSession>(config)` + `rotateIfNeededWeb`
 * are behaviour-equivalent mirrors of `createSessionManager` + `rotateIfNeeded`
 * for the Web Request + Headers shape.
 *
 * Same SessionConfig, same crypto (AES-256-GCM via Web Crypto), same dual-
 * key rotation logic (CR-002 constant-time decrypt walk + transparent
 * re-encrypt), same OWASP A07 rotateSession invariant.
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase D.
 */
import { describe, it, expect } from 'vitest'

import {
  createSessionManagerWeb,
  rotateIfNeededWeb,
} from '../../packages/theo/src/server/auth/session.js'

// Test secret meeting the 32-char minimum.
const SECRET_A = 'a'.repeat(32)
const SECRET_B = 'b'.repeat(32)

interface UserSession {
  userId: string
  role: string
}

/**
 * Convenience helper: extract a session cookie value from a Headers
 * instance (via getSetCookie) and stuff it into a fresh Request's
 * `cookie` header to simulate the browser round-trip.
 */
function makeRequestWithSessionFrom(headers: Headers, cookieName = 'theo_session'): Request {
  const setCookies = headers.getSetCookie()
  // Pick the most recent Set-Cookie for the target cookie name
  let raw = ''
  for (const sc of setCookies) {
    if (sc.startsWith(`${cookieName}=`)) {
      const eq = sc.indexOf('=')
      const semi = sc.indexOf(';')
      const end = semi === -1 ? sc.length : semi
      raw = sc.slice(eq + 1, end)
    }
  }
  return new Request('http://example.com/api', {
    method: 'GET',
    headers: { cookie: `${cookieName}=${raw}` },
  })
}

describe('createSessionManagerWeb (T5a.2 Phase D slice 3/3 — Web shape)', () => {
  it('createSession + getSession round-trip via Headers + Request', async () => {
    const sm = createSessionManagerWeb<UserSession>({ secret: SECRET_A })
    const headers = new Headers()
    await sm.createSession(headers, { userId: 'u-1', role: 'admin' })

    const request = makeRequestWithSessionFrom(headers)
    const session = await sm.getSession(request)
    expect(session).toEqual({ userId: 'u-1', role: 'admin' })
  })

  it('getSession returns null when no cookie present', async () => {
    const sm = createSessionManagerWeb<UserSession>({ secret: SECRET_A })
    const request = new Request('http://example.com/api', { method: 'GET' })
    expect(await sm.getSession(request)).toBeNull()
  })

  it('getSession returns null when secret rotation fails to decrypt', async () => {
    const sm1 = createSessionManagerWeb<UserSession>({ secret: SECRET_A })
    const headers = new Headers()
    await sm1.createSession(headers, { userId: 'u-2', role: 'user' })

    // Different secret — cannot decrypt
    const sm2 = createSessionManagerWeb<UserSession>({ secret: SECRET_B })
    const request = makeRequestWithSessionFrom(headers)
    expect(await sm2.getSession(request)).toBeNull()
  })

  it('destroySession appends a Set-Cookie with Max-Age=0', () => {
    const sm = createSessionManagerWeb<UserSession>({ secret: SECRET_A })
    const headers = new Headers()
    sm.destroySession(headers)
    const setCookies = headers.getSetCookie()
    expect(setCookies).toHaveLength(1)
    expect(setCookies[0]).toContain('theo_session=')
    expect(setCookies[0]).toContain('Max-Age=0')
  })

  it('getSessionWithMeta surfaces secretIndex=0 for fresh single-secret session', async () => {
    const sm = createSessionManagerWeb<UserSession>({ secret: SECRET_A })
    const headers = new Headers()
    await sm.createSession(headers, { userId: 'u-3', role: 'admin' })
    const request = makeRequestWithSessionFrom(headers)
    const { data, meta } = await sm.getSessionWithMeta(request)
    expect(data).toEqual({ userId: 'u-3', role: 'admin' })
    expect(meta.secretIndex).toBe(0)
    expect(meta.needsReencrypt).toBe(false)
  })

  it('CR-002 dual-key rotation: cookie encrypted with legacy secret decrypts with needsReencrypt=true', async () => {
    // Step 1: encrypt with legacy secret (was newest at one point)
    const smLegacy = createSessionManagerWeb<UserSession>({ secret: SECRET_B })
    const headers = new Headers()
    await smLegacy.createSession(headers, { userId: 'u-4', role: 'admin' })
    const request = makeRequestWithSessionFrom(headers)

    // Step 2: rotate — new secret at index 0, legacy at index 1
    const smRotated = createSessionManagerWeb<UserSession>({ secret: [SECRET_A, SECRET_B] })
    const { data, meta } = await smRotated.getSessionWithMeta(request)
    expect(data).toEqual({ userId: 'u-4', role: 'admin' })
    expect(meta.secretIndex).toBe(1) // legacy
    expect(meta.needsReencrypt).toBe(true)
  })

  it('rotateSession re-encrypts existing session with newest secret', async () => {
    const sm = createSessionManagerWeb<UserSession>({ secret: SECRET_A })
    const initialHeaders = new Headers()
    await sm.createSession(initialHeaders, { userId: 'u-5', role: 'admin' })
    const request = makeRequestWithSessionFrom(initialHeaders)

    const rotateHeaders = new Headers()
    const data = await sm.rotateSession(request, rotateHeaders)
    expect(data).toEqual({ userId: 'u-5', role: 'admin' })
    // New Set-Cookie issued
    expect(rotateHeaders.getSetCookie()).toHaveLength(1)
    expect(rotateHeaders.getSetCookie()[0]).toContain('theo_session=')
  })

  it('rotateSession returns null when no session present', async () => {
    const sm = createSessionManagerWeb<UserSession>({ secret: SECRET_A })
    const request = new Request('http://example.com/api', { method: 'GET' })
    const target = new Headers()
    expect(await sm.rotateSession(request, target)).toBeNull()
    expect(target.getSetCookie()).toHaveLength(0)
  })

  it('respects custom cookieName from config', async () => {
    const sm = createSessionManagerWeb<UserSession>({
      secret: SECRET_A,
      cookieName: 'app_session',
    })
    const headers = new Headers()
    await sm.createSession(headers, { userId: 'u-6', role: 'admin' })
    expect(headers.getSetCookie()[0]).toContain('app_session=')
    const request = makeRequestWithSessionFrom(headers, 'app_session')
    expect(await sm.getSession(request)).toEqual({ userId: 'u-6', role: 'admin' })
  })
})

describe('rotateIfNeededWeb (T5a.2 Phase D slice 3/3 — Web sibling)', () => {
  it('no-op when session uses newest secret', async () => {
    const sm = createSessionManagerWeb<UserSession>({ secret: SECRET_A })
    const initialHeaders = new Headers()
    await sm.createSession(initialHeaders, { userId: 'u-7', role: 'admin' })
    const request = makeRequestWithSessionFrom(initialHeaders)

    const target = new Headers()
    const data = await rotateIfNeededWeb(sm, request, target)
    expect(data).toEqual({ userId: 'u-7', role: 'admin' })
    // No re-encrypt needed → no Set-Cookie on target
    expect(target.getSetCookie()).toHaveLength(0)
  })

  it('re-encrypts when session was decrypted with legacy secret', async () => {
    // Encrypt with old secret
    const smOld = createSessionManagerWeb<UserSession>({ secret: SECRET_B })
    const oldHeaders = new Headers()
    await smOld.createSession(oldHeaders, { userId: 'u-8', role: 'admin' })
    const request = makeRequestWithSessionFrom(oldHeaders)

    // New manager with rotation
    const smNew = createSessionManagerWeb<UserSession>({ secret: [SECRET_A, SECRET_B] })
    const target = new Headers()
    const data = await rotateIfNeededWeb(smNew, request, target)
    expect(data).toEqual({ userId: 'u-8', role: 'admin' })
    // Re-encrypt happened → fresh Set-Cookie with newest secret
    expect(target.getSetCookie()).toHaveLength(1)
  })

  it('returns null + no-op when no session present', async () => {
    const sm = createSessionManagerWeb<UserSession>({ secret: SECRET_A })
    const request = new Request('http://example.com/api', { method: 'GET' })
    const target = new Headers()
    expect(await rotateIfNeededWeb(sm, request, target)).toBeNull()
    expect(target.getSetCookie()).toHaveLength(0)
  })
})
