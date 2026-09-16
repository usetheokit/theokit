import type { UIMessageLike, UIMessagePartLike } from '@theokit/tui'

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
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  | {
      readonly type: 'tool_result'
      readonly toolUseId: string
      readonly content: unknown
      readonly isError?: boolean
    }

/**
 * Project a stored session onto the thread shape `useAgentStream`'s `initialMessages` takes (#70).
 *
 * THE TWO SHAPES DO NOT MEET, and the gap is silent. The SDK is Claude-shaped: `tool_use` and
 * `tool_result` are separate parts joined by an id. `messagesToAgentEvents` wants one part per call,
 * typed `tool-<name>`, carrying input and output together. Measured before writing this: handing it
 * the raw parts returns the text event and DROPS every tool part — a resumed screen showing the prose
 * and none of the commands, which reads as complete and is not.
 *
 * So the merge is the whole job: pair each `tool_use` with the `tool_result` that names it, and give
 * the pair the state vocabulary the renderer reads — also measured rather than guessed
 * (`output-available` → success, `output-error` → failed, `input-available` → running).
 */
export function historyToThread(messages: readonly StoredMessage[]): UIMessageLike[] {
  // Collected across the WHOLE history, not per message. Measured against a real transcript: the
  // Claude shape puts `tool_result` in the message AFTER the call, so a per-message merge left every
  // card `running` — and `deriveTimeline` drops running tools from history, so the command vanished
  // from the screen while the mapping looked like it had worked.
  const results = new Map<string, Extract<StoredPart, { type: 'tool_result' }>>()
  for (const message of messages)
    for (const part of message.parts ?? [])
      if (part.type === 'tool_result') results.set(part.toolUseId, part)

  return messages
    .map((message, index) => ({
      // Derived from the position, not minted from a counter: the timeline keys on these, and an id
      // that changes between renders re-keys every row.
      id: `history-${String(index)}`,
      role: message.role,
      parts: partsOf(message, results),
    }))
    // A message that held nothing but a result is the carrier of one, and has no prose of its own.
    // Keeping it would put a blank turn on screen under every tool call.
    .filter((message) => message.parts.length > 0)
}

/**
 * A message's parts, or its text when it carries no structure.
 *
 * `parts` is optional upstream and its absence means "this projection carries no structure", never
 * "this turn had none" — so falling through to the text is what keeps a whole turn from vanishing.
 */
function partsOf(
  message: StoredMessage,
  results: ReadonlyMap<string, Extract<StoredPart, { type: 'tool_result' }>>,
): UIMessagePartLike[] {
  if (message.parts === undefined || message.parts.length === 0) {
    return message.text.length === 0 ? [] : [{ type: 'text', text: message.text }]
  }

  const out: UIMessagePartLike[] = []
  for (const part of message.parts) {
    if (part.type === 'text') out.push({ type: 'text', text: part.text })
    else if (part.type === 'tool_use') out.push(toolPart(part, results.get(part.id)))
    // `tool_result` is not emitted on its own — it was folded into its call. One that names a call
    // the history does not contain is dropped rather than rendered orphaned: a result card with no
    // command above it is a puzzle, not information.
  }
  return out
}

function toolPart(
  call: Extract<StoredPart, { type: 'tool_use' }>,
  result: Extract<StoredPart, { type: 'tool_result' }> | undefined,
): UIMessagePartLike {
  const base = { type: `tool-${call.name}`, toolCallId: call.id, input: call.input }
  // A transcript can end mid-call. `input-available` renders as `running`, which this product's own
  // `deriveTimeline` then filters out of history — the honest outcome, because claiming success for a
  // result nobody has is fabrication.
  if (result === undefined) return { ...base, state: 'input-available' }

  const text = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
  return result.isError === true
    ? { ...base, state: 'output-error', errorText: text }
    : { ...base, state: 'output-available', output: text }
}
