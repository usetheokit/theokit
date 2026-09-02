import { describe, it, expect } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createSessionManager } from '../../packages/theo/src/server/auth/session.js'

/**
 * T3.2 — Transparent re-encrypt on legacy-secret decrypt.
 *
 * Unit-level tests for the `getSessionWithMeta` contract. Integration
 * with api-middleware (where re-encrypt actually happens BEFORE the
 * handler runs — EC-4) is covered in tests/integration/session-rotation*.test.ts.
 */

// `openssl rand -hex 32`-shaped. A fixture that trips the production guard (#610) is one the
// suite reports as a warning on every run, which is how a warning stops being read.
const NEW_SECRET = '1720285f0edf9323313351f15289a6c1520a932d509e0862e52e82019ea6a8e4'
const OLD_SECRET = '6713e4c94568ac68a546b7f0700f1444ad7ae0fd90752231613a9fff429987b7'

interface TS {
  userId: string
}

function createMockRes(): ServerResponse {
  const headers: Record<string, string | string[]> = {}
  return {
    getHeader: (name: string) => headers[name.toLowerCase()],
    setHeader: (name: string, value: string | string[]) => {
      headers[name.toLowerCase()] = value
    },
  } as unknown as ServerResponse
}

function createMockReq(cookies: Record<string, string> = {}): IncomingMessage {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('; ')
  return { headers: { cookie: cookieHeader } } as unknown as IncomingMessage
}

function extractCookieValue(res: ServerResponse, name: string): string | undefined {
  const setCookie = res.getHeader('set-cookie')
  if (!setCookie) return undefined
  const cookies = Array.isArray(setCookie) ? setCookie : [String(setCookie)]
  for (const cookie of cookies) {
    if (cookie.startsWith(`${name}=`)) {
      return decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='))
    }
  }
  return undefined
}

describe('T3.2 — getSessionWithMeta', () => {
  it('returns needsReencrypt=true for session encrypted with secrets[1] (legacy)', async () => {
    // Step 1: create session with OLD only
    const legacy = createSessionManager<TS>({ secret: OLD_SECRET })
    const r1 = createMockRes()
    await legacy.createSession(r1, { userId: 'u1' })
    const legacyCookie = extractCookieValue(r1, 'theo_session')!

    // Step 2: rotate
    const rotated = createSessionManager<TS>({ secret: [NEW_SECRET, OLD_SECRET] })
    const { data, meta } = await rotated.getSessionWithMeta(
      createMockReq({ theo_session: legacyCookie }),
    )
    expect(data).toEqual({ userId: 'u1' })
    expect(meta.needsReencrypt).toBe(true)
    expect(meta.secretIndex).toBe(1)
  })

  it('returns needsReencrypt=false for session encrypted with secrets[0] (newest)', async () => {
    const auth = createSessionManager<TS>({ secret: [NEW_SECRET, OLD_SECRET] })
    const r1 = createMockRes()
    await auth.createSession(r1, { userId: 'u1' })
    const cookieValue = extractCookieValue(r1, 'theo_session')!

    const { data, meta } = await auth.getSessionWithMeta(
      createMockReq({ theo_session: cookieValue }),
    )
    expect(data).toEqual({ userId: 'u1' })
    expect(meta.needsReencrypt).toBe(false)
    expect(meta.secretIndex).toBe(0)
  })

  it('getSession() returns data unchanged (backwards-compat delegation)', async () => {
    const auth = createSessionManager<TS>({ secret: NEW_SECRET })
    const r1 = createMockRes()
    await auth.createSession(r1, { userId: 'u1' })
    const cookieValue = extractCookieValue(r1, 'theo_session')!
    const data = await auth.getSession(createMockReq({ theo_session: cookieValue }))
    expect(data).toEqual({ userId: 'u1' })
  })

  it('EC: no cookie present, then needsReencrypt=false, data=null', async () => {
    const auth = createSessionManager<TS>({ secret: [NEW_SECRET, OLD_SECRET] })
    const { data, meta } = await auth.getSessionWithMeta(createMockReq())
    expect(data).toBeNull()
    expect(meta.needsReencrypt).toBe(false)
  })

  it('all decrypts fail → data=null, needsReencrypt=false (no exception)', async () => {
    const thirdParty = createSessionManager<TS>({
      secret: 'b72363f8913fd0c21d5f7028810235c710f1615fe3bee59bc792122f28c5303a',
    })
    const r1 = createMockRes()
    await thirdParty.createSession(r1, { userId: 'X' })
    const cookieValue = extractCookieValue(r1, 'theo_session')!

    const ours = createSessionManager<TS>({ secret: [NEW_SECRET, OLD_SECRET] })
    const { data, meta } = await ours.getSessionWithMeta(
      createMockReq({ theo_session: cookieValue }),
    )
    expect(data).toBeNull()
    expect(meta.needsReencrypt).toBe(false)
  })
})
