import type { MessageEvent } from '@theokit/gateway'

/** The longest chat id WebChat accepts; the page's ids are UUIDs. */
export const MAX_CHAT_ID_LENGTH = 128
const CHAT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

/** A chat post that names no usable chat: refused, never answered by a shared or a fresh agent. */
export class WebchatChatIdError extends Error {
  readonly code = 'chat_id_invalid'

  constructor(message: string) {
    super(message)
    this.name = 'WebchatChatIdError'
  }
}

/**
 * The chat id a post names, read the way the route generator reads it (`sessionId` wins over `id`).
 * Throws `WebchatChatIdError` for a missing, empty, over-long or oddly shaped one.
 */
export function chatIdOf(body: Record<string, unknown>): string {
  const pick = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined)
  const id = pick(body.sessionId) ?? pick(body.id)
  if (id === undefined) throw new WebchatChatIdError('a chat post must carry the chat id as `id` or `sessionId`')
  if (id.length > MAX_CHAT_ID_LENGTH || !CHAT_ID.test(id)) throw new WebchatChatIdError('the chat id is not a valid chat id')
  return id
}

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
