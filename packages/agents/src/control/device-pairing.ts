import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { atomicWriteJson } from '@theokit/sdk/persistence'

/**
 * Device pairing for a control surface: the owner issues a short-lived setup code, a device redeems
 * it with a name and a credential of its own choosing, and the owner approves or denies the
 * request. Approved credentials are stored as SHA-256 digests only, never as the credential itself.
 */

const FILE_NAME = 'devices.json'
const FILE_MODE = 0o600
const MAX_NAME_LENGTH = 64
const MIN_DISTINCT_CREDENTIAL_CHARS = 10
const BEARER = /^bearer (.+)$/i

export type PairingRequestResult =
  | { readonly ok: true; readonly id: string }
  | {
      readonly ok: false
      readonly reason: 'unknown_or_expired' | 'bad_credential' | 'bad_name' | 'too_many_pending'
    }

export type PairingApproval =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: 'unknown_request' | 'write_failed' }

export interface DevicePairing {
  /** A one-time setup code, valid for `codeTtlMs`. */
  issueCode(): string
  /** Redeem `code` for a pending request carrying the device's own `credential`; the code is spent. */
  request(code: string, name: string, credential: string): PairingRequestResult
  pending(): readonly { id: string; name: string; since: number }[]
  /** Approve a pending request; the credential is accepted from here on and survives a restart. */
  approve(id: string): Promise<PairingApproval>
  /** Drop a pending request. `false` when there is none with that id. */
  deny(id: string): boolean
  /** Remove every approved device named `name`. `false` when none matched or the write failed. */
  revoke(name: string): Promise<boolean>
  /** True for an `Authorization: Bearer ...` header carrying an approved device's credential. */
  accepts(authorization: string | undefined): boolean
  /** Called with the id of each device removed by `revoke`, after the store is written. */
  onRevoke(listener: (id: string) => void): () => void
}

export interface DevicePairingOptions {
  /** Directory holding `devices.json` (mode 0600). */
  dir: string
  /** How long a setup code and a pending request live. Default 600000 (10 minutes). */
  codeTtlMs?: number
  /** At most this many requests wait for the owner. Default 20. */
  maxPending?: number
  /** Shortest accepted credential. Default 32. */
  minCredentialLength?: number
  now?: () => number
}

interface Device {
  readonly id: string
  readonly name: string
  readonly digest: string
}

interface Waiting extends Device {
  readonly since: number
}

const digestOf = (credential: string): string =>
  createHash('sha256').update(credential).digest('hex')

function load(path: string): Device[] {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error(`${path} cannot be read: ${(error as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`${path} is not valid JSON (${(error as Error).message}); fix or remove it`)
  }
  const devices = (parsed as { devices?: unknown } | null)?.devices
  if (
    !Array.isArray(devices) ||
    !devices.every(
      (entry: Device | null) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.id === 'string' &&
        typeof entry.name === 'string' &&
        typeof entry.digest === 'string' &&
        /^[0-9a-f]{64}$/.test(entry.digest),
    )
  ) {
    throw new Error(`${path} is not a devices file ({ "devices": [...] }); fix or remove it`)
  }
  return devices as Device[]
}

export function createDevicePairing(options: DevicePairingOptions): DevicePairing {
  const path = join(options.dir, FILE_NAME)
  const ttl = options.codeTtlMs ?? 600_000
  const maxPending = options.maxPending ?? 20
  const minLength = options.minCredentialLength ?? 32
  const now = options.now ?? Date.now
  mkdirSync(options.dir, { recursive: true, mode: 0o700 })
  let approved = load(path)
  const codes = new Map<string, number>()
  const waiting = new Map<string, Waiting>()
  const listeners = new Set<(id: string) => void>()
  // One chain for every write, so two writes never interleave their read-modify-write.
  let writes: Promise<unknown> = Promise.resolve()

  const dropExpired = (): void => {
    const t = now()
    for (const [code, issuedAt] of codes) if (t - issuedAt >= ttl) codes.delete(code)
    for (const [id, entry] of waiting) if (t - entry.since >= ttl) waiting.delete(id)
  }
  const save = async (next: readonly Device[]): Promise<boolean> => {
    try {
      await atomicWriteJson(path, { devices: next }, { mode: FILE_MODE })
      return true
    } catch {
      return false
    }
  }
  const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const result = writes.then(task)
    writes = result.catch(() => undefined)
    return result
  }

  return {
    issueCode() {
      dropExpired()
      const code = randomBytes(6).toString('hex')
      codes.set(code, now())
      return code
    },
    request(code, name, credential) {
      dropExpired()
      if (!codes.has(code)) return { ok: false, reason: 'unknown_or_expired' }
      const trimmed = name.trim()
      if (trimmed === '' || trimmed.length > MAX_NAME_LENGTH)
        return { ok: false, reason: 'bad_name' }
      if (
        credential.length < minLength ||
        credential.trim() !== credential ||
        new Set(credential).size < MIN_DISTINCT_CREDENTIAL_CHARS
      ) {
        return { ok: false, reason: 'bad_credential' }
      }
      if (waiting.size >= maxPending) return { ok: false, reason: 'too_many_pending' }
      codes.delete(code)
      const id = randomBytes(8).toString('hex')
      waiting.set(id, { id, name: trimmed, digest: digestOf(credential), since: now() })
      return { ok: true, id }
    },
    pending() {
      dropExpired()
      return [...waiting.values()].map(({ id, name, since }) => ({ id, name, since }))
    },
    approve(id) {
      return serialized(async () => {
        dropExpired()
        const device = waiting.get(id)
        if (device === undefined) return { ok: false, reason: 'unknown_request' } as const
        const entry: Device = { id: device.id, name: device.name, digest: device.digest }
        // Approved only once the file holds it, so a device is never approved in memory alone.
        const next = [...approved.filter((d) => d.digest !== entry.digest), entry]
        if (!(await save(next))) return { ok: false, reason: 'write_failed' } as const
        approved = next
        waiting.delete(id)
        return { ok: true, name: entry.name } as const
      })
    },
    deny(id) {
      dropExpired()
      return waiting.delete(id)
    },
    revoke(name) {
      return serialized(async () => {
        const removed = approved.filter((d) => d.name === name)
        if (removed.length === 0) return false
        const next = approved.filter((d) => d.name !== name)
        if (!(await save(next))) return false
        approved = next
        for (const device of removed) for (const listener of [...listeners]) listener(device.id)
        return true
      })
    },
    accepts(authorization) {
      const presented = BEARER.exec(authorization ?? '')?.[1]
      if (presented === undefined) return false
      const wanted = Buffer.from(digestOf(presented), 'hex')
      // Every entry is compared, so the time does not say which device matched.
      return approved.reduce(
        (hit, entry) => timingSafeEqual(Buffer.from(entry.digest, 'hex'), wanted) || hit,
        false,
      )
    },
    onRevoke(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
