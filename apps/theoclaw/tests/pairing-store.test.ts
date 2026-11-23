import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFilePairingStore } from '@theokit/gateway'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// TheoClaw keeps no pairing store of its own: this is the gateway's file store, with the behaviors
// the app relies on pinned. Known differences from the store it replaced: codes run 100000 to
// 999999 (no leading zeros), and a failed write is not logged with its path.

const HOUR_MS = 3_600_000

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theoclaw-pairing-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A clock the test moves by hand. */
function manualClock(start = 1_000_000) {
  let now = start
  return { clock: () => now, advance: (ms: number) => void (now += ms) }
}

describe('the gateway pairing store as TheoClaw uses it', () => {
  it('approves a code within 3600 seconds and refuses it after', async () => {
    const time = manualClock()
    const store = createFilePairingStore({ dir, clock: time.clock })
    const early = store.issue('telegram', '7')
    time.advance(HOUR_MS - 1_000)
    expect(await store.approve(early)).toEqual({ ok: true, platform: 'telegram', senderId: '7' })
    expect(store.isPaired('telegram', '7')).toBe(true)

    const late = store.issue('discord', '8')
    time.advance(HOUR_MS + 1_000)
    expect(await store.approve(late)).toEqual({ ok: false, reason: 'unknown_or_expired' })
    expect(store.isPaired('discord', '8')).toBe(false)
  })

  it('issues six digits, the same code to the same sender within the hour', () => {
    const store = createFilePairingStore({ dir })
    const code = store.issue('telegram', '7')
    expect(code).toMatch(/^[1-9]\d{5}$/)
    expect(store.issue('telegram', '7')).toBe(code)
  })

  it('persists paired senders across a reload, in a file at mode 0600', async () => {
    const store = createFilePairingStore({ dir })
    await store.approve(store.issue('slack', 'U1'))
    const reloaded = createFilePairingStore({ dir })
    expect(reloaded.isPaired('slack', 'U1')).toBe(true)
    expect(reloaded.isPaired('slack', 'U2')).toBe(false)
    expect(statSync(join(dir, 'pairing.json')).mode & 0o777).toBe(0o600)
  })

  it('refuses to start on an unreadable pairing.json and leaves it alone', () => {
    const path = join(dir, 'pairing.json')
    writeFileSync(path, '{')
    expect(() => createFilePairingStore({ dir })).toThrow('pairing_store_unreadable')
    writeFileSync(path, '{"paired":[1]}')
    expect(() => createFilePairingStore({ dir })).toThrow('pairing_store_unreadable')
    expect(readFileSync(path, 'utf8')).toBe('{"paired":[1]}')
  })

  it('keeps all 20 of 20 concurrent approvals', async () => {
    const store = createFilePairingStore({ dir })
    const codes = Array.from({ length: 20 }, (_, n) => store.issue('telegram', `sender-${n}`))
    const results = await Promise.all(codes.map((code) => store.approve(code)))
    expect(results.every((result) => result.ok)).toBe(true)
    const reloaded = createFilePairingStore({ dir })
    expect(codes.every((_, n) => reloaded.isPaired('telegram', `sender-${n}`))).toBe(true)
  })

  it('a failed write pairs nobody and keeps the code for a retry', async () => {
    const store = createFilePairingStore({ dir })
    const code = store.issue('telegram', '9')
    // A file where the directory was: the write fails with ENOTDIR whoever runs the test.
    rmSync(dir, { recursive: true })
    writeFileSync(dir, '')
    expect(await store.approve(code)).toEqual({ ok: false, reason: 'write_failed' })
    expect(store.isPaired('telegram', '9')).toBe(false)
    rmSync(dir)
    mkdirSync(dir)
    expect(await store.approve(code)).toEqual({ ok: true, platform: 'telegram', senderId: '9' })
    expect(store.isPaired('telegram', '9')).toBe(true)
  })
})
