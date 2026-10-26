import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPairingStore } from '../src/authorization/pairing-store.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'

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

/** A random source returning `values` in turn, then repeating the last. */
function scriptedRandom(values: readonly number[]) {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)] ?? 0
}

describe('createPairingStore', () => {
  it('approves a code within 3600 seconds and refuses it after', async () => {
    const time = manualClock()
    const store = createPairingStore({ dir, clock: time.clock })
    const early = store.issue('telegram', '7')
    time.advance(HOUR_MS - 1_000)
    expect(await store.approve(early)).toEqual({ ok: true, platform: 'telegram', senderId: '7' })
    expect(store.isPaired('telegram', '7')).toBe(true)

    const late = store.issue('discord', '8')
    time.advance(HOUR_MS + 1_000)
    expect(await store.approve(late)).toEqual({ ok: false, reason: 'unknown_or_expired' })
    expect(store.isPaired('discord', '8')).toBe(false)
  })

  it('refuses a code at exactly 3600 seconds', async () => {
    const time = manualClock()
    const store = createPairingStore({ dir, clock: time.clock })
    const code = store.issue('telegram', '7')
    time.advance(HOUR_MS)
    expect(await store.approve(code)).toEqual({ ok: false, reason: 'unknown_or_expired' })
  })

  it('issues six digits and the same code to the same sender within the hour', () => {
    const store = createPairingStore({ dir, random: scriptedRandom([42, 99]) })
    const code = store.issue('telegram', '7')
    expect(code).toBe('000042')
    expect(store.issue('telegram', '7')).toBe(code)
  })

  it('persists paired senders across a reload', async () => {
    const store = createPairingStore({ dir })
    await store.approve(store.issue('slack', 'U1'))
    const reloaded = createPairingStore({ dir })
    expect(reloaded.isPaired('slack', 'U1')).toBe(true)
    expect(reloaded.isPaired('slack', 'U2')).toBe(false)
  })

  it('creates pairing.json with mode 0600', async () => {
    const store = createPairingStore({ dir })
    await store.approve(store.issue('slack', 'U1'))
    expect(statSync(join(dir, 'pairing.json')).mode & 0o777).toBe(0o600)
  })

  it('creates a missing state directory at mode 0700', async () => {
    const nested = join(dir, 'state')
    const store = createPairingStore({ dir: nested })
    expect(statSync(nested).mode & 0o777).toBe(0o700)
    expect(await store.approve(store.issue('slack', 'U1'))).toMatchObject({ ok: true })
  })

  it('refuses to start on a corrupt pairing.json and names the path', () => {
    const path = join(dir, 'pairing.json')
    writeFileSync(path, '{')
    expect(() => createPairingStore({ dir })).toThrow(TheoClawConfigError)
    expect(() => createPairingStore({ dir })).toThrow(path)
    expect(readFileSync(path, 'utf8')).toBe('{')
  })

  it('refuses to start on a pairing.json without a paired list', () => {
    const path = join(dir, 'pairing.json')
    writeFileSync(path, '{"paired":[1]}')
    expect(() => createPairingStore({ dir })).toThrow(path)
  })

  it('keeps an existing temporary file at mode 0600', async () => {
    writeFileSync(join(dir, 'pairing.json.tmp'), 'stale', { mode: 0o644 })
    const store = createPairingStore({ dir })
    await store.approve(store.issue('slack', 'U1'))
    expect(statSync(join(dir, 'pairing.json')).mode & 0o777).toBe(0o600)
  })

  it('keeps all 20 of 20 concurrent approvals', async () => {
    const store = createPairingStore({ dir })
    const codes = Array.from({ length: 20 }, (_, n) => store.issue('telegram', `sender-${n}`))
    const results = await Promise.all(codes.map((code) => store.approve(code)))
    expect(results.every((result) => result.ok)).toBe(true)
    const saved = JSON.parse(readFileSync(join(dir, 'pairing.json'), 'utf8')) as { paired: string[] }
    expect(new Set(saved.paired).size).toBe(20)
    const reloaded = createPairingStore({ dir })
    expect(codes.every((_, n) => reloaded.isPaired('telegram', `sender-${n}`))).toBe(true)
  })

  it('never writes a pairing code to stdout or stderr', async () => {
    const written: string[] = []
    const keep = (chunk: unknown): boolean => {
      written.push(String(chunk))
      return true
    }
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(keep)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(keep)
    const consoles = (['error', 'warn', 'log', 'info'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void written.push(args.join(' '))),
    )
    try {
      const time = manualClock()
      const store = createPairingStore({ dir, clock: time.clock })
      const approved = store.issue('telegram', '1')
      const expired = store.issue('telegram', '2')
      await store.approve(approved)
      time.advance(HOUR_MS + 1)
      await store.approve(expired)
      expect(written.join('')).not.toContain(approved)
      expect(written.join('')).not.toContain(expired)
    } finally {
      stdout.mockRestore()
      stderr.mockRestore()
      for (const spy of consoles) spy.mockRestore()
    }
  })

  it('draws again when a code is already pending for another sender', () => {
    const store = createPairingStore({ dir, random: scriptedRandom([111111, 111111, 222222]) })
    expect(store.issue('telegram', 'a')).toBe('111111')
    expect(store.issue('telegram', 'b')).toBe('222222')
  })

  it('a failed write pairs nobody', async () => {
    const lines: string[] = []
    const store = createPairingStore({ dir, write: (line) => void lines.push(line) })
    const code = store.issue('telegram', '9')
    // A file where the directory was: the write fails with ENOTDIR whoever runs the test.
    rmSync(dir, { recursive: true })
    writeFileSync(dir, '')
    expect(await store.approve(code)).toEqual({ ok: false, reason: 'write_failed' })
    expect(store.isPaired('telegram', '9')).toBe(false)
    expect(lines.join('\n')).toContain(join(dir, 'pairing.json'))
    expect(lines.join('\n')).not.toContain(code)
  })

  it('approves again after a failed write', async () => {
    const store = createPairingStore({ dir, write: () => undefined })
    const failing = store.issue('telegram', '9')
    rmSync(dir, { recursive: true })
    writeFileSync(dir, '')
    await store.approve(failing)
    rmSync(dir)
    mkdirSync(dir)
    expect(await store.approve(store.issue('telegram', '10'))).toMatchObject({ ok: true })
  })

  it('drops pending codes older than 3600 seconds on the next issue', async () => {
    const time = manualClock()
    const store = createPairingStore({ dir, clock: time.clock, random: scriptedRandom([5, 5, 6]) })
    const stale = store.issue('telegram', 'a')
    time.advance(HOUR_MS + 1)
    // The stale code no longer blocks its digits: the next sender may draw them.
    expect(store.issue('telegram', 'b')).toBe(stale)
    expect(await store.approve(stale)).toEqual({ ok: true, platform: 'telegram', senderId: 'b' })
  })
})
