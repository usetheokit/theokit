import { SessionRouter } from '@theokit/gateway'
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

function dmKey(event: MessageEvent, settings: SessionKeySettings): string {
  const sender = segment(event.sender.id)
  switch (settings.dmScope) {
    case 'main':
      return 'main'
    case 'per-peer': {
      const name = settings.peerLinks.get(`${event.platform}:${event.sender.id}`)
      return name === undefined ? `${event.platform}-dm-${sender}` : `peer-${segment(name)}`
    }
    case 'per-channel-peer':
      return `${event.platform}-dm-${sender}`
    case 'per-account-channel-peer':
      // `dm` stays the second segment, so no label makes a direct message's key a thread's or a group's.
      return `${event.platform}-dm-${segment(settings.accountLabel ?? '')}-${sender}`
  }
}

/**
 * The one key of the conversation an inbound message belongs to. A group is one conversation for
 * every sender, a thread with a topic is its own, and a direct message follows the DM scope. Pure:
 * it reads no environment, clock or file.
 */
export function sessionKeyFor(event: MessageEvent, settings: SessionKeySettings): string {
  const { channel, platform } = event
  if (channel.type === 'dm') return dmKey(event, settings)
  if (channel.type === 'thread' && channel.topicId !== undefined) {
    return `${platform}-tpc-${segment(channel.id)}-${segment(channel.topicId)}`
  }
  return `${platform}-grp-${segment(channel.id)}`
}

/** The gateway's router over `sessionKeyFor`; the app reads keys only through it. */
export function createSessionRouter(settings: SessionKeySettings): SessionRouter {
  return new SessionRouter((event) => sessionKeyFor(event, settings))
}
