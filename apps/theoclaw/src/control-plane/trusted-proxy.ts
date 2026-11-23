import { PEER_ADDRESS_HEADER, TRUSTED_IDENTITY_HEADER, type TrustedProxyOptions } from '@theokit/http/runtime/node'

import { TheoClawConfigError } from './errors.js'

/**
 * Trusted-proxy mode (OC-24). A reverse proxy (Tailscale serve, Caddy, nginx) authenticates the
 * user and passes the identity in `THEOCLAW_TRUSTED_PROXY_HEADER`; TheoClaw believes the header
 * only when the TCP peer is one of `THEOCLAW_TRUSTED_PROXY_ADDRESSES`. The framework's
 * `createNodeServer` stamps the peer and the identity, and strips every client-supplied value of
 * either; this file only reads the two settings into its `trustedProxy` option.
 */
export { PEER_ADDRESS_HEADER, TRUSTED_IDENTITY_HEADER }

type Env = Readonly<Record<string, string | undefined>>

/** `undefined` while neither variable is set; both are needed together. */
export function readTrustedProxy(env: Env): TrustedProxyOptions | undefined {
  const header = (env.THEOCLAW_TRUSTED_PROXY_HEADER ?? '').trim().toLowerCase()
  const list = (env.THEOCLAW_TRUSTED_PROXY_ADDRESSES ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a !== '')
  if (header === '' && list.length === 0) return undefined
  if (header === '') throw new TheoClawConfigError('THEOCLAW_TRUSTED_PROXY_HEADER must name the identity header', { variable: 'THEOCLAW_TRUSTED_PROXY_HEADER' })
  if (list.length === 0) throw new TheoClawConfigError('THEOCLAW_TRUSTED_PROXY_ADDRESSES must list the proxy addresses', { variable: 'THEOCLAW_TRUSTED_PROXY_ADDRESSES' })
  if (!/^[a-z0-9-]+$/.test(header) || header === TRUSTED_IDENTITY_HEADER || header === PEER_ADDRESS_HEADER || header === 'authorization') {
    throw new TheoClawConfigError('THEOCLAW_TRUSTED_PROXY_HEADER is not a usable header name', { variable: 'THEOCLAW_TRUSTED_PROXY_HEADER' })
  }
  return { identityHeader: header, addresses: list }
}
