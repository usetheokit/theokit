import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { open, rename } from 'node:fs/promises'
import { join } from 'node:path'

import { MIN_BEARER_TOKEN_LENGTH } from './bearer.js'
import { describeError, TheoClawConfigError } from './errors.js'

/**
 * Device pairing for the `/control` socket (OC-91): a setup code the owner issues, a device that
 * redeems it with a token of its own, and the owner's approval of that device as a node. Only an
 * approved device's token opens the socket, beside the owner's bearer token.
 */

/** A setup code is valid for ten minutes after it is issued, and for one request. */
const CODE_TTL_MS = 600_000
const FILE_NAME = 'devices.json'
const MAX_NAME_LENGTH = 64

export type PairingRequest =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: 'unknown_or_expired' | 'bad_token' | 'bad_name' }

export type DeviceApproval =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: 'unknown_request' | 'write_failed' }

export interface PendingDevice {
  readonly id: string
  readonly name: string
}

export interface DevicePairing {
  /** A one-time setup code, valid for ten minutes. */
  issueSetupCode(): string
  /** Redeem `code` for a pairing request carrying the device's own `token`; the code is spent. */
  request(code: string, name: string, token: string): PairingRequest
  pending(): readonly PendingDevice[]
  /** Approve a pending request: its token is accepted from here on and survives a restart. */
  approve(id: string): Promise<DeviceApproval>
  /** End an approved device's access. `false` when no such device is approved. */
  revoke(id: string): Promise<boolean>
  /** True for an `Authorization` header carrying an approved device's token. */
  accepts(authorization: string | undefined): boolean
}

export interface DevicePairingOptions {
  /** `THEOCLAW_STATE_DIR`; `devices.json` lives here, mode 0600. */
  readonly dir: string
  readonly clock?: () => number
  readonly write?: (line: string) => void
}

interface Device {
  readonly id: string
  readonly name: string
  /** SHA-256 of the token, hex. The token itself is never stored. */
  readonly digest: string
}

const BEARER = /^bearer (.+)$/i

const digestOf = (token: string): string => createHash('sha256').update(token).digest('hex')

function isDevices(value: unknown): value is { devices: Device[] } {
  if (typeof value !== 'object' || value === null) return false
  const devices = (value as { devices?: unknown }).devices
  return (
    Array.isArray(devices) &&
    devices.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Device).id === 'string' &&
        typeof (entry as Device).name === 'string' &&
        /^[0-9a-f]{64}$/.test((entry as Device).digest),
    )
  )
}

/** The approved devices on disk. Only a missing file is an empty list; anything else stops the start. */
function load(path: string): Device[] {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
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
  if (!isDevices(parsed)) {
    throw new TheoClawConfigError(`${path} is not a devices file ({ "devices": [...] }); fix or remove it`, {
      variable: 'THEOCLAW_STATE_DIR',
    })
  }
  return parsed.devices
}

async function persist(path: string, devices: readonly Device[]): Promise<void> {
  const temporary = `${path}.tmp`
  const handle = await open(temporary, 'w', 0o600)
  try {
    await handle.chmod(0o600)
    await handle.writeFile(`${JSON.stringify({ devices }, null, 2)}\n`)
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
}

export function createDevicePairing(options: DevicePairingOptions): DevicePairing {
  const path = join(options.dir, FILE_NAME)
  const clock = options.clock ?? Date.now
  const write = options.write ?? ((line: string) => void process.stderr.write(`${line}\n`))
  mkdirSync(options.dir, { recursive: true, mode: 0o700 })
  let approved = load(path)
  const codes = new Map<string, number>()
  const waiting = new Map<string, Device>()
  // One chain for every write, so two approvals never interleave their read-modify-write.
  let writes: Promise<unknown> = Promise.resolve()

  const save = async (next: readonly Device[]): Promise<boolean> => {
    try {
      await persist(path, next)
      return true
    } catch (error) {
      write(`pairing: ${path} could not be saved: ${describeError(error)}`)
      return false
    }
  }
  const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const result = writes.then(task)
    writes = result.catch(() => undefined)
    return result
  }

  return {
    issueSetupCode() {
      for (const [code, issuedAt] of codes) if (clock() - issuedAt >= CODE_TTL_MS) codes.delete(code)
      const code = randomBytes(6).toString('hex')
      codes.set(code, clock())
      return code
    },
    request(code, name, token) {
      const issuedAt = codes.get(code)
      if (issuedAt === undefined || clock() - issuedAt >= CODE_TTL_MS) {
        codes.delete(code)
        return { ok: false, reason: 'unknown_or_expired' }
      }
      const trimmed = name.trim()
      if (trimmed === '' || trimmed.length > MAX_NAME_LENGTH) return { ok: false, reason: 'bad_name' }
      if (token.length < MIN_BEARER_TOKEN_LENGTH || token.trim() !== token) return { ok: false, reason: 'bad_token' }
      codes.delete(code)
      const id = randomBytes(8).toString('hex')
      waiting.set(id, { id, name: trimmed, digest: digestOf(token) })
      return { ok: true, id }
    },
    pending: () => [...waiting.values()].map(({ id, name }) => ({ id, name })),
    approve(id) {
      return serialized(async () => {
        const device = waiting.get(id)
        if (device === undefined) return { ok: false, reason: 'unknown_request' } as const
        // Approved only once the file holds it, so a device is never approved in memory alone.
        const next = [...approved.filter((entry) => entry.digest !== device.digest), device]
        if (!(await save(next))) return { ok: false, reason: 'write_failed' } as const
        approved = next
        waiting.delete(id)
        return { ok: true, name: device.name } as const
      })
    },
    revoke(id) {
      return serialized(async () => {
        const next = approved.filter((entry) => entry.id !== id)
        if (next.length === approved.length) return false
        if (!(await save(next))) return false
        approved = next
        return true
      })
    },
    accepts(authorization) {
      const presented = BEARER.exec(authorization ?? '')?.[1]
      if (presented === undefined) return false
      const wanted = Buffer.from(digestOf(presented), 'hex')
      // Every entry is compared, so the time does not say which device matched.
      return approved.reduce((hit, entry) => timingSafeEqual(Buffer.from(entry.digest, 'hex'), wanted) || hit, false)
    },
  }
}
