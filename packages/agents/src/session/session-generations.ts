/**
 * A persistent generation counter per conversation key: "new conversation under the same key,
 * keep the old transcript". `next(key)` never returns a value it returned before — the counter is
 * written atomically under a file lock, and a malformed file is refused rather than reset to zero.
 *
 * Cross-process uniqueness relies on the SDK file lock; without its lock dependency the lock is
 * in-process only.
 */
import { existsSync, readFileSync } from 'node:fs'
import { atomicWriteJson, withFileLock } from '@theokit/sdk/persistence'
import { ensureSecureDir } from '../hooks/secure-store.js'

export interface SessionGenerations {
  /** The current generation for `key`; 0 when none was started. */
  current(key: string): Promise<number>
  /** Advance and return the new generation for `key`. */
  next(key: string): Promise<number>
}

function readCounters(file: string): Record<string, number> {
  if (!existsSync(file)) return {}
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`session generations file is malformed: ${file}`)
  }
  const out: Record<string, number> = Object.create(null) as Record<string, number>
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
      throw new Error(`session generations file has an invalid counter for "${k}": ${file}`)
    }
    out[k] = v
  }
  return out
}

export function createSessionGenerations(file: string): SessionGenerations {
  return {
    async current(key) {
      return readCounters(file)[key] ?? 0
    },
    async next(key) {
      ensureSecureDir(file)
      return withFileLock(file, async () => {
        const counters = readCounters(file)
        const value = (counters[key] ?? 0) + 1
        if (!Number.isSafeInteger(value)) throw new Error(`generation overflow for "${key}"`)
        await atomicWriteJson(file, { ...counters, [key]: value })
        return value
      })
    },
  }
}
