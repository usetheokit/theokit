import type { AgentOutputEvent } from '@theokit/presenter'
import { type WireChunk, wireChunkSchema } from '@theokit/presenter/wire'

/**
 * M85 — a test seam over the vocabulary production actually speaks.
 *
 * ## What was wrong with the seam we had
 *
 * The entire published test surface was ONE function, `createMockAgentStream`, emitting
 * `run_started` / `text_delta` / `tool_call` — a snake_case vocabulary **no production path of this
 * framework consumes**. The terminal renderer switches over the kebab-case `WIRE_CHUNK_TYPES`; the
 * presenter speaks a third.
 *
 * A consumer adopting it would have been testing against event names that do not exist in
 * production — a green test as evidence about nothing. Measured adoption: **one** caller in the
 * whole target (its own unit test) and **zero** in the only real product, which recorded the refusal
 * in prose.
 *
 * We were not eating this food either. That is the honest version of the problem.
 *
 * ## Why the builders validate at construction
 *
 * A fixture is a claim about what production emits. `{ type: 'error', errorText: 'boom' } as never`
 * is a claim nothing checks — and the cast is the consumer telling you, in the code, that the seam
 * did not fit. Validating here means a malformed fixture fails where it was WRITTEN, instead of
 * surviving into a test that proves nothing, or failing later inside a renderer where it reads as a
 * renderer bug.
 */

/** Validate a chunk against the real schema, so a fixture cannot claim a shape production rejects. */
function checked(chunk: WireChunk): WireChunk {
  const parsed = wireChunkSchema.safeParse(chunk)
  if (!parsed.success) {
    throw new TypeError(
      `[@theokit/agents/testing] this is not a valid wire chunk: ${parsed.error.message}. A fixture ` +
        `production would reject is a test that proves nothing.`,
    )
  }
  return chunk
}

/**
 * Typed builders for the chunks a test needs.
 *
 * Not a builder per member of the union — most of the thirteen never appear in a fixture, and
 * writing them all would be surface nobody asked for (YAGNI). These are the four a consumer's
 * fixtures actually contained. A test needing another writes the literal and passes it through
 * {@link createMockWireStream}, which validates all the same.
 */
export const wireChunk = {
  /** A text fragment. `id` groups deltas into one message; a fixture rarely cares which. */
  text(delta: string, id = 'text-1'): WireChunk {
    return checked({ type: 'text-delta', id, delta })
  },
  /** The error frame. This is the literal a consumer was writing with `as never` on the end. */
  error(errorText: string): WireChunk {
    return checked({ type: 'error', errorText })
  },
  /** Stream end. */
  finish(): WireChunk {
    return checked({ type: 'finish' })
  },
  /** Stream start. `messageId` is optional in the schema and omitted here for the same reason. */
  start(messageId?: string): WireChunk {
    return checked(messageId === undefined ? { type: 'start' } : { type: 'start', messageId })
  },
}

/**
 * A stream of wire chunks, for driving anything that consumes the wire.
 *
 * Async because every production consumer is: a mock that were synchronous would let a test pass
 * over code that never awaited, which is the class of bug a stream test exists to catch.
 */
/* eslint-disable @typescript-eslint/require-await -- an async generator with nothing to await is
   exactly right here: the ASYNC-ness is the CONTRACT (every production consumer uses `for await`),
   not an implementation detail. Making these sync would change what they model; adding a pointless
   `await` would be noise pretending to be work. */
export async function* createMockWireStream(
  chunks: readonly WireChunk[],
): AsyncGenerator<WireChunk> {
  for (const chunk of chunks) {
    // Validated on the way out too, so a hand-written literal gets the same guarantee as a builder.
    yield checked(chunk)
  }
}

/**
 * A stream of presenter output events.
 *
 * Published alongside the wire one, deliberately: a test of a presenter surface should not have to
 * round-trip through the wire to produce a single event. Two vocabularies exist in production, and a
 * seam that admitted only one would push every test of the other back into casts.
 */
export async function* createMockOutputEvents(
  events: readonly AgentOutputEvent[],
): AsyncGenerator<AgentOutputEvent> {
  for (const event of events) yield event
}
/* eslint-enable @typescript-eslint/require-await */
