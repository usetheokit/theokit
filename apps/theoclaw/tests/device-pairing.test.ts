import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDevicePairing } from '../src/control-plane/device-pairing.js'

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
})
