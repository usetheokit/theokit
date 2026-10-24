import { isIPv4 } from 'node:net'

import { TheoClawBindError, TheoClawConfigError } from './errors.js'

/** What the bind reads: an environment, never `process.env` itself (NFR-005). */
export type BindEnvironment = Readonly<Record<string, string | undefined>>

const LOOPBACK_DEFAULT = '127.0.0.1'

/**
 * Exact spellings only. `localhost`, `::1` and any dotted IPv4 in 127.0.0.0/8. `isIPv4` refuses
 * `127.0.0.256`, `127.1` and leading zeros, so the /8 check needs no parsing of its own. Every other
 * spelling of a loopback address (`LOCALHOST`, `[::1]`, `::ffff:127.0.0.1`) is refused like a
 * public one: a false refusal costs the operator one edit, a false acceptance opens the port.
 */
function isLoopback(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true
  return isIPv4(host) && host.startsWith('127.')
}

/**
 * The address the control plane binds. `THEOCLAW_HOST` names it and defaults to the loopback; a
 * non-loopback address also needs `THEOCLAW_PUBLIC_BIND=yes`. The generic `HOST` is never read:
 * `theo start` binds all interfaces when it is set, so an export meant for another tool would
 * otherwise open this one's port (plan D2).
 */
export function resolveBindAddress(env: BindEnvironment): string {
  const host = (env.THEOCLAW_HOST ?? '').trim()
  if (host === '') return LOOPBACK_DEFAULT
  if (isLoopback(host) || env.THEOCLAW_PUBLIC_BIND === 'yes') return host
  throw new TheoClawBindError(
    `refusing to bind ${host}: it is not a loopback address; set THEOCLAW_PUBLIC_BIND=yes to bind a non-loopback address`,
    { address: host },
  )
}

/**
 * `THEOCLAW_PORT`: digits only, 0 to 65535, untrimmed (` 8080` is refused, `080` reads as 80). The
 * message names the variable and never the value.
 */
export function parsePort(value: string | undefined): number {
  const port = value !== undefined && /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isInteger(port) || port > 65_535) {
    throw new TheoClawConfigError('THEOCLAW_PORT must be an integer from 0 to 65535', {
      variable: 'THEOCLAW_PORT',
    })
  }
  return port
}
