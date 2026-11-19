import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDevicePairing } from './device-pairing.js'
import { pairRoute } from './pair-route.js'

const CRED = 'abcdefghijklmnopqrstuvwxyz012345'
const setup = (extra: { codeTtlMs?: number; maxPending?: number } = {}) => {
  let t = 1000
  const dir = mkdtempSync(join(tmpdir(), 'pairing-'))
  const pairing = createDevicePairing({ dir, now: () => t, ...extra })
  return { dir, pairing, advance: (ms: number) => (t += ms) }
}

describe('createDevicePairing', () => {
  it('a setup code expires after codeTtlMs and works once', () => {
    const { pairing, advance } = setup({ codeTtlMs: 100 })
    const code = pairing.issueCode()
    expect(pairing.request(code, 'phone', CRED).ok).toBe(true)
    expect(pairing.request(code, 'phone', CRED)).toEqual({
      ok: false,
      reason: 'unknown_or_expired',
    })
    const late = pairing.issueCode()
    advance(100)
    expect(pairing.request(late, 'phone', CRED)).toEqual({
      ok: false,
      reason: 'unknown_or_expired',
    })
  })

  it('a credential with fewer than 10 distinct characters is refused as bad_credential', () => {
    const { pairing } = setup()
    const code = pairing.issueCode()
    expect(pairing.request(code, 'phone', 'ab'.repeat(20))).toEqual({
      ok: false,
      reason: 'bad_credential',
    })
    expect(pairing.request(code, 'phone', 'short')).toEqual({ ok: false, reason: 'bad_credential' })
    expect(pairing.request(code, ' ', CRED)).toEqual({ ok: false, reason: 'bad_name' })
  })

  it('the store file holds digests only and has mode 0600', async () => {
    const { dir, pairing } = setup()
    const r = pairing.request(pairing.issueCode(), 'phone', CRED)
    if (!r.ok) throw new Error('request failed')
    expect(await pairing.approve(r.id)).toEqual({ ok: true, name: 'phone' })
    const file = join(dir, 'devices.json')
    expect(readFileSync(file, 'utf8')).not.toContain(CRED)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(pairing.accepts(`Bearer ${CRED}`)).toBe(true)
    expect(pairing.accepts('Bearer nope')).toBe(false)
    expect(createDevicePairing({ dir }).accepts(`Bearer ${CRED}`)).toBe(true)
  })

  it('a revoked device is no longer accepted and onRevoke fires', async () => {
    const { pairing } = setup()
    const r = pairing.request(pairing.issueCode(), 'phone', CRED)
    if (!r.ok) throw new Error('request failed')
    await pairing.approve(r.id)
    const seen: string[] = []
    pairing.onRevoke((id) => seen.push(id))
    expect(await pairing.revoke('phone')).toBe(true)
    expect(seen).toEqual([r.id])
    expect(pairing.accepts(`Bearer ${CRED}`)).toBe(false)
    expect(await pairing.revoke('phone')).toBe(false)
  })

  it('the 21st pending request answers too_many_pending', () => {
    const { pairing } = setup()
    for (let i = 0; i < 20; i++) {
      expect(pairing.request(pairing.issueCode(), `d${i}`, `${CRED}${i}`).ok).toBe(true)
    }
    expect(pairing.request(pairing.issueCode(), 'd21', CRED)).toEqual({
      ok: false,
      reason: 'too_many_pending',
    })
  })

  it('deny drops a pending request', () => {
    const { pairing } = setup()
    const r = pairing.request(pairing.issueCode(), 'phone', CRED)
    if (!r.ok) throw new Error('request failed')
    expect(pairing.pending()).toHaveLength(1)
    expect(pairing.deny(r.id)).toBe(true)
    expect(pairing.deny(r.id)).toBe(false)
  })
})

describe('pairRoute', () => {
  const post = (body: string) => new Request('http://x/pair', { method: 'POST', body })
  it('maps outcomes to statuses without echoing the credential', async () => {
    const { pairing } = setup()
    const route = pairRoute(pairing)
    const code = pairing.issueCode()
    const ok = await route(post(JSON.stringify({ code, name: 'p', credential: CRED })))
    expect(ok.status).toBe(202)
    expect(await ok.text()).not.toContain(CRED)
    expect((await route(post(JSON.stringify({ code, name: 'p', credential: CRED })))).status).toBe(
      401,
    )
    expect((await route(post('nope'))).status).toBe(400)
    expect((await route(post('x'.repeat(70_000)))).status).toBe(413)
    expect((await route(new Request('http://x/pair'))).status).toBe(405)
  })
})
