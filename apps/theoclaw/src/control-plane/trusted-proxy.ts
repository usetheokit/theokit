import type { IncomingMessage } from 'node:http'

import { TheoClawConfigError } from './errors.js'

/**
 * Trusted-proxy mode (OC-24). A reverse proxy (Tailscale serve, Caddy, nginx) authenticates the
 * user and passes the identity in `THEOCLAW_TRUSTED_PROXY_HEADER`; TheoClaw believes the header
 * only when the TCP peer is one of `THEOCLAW_TRUSTED_PROXY_ADDRESSES`. This file is the one place
 * that reads a peer address (`tests/remote-access-source.test.ts` pins that).
 */
export interface TrustedProxy {
  readonly header: string
  readonly addresses: ReadonlySet<string>
}

/** Set on a request the listener found to come from a trusted proxy with an identity; stripped from every other. */
export const TRUSTED_IDENTITY_HEADER = 'x-theoclaw-trusted-identity'

type Env = Readonly<Record<string, string | undefined>>

function normalize(address: string): string {
  return address.toLowerCase().replace(/^::ffff:/, '')
}

/** `undefined` while neither variable is set; both are needed together. */
export function readTrustedProxy(env: Env): TrustedProxy | undefined {
  const header = (env.THEOCLAW_TRUSTED_PROXY_HEADER ?? '').trim().toLowerCase()
  const list = (env.THEOCLAW_TRUSTED_PROXY_ADDRESSES ?? '')
    .split(',')
    .map((a) => normalize(a.trim()))
    .filter((a) => a !== '')
  if (header === '' && list.length === 0) return undefined
  if (header === '') throw new TheoClawConfigError('THEOCLAW_TRUSTED_PROXY_HEADER must name the identity header', { variable: 'THEOCLAW_TRUSTED_PROXY_HEADER' })
  if (list.length === 0) throw new TheoClawConfigError('THEOCLAW_TRUSTED_PROXY_ADDRESSES must list the proxy addresses', { variable: 'THEOCLAW_TRUSTED_PROXY_ADDRESSES' })
  if (!/^[a-z0-9-]+$/.test(header) || header === TRUSTED_IDENTITY_HEADER || header === 'authorization') {
    throw new TheoClawConfigError('THEOCLAW_TRUSTED_PROXY_HEADER is not a usable header name', { variable: 'THEOCLAW_TRUSTED_PROXY_HEADER' })
  }
  return { header, addresses: new Set(list) }
}

/**
 * Decide the identity marker on the incoming headers: any client-supplied marker is dropped, and
 * the marker is set only for an allowlisted peer that sent a non-empty identity.
 */
export function stampTrustedIdentity(incoming: IncomingMessage, proxy: TrustedProxy | undefined): void {
  delete incoming.headers[TRUSTED_IDENTITY_HEADER]
  if (proxy === undefined) return
  const peer = incoming.socket.remoteAddress
  const identity = incoming.headers[proxy.header]
  delete incoming.headers[proxy.header]
  if (peer === undefined || !proxy.addresses.has(normalize(peer))) return
  const value = Array.isArray(identity) ? identity[0] : identity
  if (value !== undefined && value.trim() !== '') incoming.headers[TRUSTED_IDENTITY_HEADER] = value.trim()
}
