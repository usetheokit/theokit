import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Writable } from 'node:stream'

import { UsageError } from '../cli-args.js'

/**
 * Expiring visitor grants for WebChat (OC-143). A reverse proxy such as Cloudflare Access
 * authenticates the visitor's e-mail and passes it in the trusted-proxy identity header; with
 * `THEOCLAW_VISITOR_ACCESS=on`, that e-mail must also hold an unexpired grant in `visitors.json`
 * under the state directory, which `theoclaw visitors grant|revoke|list` manages. The file is read
 * on every chat post, so a grant or an expiry takes effect without a restart.
 */
export type VisitorGrants = Readonly<Record<string, number>>

type Env = Readonly<Record<string, string | undefined>>

export function visitorsPath(env: Env, home: string = homedir()): string {
  const base = (env.THEOCLAW_STATE_DIR ?? '').trim() || join(home, '.theoclaw')
  return join(base, 'visitors.json')
}

export function visitorAccessOn(env: Env): boolean {
  return (env.THEOCLAW_VISITOR_ACCESS ?? '').trim().toLowerCase() === 'on'
}

export function readGrants(file: string): VisitorGrants {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
    )
  } catch {
    return {}
  }
}

function writeGrants(file: string, grants: VisitorGrants): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, `${JSON.stringify(grants, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, file)
}

const normalize = (email: string): string => email.trim().toLowerCase()

/** True while the e-mail holds a grant that has not expired. */
export function isGranted(file: string, email: string, now: number = Date.now()): boolean {
  const until = readGrants(file)[normalize(email)]
  return until !== undefined && until > now
}

const UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 }

/** `30m`, `12h` or `7d` in milliseconds. */
export function parseDuration(text: string): number {
  const match = /^(\d{1,6})([mhd])$/.exec(text.trim())
  const unit = match?.[2]
  if (match === null || unit === undefined || Number(match[1]) === 0)
    throw new UsageError('theoclaw visitors: --for expects a duration such as 30m, 12h or 7d')
  return Number(match[1]) * (UNITS[unit] ?? 0)
}

export interface VisitorsIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly stdout: Writable
}

const USAGE = 'theoclaw visitors: expected grant <email> --for <30m|12h|7d> | revoke <email> | list'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function visitorsCommand(args: readonly string[], io: VisitorsIo, now: number = Date.now()): number {
  const [verb, email, ...rest] = args
  const file = visitorsPath(io.env, io.homeDir)
  if (verb === 'list') {
    if (email !== undefined) throw new UsageError(USAGE)
    const grants = readGrants(file)
    for (const [who, until] of Object.entries(grants).sort())
      io.stdout.write(`${who} ${until > now ? 'until' : 'expired'} ${new Date(until).toISOString()}\n`)
    if (Object.keys(grants).length === 0) io.stdout.write('no visitor grants\n')
    return 0
  }
  if (email === undefined || !EMAIL.test(email)) throw new UsageError(USAGE)
  const who = normalize(email)
  const grants = { ...readGrants(file) }
  if (verb === 'revoke') {
    if (rest.length > 0) throw new UsageError(USAGE)
    delete grants[who]
    writeGrants(file, grants)
    io.stdout.write(`revoked ${who}\n`)
    return 0
  }
  if (verb === 'grant') {
    if (rest.length !== 2 || rest[0] !== '--for') throw new UsageError(USAGE)
    const until = now + parseDuration(rest[1] ?? '')
    for (const [other, at] of Object.entries(grants)) if (at <= now) delete grants[other]
    grants[who] = until
    writeGrants(file, grants)
    io.stdout.write(`granted ${who} until ${new Date(until).toISOString()}\n`)
    return 0
  }
  throw new UsageError(USAGE)
}
