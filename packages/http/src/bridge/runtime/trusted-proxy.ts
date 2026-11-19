/**
 * Trusted-proxy identity for createNodeServer: a reverse proxy that authenticates the user
 * forwards the identity in a header; it is believed only when the TCP peer is allowlisted.
 */
import type { IncomingMessage } from 'node:http'

export interface TrustedProxyOptions {
  /** Lower-case `[a-z0-9-]+` header carrying the identity; not `authorization`. */
  readonly identityHeader: string
  /** Exact peer addresses of the proxy (IPv4-mapped `::ffff:` prefix and case are ignored). */
  readonly addresses: readonly string[]
}

/** Headers the server sets on every Request; any client-supplied value is removed first. */
export const PEER_ADDRESS_HEADER = 'x-theokit-peer'
export const TRUSTED_IDENTITY_HEADER = 'x-theokit-trusted-identity'

export interface NormalizedTrustedProxy {
  readonly identityHeader: string
  readonly addresses: ReadonlySet<string>
}

const normalizeAddress = (address: string): string => {
  const lower = address.trim().toLowerCase()
  return lower.startsWith('::ffff:') ? lower.slice('::ffff:'.length) : lower
}

/** Validate options; throws a TypeError naming the offending option. */
export function normalizeTrustedProxy(options: TrustedProxyOptions): NormalizedTrustedProxy {
  const { identityHeader, addresses } = options as {
    identityHeader?: unknown
    addresses?: unknown
  }
  if (typeof identityHeader !== 'string' || !/^[a-z0-9-]+$/.test(identityHeader)) {
    throw new TypeError(
      'trustedProxy.identityHeader must be a lower-case header name matching [a-z0-9-]+',
    )
  }
  if (
    identityHeader === 'authorization' ||
    identityHeader === 'x-forwarded-proto' ||
    identityHeader === PEER_ADDRESS_HEADER ||
    identityHeader === TRUSTED_IDENTITY_HEADER
  ) {
    throw new TypeError(`trustedProxy.identityHeader may not be '${identityHeader}'`)
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new TypeError('trustedProxy.addresses must be a non-empty array of peer addresses')
  }
  const set = new Set<string>()
  for (const a of addresses as unknown[]) {
    if (typeof a !== 'string' || normalizeAddress(a) === '') {
      throw new TypeError('trustedProxy.addresses must contain only non-empty strings')
    }
    set.add(normalizeAddress(a))
  }
  return { identityHeader, addresses: set }
}

/**
 * Strip client-supplied internal headers, then stamp the peer address and, for an allowlisted
 * peer, the identity. Mutates `incoming.headers`. Returns whether the peer is trusted.
 */
export function stampTrustedIdentity(
  incoming: IncomingMessage,
  proxy: NormalizedTrustedProxy | undefined,
): boolean {
  const headers = incoming.headers
  Reflect.deleteProperty(headers, PEER_ADDRESS_HEADER)
  Reflect.deleteProperty(headers, TRUSTED_IDENTITY_HEADER)
  const remote = incoming.socket.remoteAddress
  if (remote !== undefined) headers[PEER_ADDRESS_HEADER] = remote
  const peer = remote === undefined ? undefined : normalizeAddress(remote)
  const trusted = proxy !== undefined && peer !== undefined && proxy.addresses.has(peer)
  if (!trusted) Reflect.deleteProperty(headers, 'x-forwarded-proto')
  if (proxy) {
    const raw = headers[proxy.identityHeader]
    // Node keeps `set-cookie` as an array; take its first value.
    const identity = Array.isArray(raw) ? raw[0] : raw
    Reflect.deleteProperty(headers, proxy.identityHeader)
    if (trusted && typeof identity === 'string' && identity.trim() !== '') {
      headers[TRUSTED_IDENTITY_HEADER] = identity.trim()
    }
  }
  return trusted
}

/** The identity a trusted proxy vouched for, or undefined. */
export function trustedIdentity(request: Request): string | undefined {
  return request.headers.get(TRUSTED_IDENTITY_HEADER) ?? undefined
}

/** The TCP peer address of the connection, as seen by the server. */
export function peerAddress(request: Request): string | undefined {
  return request.headers.get(PEER_ADDRESS_HEADER) ?? undefined
}
