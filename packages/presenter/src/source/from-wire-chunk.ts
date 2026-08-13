import type { AgentOutputEvent } from '../agent-output-event.js'
import type { WireChunk } from '../wire/chunk-schema.js'

/**
 * M70 — the door from the wire into the canonical event.
 *
 * ## Why this was missing, and what it cost
 *
 * This package normalises agent output into {@link AgentOutputEvent} and ships three presenters plus
 * a registry. Its only source translators consumed RAW `@theokit/sdk` messages — but every embedded
 * consumer drives a transport, which produces {@link WireChunk}, already translated. With no
 * `WireChunk → AgentOutputEvent` door, the surface that actually receives the stream could never
 * enter the canonical event.
 *
 * That is the mechanical explanation for the presenters having almost no import sites. And it was
 * structural rather than a consumer's idiosyncrasy: this repository's own
 * `server/agent/render-terminal.ts` switched on wire chunks by hand and never touched
 * `TerminalPresenter`.
 *
 * This is the inverse of the forward mapping in `@theokit/agents`'
 * `bridge/present-ui-message-stream.ts`. The two must agree about which frames are agent OUTPUT and
 * which are framework concerns — see the `tool-approval-request` note below.
 *
 * ## Why it returns an array
 *
 * `0..n`, because the relation is not one-to-one: stream framing (`start`, `text-start`, …) carries
 * no agent output at all, and a future frame could carry more than one. Returning `null` for the
 * empty case would push a filter into every caller; returning an array lets them `flatMap`.
 */

/** The rendering used when a tool result arrives and its name was never seen. */
const UNKNOWN_TOOL_NAME = 'unknown tool'

/**
 * Frames that DELIMIT the stream rather than carry agent output.
 *
 * A set rather than five `case` arms falling through: it gives the concept a name, and it keeps the
 * switch below at a complexity the linter accepts without splitting an exhaustive mapping in half —
 * which would have cost the one property that matters here, that every arm is visible in one place.
 */
const FRAMING_CHUNK_TYPES: ReadonlySet<string> = new Set([
  'start',
  'text-start',
  'text-end',
  'reasoning-start',
  'reasoning-end',
])

/**
 * Translate one wire frame into canonical events.
 *
 * @param chunk one validated frame of the wire
 * @param toolNames callId → tool name, threaded by a stateful caller.
 *
 * The second argument exists because the wire genuinely does not carry the name:
 * `tool-output-available` has `toolCallId` and `output` and nothing else, while the name appears
 * only on the earlier `tool-input-available`. Every consumer that renders tool results therefore
 * keeps this map — including the one this function replaces. Threading it is honest; inventing the
 * name here would not be.
 *
 * Without the map a result still maps, and says the name is unknown. Dropping it would lose a real
 * result, and an empty name would render as a line the operator cannot connect to anything.
 */
export function fromWireChunk(
  chunk: WireChunk,
  toolNames?: ReadonlyMap<string, string>,
): AgentOutputEvent[] {
  // Emitting a canonical event for framing would make every presenter render punctuation.
  if (FRAMING_CHUNK_TYPES.has(chunk.type)) return []

  switch (chunk.type) {
    case 'text-delta':
      return [{ type: 'text', text: chunk.delta }]

    case 'reasoning-delta':
      return [{ type: 'reasoning', text: chunk.delta }]

    case 'tool-input-available':
      return [
        {
          type: 'tool-call',
          callId: chunk.toolCallId,
          name: chunk.toolName,
          input: chunk.input,
        },
      ]

    case 'tool-output-available':
      return [
        {
          type: 'tool-result',
          callId: chunk.toolCallId,
          name: toolNames?.get(chunk.toolCallId) ?? UNKNOWN_TOOL_NAME,
          result: chunk.output,
        },
      ]

    // A failed tool is still a TOOL RESULT keyed by its call, never a run-level `error`. Collapsing
    // the two would lose which call failed — the one thing the operator needs to act on.
    case 'tool-output-error':
      return [
        {
          type: 'tool-result',
          callId: chunk.toolCallId,
          name: toolNames?.get(chunk.toolCallId) ?? UNKNOWN_TOOL_NAME,
          result: chunk.errorText,
          isError: true,
        },
      ]

    // HITL is a FRAMEWORK concern, not pure agent output. The forward mapping composed approvals
    // inline rather than routing them through the canonical event (ADR-4); the inverse draws the
    // line in the same place, or the two disagree about what the canonical event means.
    case 'tool-approval-request':
      return []

    case 'error':
      return [{ type: 'error', message: chunk.errorText ?? 'unknown error' }]

    case 'finish':
      return [{ type: 'finish' }]

    // `data-*` is an open family carrying transport concerns. It is also the arm that catches a
    // frame this build does not recognise — the wire is validated upstream, so an unmapped type
    // here means the schema grew and this switch did not. `tests/from-wire-chunk.test.ts`
    // enumerates `WIRE_CHUNK_TYPES` precisely to fail before that reaches a consumer.
    default:
      return []
  }
}
