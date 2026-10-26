import { randomInt } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { open, rename } from 'node:fs/promises'
import { join } from 'node:path'

import { describeError, TheoClawConfigError } from '../control-plane/errors.js'
import { senderKey } from './policy.js'

/** A pairing code is valid for one hour after it is issued (OC-19, NFR-001). */
const CODE_TTL_MS = 3_600_000
const CODE_SPACE = 1_000_000
const FILE_NAME = 'pairing.json'

export type ApprovalResult =
  | { readonly ok: true; readonly platform: string; readonly senderId: string }
  | { readonly ok: false; readonly reason: 'unknown_or_expired' | 'write_failed' }

/** The senders an owner paired, and the codes waiting for an owner's `/approve` (FR-006). */
export interface PairingStore {
  /** A 6-digit code for this sender; the same code while one is pending for them. */
  issue(platform: string, senderId: string): string
  approve(code: string): Promise<ApprovalResult>
  isPaired(platform: string, senderId: string): boolean
}

export interface PairingStoreOptions {
  /** `THEOCLAW_STATE_DIR`; `pairing.json` lives here. */
  readonly dir: string
  readonly clock?: () => number
  /** A uniform integer in `[min, max)`. Default `crypto.randomInt`. */
  readonly random?: (min: number, max: number) => number
  /** Where a failed write is reported. Default: standard error. A line never carries a code. */
  readonly write?: (line: string) => void
}

interface PendingCode {
  readonly platform: string
  readonly senderId: string
  readonly issuedAt: number
}

function isPairingFile(value: unknown): value is { paired: string[] } {
  if (typeof value !== 'object' || value === null) return false
  const paired = (value as { paired?: unknown }).paired
  return Array.isArray(paired) && paired.every((entry) => typeof entry === 'string')
}

/** The paired keys on disk. Only a missing file is an empty store; anything unreadable stops the start. */
function loadPaired(path: string): Set<string> {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set()
    throw new TheoClawConfigError(`${path} cannot be read: ${describeError(error)}`, { variable: 'THEOCLAW_STATE_DIR' })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new TheoClawConfigError(`${path} is not valid JSON (${describeError(error)}); fix or remove it`, {
      variable: 'THEOCLAW_STATE_DIR',
    })
  }
  if (!isPairingFile(parsed)) {
    throw new TheoClawConfigError(`${path} is not a pairing file ({ "paired": [...] }); fix or remove it`, {
      variable: 'THEOCLAW_STATE_DIR',
    })
  }
  return new Set(parsed.paired)
}

/** Write through a temporary file opened at 0600, then rename over the real one. */
async function persist(path: string, paired: readonly string[]): Promise<void> {
  const temporary = `${path}.tmp`
  const handle = await open(temporary, 'w', 0o600)
  try {
    // The mode of `open` applies only on create; a leftover temporary file keeps its own.
    await handle.chmod(0o600)
    await handle.writeFile(`${JSON.stringify({ paired }, null, 2)}\n`)
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
}

/**
 * Load the pairings of `dir` synchronously, so the composition stays synchronous. Pending codes
 * live in memory only: a restart forgets unapproved codes, which only means asking again.
 */
export function createPairingStore(options: PairingStoreOptions): PairingStore {
  const path = join(options.dir, FILE_NAME)
  const clock = options.clock ?? Date.now
  const random = options.random ?? randomInt
  const write = options.write ?? ((line: string) => void process.stderr.write(`${line}\n`))
  // Created at start, so a missing directory is not discovered at the first approval.
  mkdirSync(options.dir, { recursive: true, mode: 0o700 })
  const paired = loadPaired(path)
  const pending = new Map<string, PendingCode>()
  // One chain for every write, so two approvals never interleave their read-modify-write (NFR-006).
  let writes: Promise<unknown> = Promise.resolve()

  const isLive = (entry: PendingCode): boolean => clock() - entry.issuedAt < CODE_TTL_MS
  const dropStale = (): void => {
    for (const [code, entry] of pending) if (!isLive(entry)) pending.delete(code)
  }

  const save = async (entry: PendingCode): Promise<ApprovalResult> => {
    const key = senderKey(entry.platform, entry.senderId)
    try {
      await persist(path, [...new Set([...paired, key])])
    } catch (error) {
      write(`pairing: ${path} could not be saved: ${describeError(error)}`)
      return { ok: false, reason: 'write_failed' }
    }
    // Paired only once the file holds it, so a sender is never paired in memory alone (EC-3).
    paired.add(key)
    return { ok: true, platform: entry.platform, senderId: entry.senderId }
  }

  return {
    issue(platform, senderId) {
      dropStale()
      for (const [code, entry] of pending) {
        if (entry.platform === platform && entry.senderId === senderId) return code
      }
      let code: string
      do {
        code = String(random(0, CODE_SPACE)).padStart(6, '0')
      } while (pending.has(code)) // No two pending senders share a code (EC-2).
      pending.set(code, { platform, senderId, issuedAt: clock() })
      return code
    },
    approve(code) {
      const entry = pending.get(code)
      if (entry === undefined || !isLive(entry)) {
        pending.delete(code)
        return Promise.resolve({ ok: false, reason: 'unknown_or_expired' })
      }
      pending.delete(code)
      const result = writes.then(() => save(entry))
      // A rejection (a throwing log sink) must not stop every later approval from running.
      writes = result.catch(() => undefined)
      return result
    },
    isPaired(platform, senderId) {
      return paired.has(senderKey(platform, senderId))
    },
  }
}
