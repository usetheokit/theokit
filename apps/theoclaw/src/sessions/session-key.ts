import { SessionRouter, scopedStrategy } from '@theokit/gateway'
import type { MessageEvent } from '@theokit/gateway'

/** How a direct message is keyed (`THEOCLAW_DM_SCOPE`); groups and threads ignore it. */
export const DM_SCOPES = ['main', 'per-peer', 'per-channel-peer', 'per-account-channel-peer'] as const

export type DmScope = (typeof DM_SCOPES)[number]

export interface SessionKeySettings {
  readonly dmScope: DmScope
  /** `<platform>:<senderId>` to a peer name, read from `THEOCLAW_PEER_LINKS`. */
  readonly peerLinks: ReadonlyMap<string, string>
  /** Required by `per-account-channel-peer`, read from `THEOCLAW_ACCOUNT_LABEL`. */
  readonly accountLabel?: string
}

/**
 * `-` separates key segments, so an id keeps none of its own: `_` is written `__` and `-` is written
 * `_d`. Both are escaped, so no two ids give one segment. A key selects a long-lived agent and its
 * stored history, so `a-b` and `a_b` sharing one would hand one sender the other's conversation
 * (CWE-706); the gateway's `defaultStrategy`, which maps `-` to `_` alone, keeps no history.
 */
function segment(id: string): string {
  return id.replace(/[_-]/g, (character) => (character === '_' ? '__' : '_d'))
}

/** `scopedStrategy` rejects an empty account label; this stands in for it and is swapped back out. */
const EMPTY_LABEL = 'x'
const MAIN_KEY = 'main'
const PEER_PREFIX = 'peer-'

/**
 * The gateway's `scopedStrategy` builds every key. TheoClaw keeps two things stored sessions depend
 * on: the `main` and `peer-<name>` DM keys (`keys`), and the platform segment written raw, so
 * `google_chat` and `tlon_urbit` keep the key the app always wrote (the gateway would escape them).
 */
function strategyFor(settings: SessionKeySettings): ReturnType<typeof scopedStrategy> {
  const empty = settings.accountLabel === undefined || settings.accountLabel === ''
  return scopedStrategy({
    dmScope: settings.dmScope,
    peerLinks: settings.peerLinks,
    ...(settings.dmScope === 'per-account-channel-peer' ? { accountLabel: empty ? EMPTY_LABEL : settings.accountLabel } : {}),
    keys: { main: MAIN_KEY, peer: (name) => `${PEER_PREFIX}${segment(name)}` },
  })
}

/**
 * The one key of the conversation an inbound message belongs to. A group is one conversation for
 * every sender, a thread with a topic is its own, and a direct message follows the DM scope. Pure:
 * it reads no environment, clock or file.
 */
export function sessionKeyFor(event: MessageEvent, settings: SessionKeySettings): string {
  const key = strategyFor(settings)(event)
  if (key === MAIN_KEY || key.startsWith(PEER_PREFIX)) return key
  // The gateway escapes the platform segment like any other; it is written raw here.
  const lead = `${segment(event.platform)}-`
  if (!key.startsWith(lead)) throw new Error(`unexpected session key layout from the gateway: ${key}`)
  let rest = key.slice(lead.length)
  if (settings.dmScope === 'per-account-channel-peer' && event.channel.type === 'dm' && (settings.accountLabel ?? '') === '') {
    const labelled = `dm-${EMPTY_LABEL}-`
    if (!rest.startsWith(labelled)) throw new Error(`unexpected session key layout from the gateway: ${key}`)
    rest = `dm--${rest.slice(labelled.length)}`
  }
  return `${event.platform}-${rest}`
}

/** The gateway's router over `sessionKeyFor`; the app reads keys only through it. */
export function createSessionRouter(settings: SessionKeySettings): SessionRouter {
  return new SessionRouter((event) => sessionKeyFor(event, settings))
}
