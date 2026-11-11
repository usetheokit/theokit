import { readFileSync } from 'node:fs'

import { describeError, TheoClawConfigError } from './errors.js'

/**
 * A coarse city for a connecting device's IP (OC-129), from a database kept on this host: a JSON
 * file at `THEOCLAW_GEOIP_DB`, `[{ "cidr": "203.0.113.0/24", "city": "Paris" }, ...]`. A lookup never
 * leaves the process. Private, loopback and unlisted addresses have no city.
 */
export type CityLookup = (ip: string | undefined) => string | undefined

interface Range {
  readonly version: 4 | 6
  readonly network: bigint
  readonly mask: bigint
  readonly city: string
}

function parseV4(text: string): bigint | undefined {
  const parts = text.split('.')
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255))
    return undefined
  return parts.reduce((acc, p) => (acc << 8n) | BigInt(p), 0n)
}

function parseV6(text: string): bigint | undefined {
  if (!/^[0-9a-f:]+$/i.test(text) || text.split('::').length > 2) return undefined
  const [head = '', tail] = text.split('::')
  const groups = (part: string): string[] => (part === '' ? [] : part.split(':'))
  const left = groups(head)
  const right = tail === undefined ? [] : groups(tail)
  const missing = 8 - left.length - right.length
  if (tail === undefined ? missing !== 0 : missing < 1) return undefined
  const all = [...left, ...Array<string>(tail === undefined ? 0 : missing).fill('0'), ...right]
  if (!all.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return undefined
  return all.reduce((acc, g) => (acc << 16n) | BigInt(`0x${g}`), 0n)
}

function parseAddress(text: string): { version: 4 | 6; value: bigint } | undefined {
  const v4 = parseV4(text)
  if (v4 !== undefined) return { version: 4, value: v4 }
  const v6 = parseV6(text)
  return v6 === undefined ? undefined : { version: 6, value: v6 }
}

function parseRange(entry: unknown): Range | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  const { cidr, city } = entry as { cidr?: unknown; city?: unknown }
  if (typeof cidr !== 'string' || typeof city !== 'string' || city.trim() === '') return undefined
  const [address = '', bits, extra] = cidr.split('/')
  const parsed = parseAddress(address)
  if (parsed === undefined || extra !== undefined) return undefined
  const width = parsed.version === 4 ? 32 : 128
  const prefix = bits === undefined ? width : /^\d{1,3}$/.test(bits) ? Number(bits) : NaN
  if (!(prefix >= 0 && prefix <= width)) return undefined
  const full = (1n << BigInt(width)) - 1n
  const mask = (full << BigInt(width - prefix)) & full
  return { version: parsed.version, network: parsed.value & mask, mask, city: city.trim() }
}

/** The lookup over the ranges in `path`. An unreadable or malformed file stops the start. */
export function loadCityLookup(path: string): CityLookup {
  const fail = (why: string): never => {
    throw new TheoClawConfigError(`${path} ${why}`, { variable: 'THEOCLAW_GEOIP_DB' })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return fail(`cannot be read as JSON: ${describeError(error)}`)
  }
  if (!Array.isArray(parsed)) return fail('is not a list of { "cidr", "city" }')
  const ranges = parsed.map(parseRange)
  if (ranges.some((r) => r === undefined))
    return fail('holds an entry that is not { "cidr", "city" }')
  const known = ranges as Range[]
  return (ip) => {
    if (ip === undefined) return undefined
    const address = parseAddress(ip.replace(/^::ffff:/i, ''))
    if (address === undefined) return undefined
    return known.find(
      (r) => r.version === address.version && (address.value & r.mask) === r.network,
    )?.city
  }
}
