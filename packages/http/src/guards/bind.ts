import { isIPv4 } from 'node:net'

import { BindRefusedError, GuardConfigError } from './errors.js'

const LOOPBACK_DEFAULT = '127.0.0.1'

/**
 * Exact spellings only: `localhost`, `::1` and dotted IPv4 in 127.0.0.0/8 as `isIPv4` accepts it.
 * `LOCALHOST`, `[::1]`, `::ffff:127.0.0.1` and `127.1` count as public: a false refusal costs one
 * edit, a false acceptance opens the port.
 */
export function isLoopback(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true
  return isIPv4(host) && host.startsWith('127.')
}

/**
 * The address to bind: `hostVariable` names it, loopback by default; a non-loopback host also needs
 * `consentVariable` set to `consentValue` (default `yes`). The generic `HOST` is never read.
 */
export function resolveBindAddress(
  env: Readonly<Record<string, string | undefined>>,
  options: { hostVariable: string; consentVariable: string; consentValue?: string },
): string {
  const host = (env[options.hostVariable] ?? '').trim()
  if (host === '') return LOOPBACK_DEFAULT
  const consentValue = options.consentValue ?? 'yes'
  if (isLoopback(host) || env[options.consentVariable] === consentValue) return host
  throw new BindRefusedError(
    `refusing to bind ${host}: it is not a loopback address; set ${options.consentVariable}=${consentValue} to bind a non-loopback address`,
    host,
  )
}

/** A port from `variable`: digits only, 0 to 65535, untrimmed. The message names the variable, never the value. */
export function parsePort(
  env: Readonly<Record<string, string | undefined>>,
  variable: string,
): number {
  const value = env[variable]
  const port = value !== undefined && /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isInteger(port) || port > 65_535) {
    throw new GuardConfigError(`${variable} must be an integer from 0 to 65535`, variable)
  }
  return port
}
