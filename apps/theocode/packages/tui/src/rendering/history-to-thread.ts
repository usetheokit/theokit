import { sessionMessagesToThread, type UIMessageLike } from '@theokit/tui'

/**
 * A stored turn, as `readSessionMessages` returns it.
 *
 * Declared structurally rather than imported from `@theokit/sdk`. This package renders; it has no
 * business naming the framework's session module, and `packages/agent/src/session/thread-history.ts`
 * is deliberately the only file in this repository that does. The shape is small enough that
 * restating it costs less than the layer violation would.
 */
export interface StoredMessage {
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly parts?: readonly StoredPart[]
}

type StoredPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool_use'
      readonly id: string
      readonly name: string
      readonly input: Record<string, unknown>
    }
  | {
      readonly type: 'tool_result'
      readonly toolUseId: string
      readonly content: unknown
      readonly isError?: boolean
    }

/**
 * Project a stored session onto the thread shape `useAgentStream`'s `initialMessages` takes (#70).
 *
 * The pairing of `tool_use` with the `tool_result` that names it — across the WHOLE history, since
 * the result lives in the message after the call — is the framework's `sessionMessagesToThread`.
 * What stays here is one normalisation: a stored turn with `parts: []` carries no structure, so it
 * falls back to its text as an absent `parts` does, rather than vanishing.
 */
export function historyToThread(messages: readonly StoredMessage[]): UIMessageLike[] {
  return sessionMessagesToThread(
    messages.map((message) =>
      message.parts?.length === 0 ? { role: message.role, text: message.text } : message,
    ),
  )
}
