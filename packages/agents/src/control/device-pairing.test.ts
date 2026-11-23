import { chmodSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDevicePairing } from './device-pairing.js'

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

describe('createDevicePairing edge cases', () => {
  const pair = (pairing: ReturnType<typeof setup>['pairing'], name: string, cred: string) => {
    const r = pairing.request(pairing.issueCode(), name, cred)
    if (!r.ok) throw new Error('request failed')
    return r.id
  }

  it('approve answers write_failed and approves nothing when the store cannot be written', async () => {
    const { dir, pairing } = setup()
    const id = pair(pairing, 'phone', CRED)
    chmodSync(dir, 0o500)
    const result = await pairing.approve(id)
    chmodSync(dir, 0o700)
    if (result.ok) return // running as root: the directory stays writable
    expect(result).toEqual({ ok: false, reason: 'write_failed' })
    expect(pairing.accepts(`Bearer ${CRED}`)).toBe(false)
    expect(pairing.pending()).toHaveLength(1)
  })

  it('concurrent approvals all land in the store', async () => {
    const { dir, pairing } = setup()
    const ids = [0, 1, 2, 3].map((i) => pair(pairing, `d${i}`, `${CRED}${i}`))
    await Promise.all(ids.map((id) => pairing.approve(id)))
    const stored = JSON.parse(readFileSync(join(dir, 'devices.json'), 'utf8')).devices
    expect(stored).toHaveLength(4)
    for (let i = 0; i < 4; i++) expect(pairing.accepts(`Bearer ${CRED}${i}`)).toBe(true)
  })

  it('revoke by name removes every device with that name and fires onRevoke for each', async () => {
    const { pairing } = setup()
    const a = pair(pairing, 'phone', `${CRED}a`)
    const b = pair(pairing, 'phone', `${CRED}b`)
    const c = pair(pairing, 'laptop', `${CRED}c`)
    for (const id of [a, b, c]) await pairing.approve(id)
    const seen: string[] = []
    pairing.onRevoke((id) => seen.push(id))
    expect(await pairing.revoke('phone')).toBe(true)
    expect(new Set(seen)).toEqual(new Set([a, b]))
    expect(seen).toHaveLength(2)
    expect(pairing.accepts(`Bearer ${CRED}a`)).toBe(false)
    expect(pairing.accepts(`Bearer ${CRED}c`)).toBe(true)
  })

  it('a pending request expires after codeTtlMs', async () => {
    const { pairing, advance } = setup({ codeTtlMs: 100 })
    const id = pair(pairing, 'phone', CRED)
    expect(pairing.pending()).toHaveLength(1)
    advance(100)
    expect(pairing.pending()).toHaveLength(0)
    expect(await pairing.approve(id)).toEqual({ ok: false, reason: 'unknown_request' })
  })

  it('approving the same credential again replaces the old device and fires onRevoke for it', async () => {
    const { pairing } = setup()
    const first = pair(pairing, 'phone', CRED)
    await pairing.approve(first)
    const second = pair(pairing, 'phone2', CRED)
    const seen: string[] = []
    pairing.onRevoke((id) => seen.push(id))
    await pairing.approve(second)
    expect(seen).toEqual([first])
    expect(pairing.accepts(`Bearer ${CRED}`)).toBe(true)
  })
})

describe('createDevicePairing: by id', () => {
  it('keeps the city, finds the device id by credential and revokes by id', async () => {
    const { pairing } = setup()
    const request = pairing.request(pairing.issueCode(), 'laptop', CRED, 'Oslo')
    if (!request.ok) throw new Error('request refused')
    expect(pairing.pending()).toMatchObject([{ id: request.id, name: 'laptop', city: 'Oslo' }])
    await pairing.approve(request.id)
    expect(pairing.deviceIdFor(`Bearer ${CRED}`)).toBe(request.id)
    expect(pairing.deviceIdFor('Bearer nothing')).toBeUndefined()
    const revoked: string[] = []
    pairing.onRevoke((id) => revoked.push(id))
    expect(await pairing.revokeDevice('other')).toBe(false)
    expect(await pairing.revokeDevice(request.id)).toBe(true)
    expect(revoked).toEqual([request.id])
    expect(pairing.accepts(`Bearer ${CRED}`)).toBe(false)
  })
})
