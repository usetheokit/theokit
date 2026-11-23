import type { MessageEvent } from '@theokit/gateway'

/**
 * The session event of a chat: a group channel of the chat's own, so its session key is
 * `webchat-grp-<id>` whatever `THEOCLAW_DM_SCOPE` says, and two chat ids never share one.
 */
export function webchatEvent(chatId: string): MessageEvent {
  return {
    platform: 'webchat',
    channel: { type: 'group', id: chatId },
    sender: { id: 'webchat' },
  } as unknown as MessageEvent
}
