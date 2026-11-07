import { isLoopback, type BindEnvironment } from '../control-plane/bind.js'
import { readBearerToken } from '../control-plane/bearer.js'
import { TheoClawConfigError } from '../control-plane/errors.js'

/**
 * B-394 (OC-13) — the A2A settings, read once at start (plan D3). `THEOCLAW_A2A_TOKEN` switches
 * the `/a2a` route on; `THEOCLAW_A2A_PEERS` names each peer as `<name>=<base url>`, and each
 * peer's token is `THEOCLAW_A2A_PEER_TOKEN_<NAME>`, kept out of the pair list because the list is
 * printed. Every refusal names the variable and never a token.
 */

/** One peer the `/control` agent can send a task to. */
export interface A2APeer {
  readonly name: string
  readonly baseUrl: string
  readonly token: string
}

/** The inbound token (the route is off without it) and the configured peers. */
export interface A2ASettings {
  readonly token: string | undefined
  readonly peers: readonly A2APeer[]
}

const PEERS = 'THEOCLAW_A2A_PEERS'
const PEER_TOKEN_PREFIX = 'THEOCLAW_A2A_PEER_TOKEN_'
const PEER_NAME = /^[a-z][a-z0-9_]{0,31}$/

function peerError(index: number, reason: string): TheoClawConfigError {
  return new TheoClawConfigError(`${PEERS} entry ${index}: ${reason}`, { variable: PEERS })
}

/**
 * The URL a peer is reached at, trailing `/` trimmed. Plain `http:` only on the loopback (EC-1):
 * off it, every call would carry the peer's bearer token in clear.
 */
function peerBaseUrl(raw: string, index: number): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw peerError(index, 'the URL does not parse')
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1')
  if (url.protocol === 'http:' && !isLoopback(host)) {
    throw peerError(
      index,
      'a peer off the loopback must use https: (plain http would send its token in clear)',
    )
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw peerError(index, 'the URL must be https: (or http: on the loopback)')
  }
  if (url.search !== '' || url.hash !== '')
    throw peerError(index, 'the URL must carry no query or fragment')
  // A credential in the URL would travel outside the masked token and print in a fetch error.
  if (url.username !== '' || url.password !== '') {
    throw peerError(
      index,
      'the URL must carry no user or password; the token goes in THEOCLAW_A2A_PEER_TOKEN_<NAME>',
    )
  }
  const text = url.toString()
  return text.endsWith('/') ? text.slice(0, -1) : text
}

function readPeer(env: BindEnvironment, entry: string, index: number, seen: Set<string>): A2APeer {
  if (entry === '') throw peerError(index, 'the entry is empty')
  const separator = entry.indexOf('=')
  if (separator === -1) throw peerError(index, 'expected <name>=<url>')
  const name = entry.slice(0, separator).trim()
  if (!PEER_NAME.test(name)) throw peerError(index, 'the name must match ^[a-z][a-z0-9_]{0,31}$')
  if (seen.has(name)) throw peerError(index, `the name "${name}" is repeated`)
  seen.add(name)
  const baseUrl = peerBaseUrl(entry.slice(separator + 1).trim(), index)
  const variable = PEER_TOKEN_PREFIX + name.toUpperCase()
  const token = readBearerToken(env, variable)
  if (token === undefined) {
    throw new TheoClawConfigError(`${variable} must be set for the peer "${name}" in ${PEERS}`, {
      variable,
    })
  }
  return { name, baseUrl, token }
}

/** Read and validate the A2A variables; throws `TheoClawConfigError` before anything opens. */
export function readA2ASettings(env: BindEnvironment): A2ASettings {
  const token = readBearerToken(env, 'THEOCLAW_A2A_TOKEN')
  const list = env[PEERS] ?? ''
  if (list.trim() === '') return { token, peers: [] }
  const seen = new Set<string>()
  const peers = list.split(',').map((entry, index) => readPeer(env, entry.trim(), index + 1, seen))
  return { token, peers }
}

/** The start lines: whether `/a2a` is served, and the peers by name only. */
export function a2aLines(settings: A2ASettings): string[] {
  const serving =
    settings.token === undefined
      ? 'a2a: off (THEOCLAW_A2A_TOKEN unset)'
      : 'a2a: serving /a2a (THEOCLAW_A2A_TOKEN set)'
  const peers =
    settings.peers.length === 0
      ? []
      : [`a2a: peers ${settings.peers.map((peer) => peer.name).join(', ')}`]
  return [serving, ...peers]
}

/** The values the output mask and the reply masks hide: the inbound token and every peer's. */
export function a2aSecrets(settings: A2ASettings): string[] {
  return [
    ...(settings.token === undefined ? [] : [settings.token]),
    ...settings.peers.map((peer) => peer.token),
  ]
}
