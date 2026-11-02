import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDevicePairing } from '../src/control-plane/device-pairing.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'

const DEVICE_TOKEN = 'device-token-that-is-long-enough-0001'
const OTHER_TOKEN = 'device-token-that-is-long-enough-0002'
const dirs: string[] = []

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-devices-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const bearer = (token: string): string => `Bearer ${token}`

describe('device pairing', () => {
  it('a device is accepted only after the owner approves it with a live code', async () => {
    const dir = stateDir()
    const pairing = createDevicePairing({ dir })
    expect(pairing.accepts(bearer(DEVICE_TOKEN))).toBe(false)

    const code = pairing.issueSetupCode()
    const requested = pairing.request(code, 'laptop', DEVICE_TOKEN)
    if (!requested.ok) throw new Error(`request refused: ${requested.reason}`)
    // Asking is not approval: the token is still refused.
    expect(pairing.accepts(bearer(DEVICE_TOKEN))).toBe(false)
    expect(pairing.pending().map((entry) => entry.name)).toEqual(['laptop'])

    expect(await pairing.approve(requested.id)).toEqual({ ok: true, name: 'laptop' })
    expect(pairing.accepts(bearer(DEVICE_TOKEN))).toBe(true)
    expect(pairing.accepts(bearer(OTHER_TOKEN))).toBe(false)
    expect(pairing.accepts(undefined)).toBe(false)

    // Approved devices survive a restart, and the file holds the digest, never the token.
    expect(createDevicePairing({ dir }).accepts(bearer(DEVICE_TOKEN))).toBe(true)
    expect(readFileSync(join(dir, 'devices.json'), 'utf8')).not.toContain(DEVICE_TOKEN)
  })

  it('a setup code works once', () => {
    const pairing = createDevicePairing({ dir: stateDir() })
    const code = pairing.issueSetupCode()
    expect(pairing.request(code, 'one', DEVICE_TOKEN).ok).toBe(true)
    expect(pairing.request(code, 'two', OTHER_TOKEN)).toEqual({ ok: false, reason: 'unknown_or_expired' })
  })

  it('a setup code expires after ten minutes', () => {
    let now = 1_000
    const pairing = createDevicePairing({ dir: stateDir(), clock: () => now })
    const code = pairing.issueSetupCode()
    now += 10 * 60_000
    expect(pairing.request(code, 'late', DEVICE_TOKEN)).toEqual({ ok: false, reason: 'unknown_or_expired' })
  })

  it('refuses a short token and an unnamed device without spending the code', () => {
    const pairing = createDevicePairing({ dir: stateDir() })
    const code = pairing.issueSetupCode()
    expect(pairing.request(code, 'laptop', 'short')).toEqual({ ok: false, reason: 'bad_token' })
    expect(pairing.request(code, '  ', DEVICE_TOKEN)).toEqual({ ok: false, reason: 'bad_name' })
    expect(pairing.request(code, 'laptop', DEVICE_TOKEN).ok).toBe(true)
  })

  it('approving an unknown request id changes nothing', async () => {
    const pairing = createDevicePairing({ dir: stateDir() })
    expect(await pairing.approve('nope')).toEqual({ ok: false, reason: 'unknown_request' })
  })

  it('revoking a device ends its access', async () => {
    const pairing = createDevicePairing({ dir: stateDir() })
    const requested = pairing.request(pairing.issueSetupCode(), 'laptop', DEVICE_TOKEN)
    if (!requested.ok) throw new Error('request refused')
    await pairing.approve(requested.id)
    expect(await pairing.revoke(requested.id)).toBe(true)
    expect(pairing.accepts(bearer(DEVICE_TOKEN))).toBe(false)
  })
  it('refuses a device name over 64 characters', () => {
    const pairing = createDevicePairing({ dir: stateDir() })
    expect(pairing.request(pairing.issueSetupCode(), 'n'.repeat(65), DEVICE_TOKEN)).toEqual({ ok: false, reason: 'bad_name' })
  })

  it('refuses a token padded with whitespace', () => {
    const pairing = createDevicePairing({ dir: stateDir() })
    expect(pairing.request(pairing.issueSetupCode(), 'laptop', `${DEVICE_TOKEN} `)).toEqual({ ok: false, reason: 'bad_token' })
  })

  it('refuses a low-entropy token such as one repeated character', () => {
    const pairing = createDevicePairing({ dir: stateDir() })
    expect(pairing.request(pairing.issueSetupCode(), 'laptop', 'a'.repeat(40))).toEqual({ ok: false, reason: 'bad_token' })
  })

  it('writes devices.json readable by its owner only', async () => {
    const dir = stateDir()
    const pairing = createDevicePairing({ dir })
    const requested = pairing.request(pairing.issueSetupCode(), 'laptop', DEVICE_TOKEN)
    if (!requested.ok) throw new Error('request refused')
    await pairing.approve(requested.id)
    expect(statSync(join(dir, 'devices.json')).mode & 0o777).toBe(0o600)
  })

  it('does not approve in memory when the file cannot be written', async () => {
    const dir = stateDir()
    const lines: string[] = []
    const pairing = createDevicePairing({ dir, write: (line) => lines.push(line) })
    mkdirSync(join(dir, 'devices.json.tmp'))
    const requested = pairing.request(pairing.issueSetupCode(), 'laptop', DEVICE_TOKEN)
    if (!requested.ok) throw new Error('request refused')
    expect(await pairing.approve(requested.id)).toEqual({ ok: false, reason: 'write_failed' })
    expect(pairing.accepts(bearer(DEVICE_TOKEN))).toBe(false)
    expect(pairing.pending().map((entry) => entry.id)).toEqual([requested.id])
    expect(lines.join('\n')).toContain('could not be saved')
  })

  it('stops the start on a devices file that is not valid JSON', () => {
    const dir = stateDir()
    writeFileSync(join(dir, 'devices.json'), '{ nope')
    expect(() => createDevicePairing({ dir })).toThrow(TheoClawConfigError)
    expect(() => createDevicePairing({ dir })).toThrow(/is not valid JSON/)
  })

  it('stops the start on a devices file of the wrong shape', () => {
    const dir = stateDir()
    writeFileSync(join(dir, 'devices.json'), JSON.stringify({ devices: [{ id: 1 }] }))
    expect(() => createDevicePairing({ dir })).toThrow(/is not a devices file/)
  })

  it('stops the start when the devices file cannot be read', () => {
    const dir = stateDir()
    mkdirSync(join(dir, 'devices.json'))
    expect(() => createDevicePairing({ dir })).toThrow(/cannot be read/)
  })

  it('keeps both devices when two are approved at once', async () => {
    const dir = stateDir()
    const pairing = createDevicePairing({ dir })
    const first = pairing.request(pairing.issueSetupCode(), 'one', DEVICE_TOKEN)
    const second = pairing.request(pairing.issueSetupCode(), 'two', OTHER_TOKEN)
    if (!first.ok || !second.ok) throw new Error('request refused')
    await Promise.all([pairing.approve(first.id), pairing.approve(second.id)])
    const restarted = createDevicePairing({ dir })
    expect(restarted.accepts(bearer(DEVICE_TOKEN))).toBe(true)
    expect(restarted.accepts(bearer(OTHER_TOKEN))).toBe(true)
  })

  it('names the approved device a presented token belongs to', async () => {
    const pairing = createDevicePairing({ dir: stateDir() })
    const requested = pairing.request(pairing.issueSetupCode(), 'laptop', DEVICE_TOKEN)
    if (!requested.ok) throw new Error('request refused')
    expect(pairing.deviceIdFor(bearer(DEVICE_TOKEN))).toBeUndefined()
    await pairing.approve(requested.id)
    expect(pairing.deviceIdFor(bearer(DEVICE_TOKEN))).toBe(requested.id)
    expect(pairing.deviceIdFor(bearer(OTHER_TOKEN))).toBeUndefined()
  })

  it('expires and caps the requests waiting for approval', () => {
    let now = 1_000
    const pairing = createDevicePairing({ dir: stateDir(), clock: () => now })
    const code = pairing.issueSetupCode()
    pairing.request(code, 'old', DEVICE_TOKEN)
    now += 10 * 60_000
    expect(pairing.pending()).toEqual([])
    for (let index = 0; index < 20; index += 1) {
      pairing.request(pairing.issueSetupCode(), `d${index}`, `device-token-that-is-long-enough-${String(index).padStart(4, '0')}`)
    }
    expect(pairing.request(pairing.issueSetupCode(), 'extra', OTHER_TOKEN)).toEqual({ ok: false, reason: 'too_many_pending' })
  })
})
