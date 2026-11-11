import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Writable } from 'node:stream'

import { UsageError } from '../cli-args.js'
import { loadConfiguration } from '../config-file.js'

/**
 * Expiring visitor access to WebChat (OC-143). The owner grants an e-mail an expiry
 * (`theoclaw visitors grant <email> <duration|iso-date>`); a chat post whose trusted-proxy identity
 * (Cloudflare Access sets the e-mail header; see THEOCLAW_TRUSTED_PROXY_HEADER) is a live grant is
 * admitted, and one past its expiry, or never granted, is refused. Grants live in
 * `<THEOCLAW_STATE_DIR>/visitors.json` and are read on every post, so a grant or revoke applies
 * at once. While that file is absent, trusted-proxy identities are admitted as before.
 */

type Env = Readonly<Record<string, string | undefined>>

export interface VisitorsIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly stdout: Writable
  readonly stderr: Writable
  readonly now?: () => number
}

export function visitorsFile(env: Env): string | undefined {
  const state = env.THEOCLAW_STATE_DIR?.trim()
  return state === undefined || state === '' ? undefined : join(state, 'visitors.json')
}

function normalize(email: string): string {
  return email.trim().toLowerCase()
}

/** The grants (e-mail to expiry in epoch ms); `undefined` when the file is absent. An unreadable file grants nothing. */
export function readGrants(file: string): Map<string, number> | undefined {
  if (!existsSync(file)) return undefined
  const grants = new Map<string, number>()
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (typeof raw === 'object' && raw !== null) {
      for (const [email, expires] of Object.entries(raw)) {
        if (typeof expires === 'number' && Number.isFinite(expires)) grants.set(normalize(email), expires)
      }
    }
  } catch {
    // fail closed: nobody is granted
  }
  return grants
}

/** The per-post check: `undefined` while no grants file exists (visitor mode is off), else whether an identity holds a live grant. */
export function visitorGate(env: Env, now: () => number = Date.now): () => ((identity: string) => boolean) | undefined {
  const file = visitorsFile(env)
  return () => {
    const grants = file === undefined ? undefined : readGrants(file)
    if (grants === undefined) return undefined
    return (identity) => {
      const expires = grants.get(normalize(identity))
      return expires !== undefined && now() < expires
    }
  }
}

const UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 }

/** `30m`, `12h`, `7d` from now, or an absolute date; throws a UsageError otherwise. */
export function parseExpiry(value: string, now: number): number {
  const relative = /^(\d+)([mhd])$/.exec(value)
  const at = relative === null ? Date.parse(value) : now + Number(relative[1]) * (UNITS[relative[2] ?? 'm'] ?? 0)
  if (!Number.isFinite(at) || at <= now) throw new UsageError('theoclaw visitors: the expiry must be a future duration (30m, 12h, 7d) or date')
  return at
}

function save(file: string, grants: Map<string, number>): void {
  mkdirSync(dirname(file), { recursive: true })
  const staging = `${file}.tmp`
  writeFileSync(staging, `${JSON.stringify(Object.fromEntries(grants), null, 2)}\n`, { mode: 0o600 })
  renameSync(staging, file)
}

/** `theoclaw visitors grant <email> <expiry> | revoke <email> | list` */
export function visitorsCommand(args: readonly string[], io: VisitorsIo): number {
  const [action, email, expiry] = args
  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  const file = visitorsFile(env)
  if (file === undefined) throw new UsageError('theoclaw visitors: set THEOCLAW_STATE_DIR')
  const now = (io.now ?? Date.now)()
  const grants = readGrants(file) ?? new Map<string, number>()
  if (action === 'list') {
    for (const [who, expires] of grants) io.stdout.write(`${who}\t${new Date(expires).toISOString()}${expires > now ? '' : '\texpired'}\n`)
    return 0
  }
  if (action !== 'grant' && action !== 'revoke') throw new UsageError('theoclaw visitors: use grant <email> <expiry> | revoke <email> | list')
  if (email === undefined || !/^[^\s@]+@[^\s@]+$/.test(email)) throw new UsageError('theoclaw visitors: an e-mail address is required')
  if (action === 'revoke') {
    grants.delete(normalize(email))
    save(file, grants)
    io.stdout.write(`revoked ${normalize(email)}\n`)
    return 0
  }
  if (expiry === undefined) throw new UsageError('theoclaw visitors: grant needs an expiry (30m, 12h, 7d or a date)')
  const at = parseExpiry(expiry, now)
  grants.set(normalize(email), at)
  save(file, grants)
  io.stdout.write(`granted ${normalize(email)} until ${new Date(at).toISOString()}\n`)
  return 0
}
