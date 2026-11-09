import { readBearerToken } from '../control-plane/bearer.js'
import type { BindEnvironment } from '../control-plane/bind.js'
import { TheoClawConfigError } from '../control-plane/errors.js'

/**
 * B-694 (OC-14) — relay settings, read once at start.
 * - `THEOCLAW_RELAY_TOKEN` switches this instance's `/relay/*` mailbox on (it is then a relay).
 * - `THEOCLAW_RELAY_URL` + `THEOCLAW_RELAY_CLIENT_TOKEN` make it a relay user (https, or http on
 *   the loopback); `THEOCLAW_RELAY_PEERS` is the trust list: `<name>=<base64url public key>,...`.
 *   Only listed peers can be sent to or heard from. Its own public key is printed at start.
 */
export interface RelaySettings {
  readonly serveToken: string | undefined
  readonly client: { readonly url: string; readonly token: string } | undefined
  readonly peers: ReadonlyMap<string, string>
}

const PEER_NAME = /^[a-z][a-z0-9_]{0,31}$/
const KEY = /^[A-Za-z0-9_-]{43}$/

export function readRelaySettings(env: BindEnvironment): RelaySettings {
  const serveToken = readBearerToken(env, 'THEOCLAW_RELAY_TOKEN')
  const rawUrl = env.THEOCLAW_RELAY_URL
  const peers = new Map<string, string>()
  for (const entry of (env.THEOCLAW_RELAY_PEERS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e !== '')) {
    const at = entry.indexOf('=')
    const name = at === -1 ? '' : entry.slice(0, at).trim()
    const key = at === -1 ? '' : entry.slice(at + 1).trim()
    if (!PEER_NAME.test(name) || !KEY.test(key) || peers.has(name)) {
      throw new TheoClawConfigError(
        'THEOCLAW_RELAY_PEERS: expected unique <name>=<43-char public key> entries',
        {
          variable: 'THEOCLAW_RELAY_PEERS',
        },
      )
    }
    peers.set(name, key)
  }
  if (rawUrl === undefined || rawUrl === '') return { serveToken, client: undefined, peers }
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new TheoClawConfigError('THEOCLAW_RELAY_URL does not parse', {
      variable: 'THEOCLAW_RELAY_URL',
    })
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TheoClawConfigError('THEOCLAW_RELAY_URL must be https: (or http: on the loopback)', {
      variable: 'THEOCLAW_RELAY_URL',
    })
  }
  const token = readBearerToken(env, 'THEOCLAW_RELAY_CLIENT_TOKEN')
  if (token === undefined) {
    throw new TheoClawConfigError(
      'THEOCLAW_RELAY_CLIENT_TOKEN must be set with THEOCLAW_RELAY_URL',
      {
        variable: 'THEOCLAW_RELAY_CLIENT_TOKEN',
      },
    )
  }
  return { serveToken, client: { url: rawUrl.replace(/\/$/, ''), token }, peers }
}

/** Values the mask hides. */
export function relaySecrets(settings: RelaySettings): string[] {
  return [settings.serveToken, settings.client?.token].filter((v): v is string => v !== undefined)
}
