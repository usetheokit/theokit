import type { UIMessageChunk } from 'ai'

import type { AgentStreamEvent } from './agent-stream-events.js'

/**
 * M0 (theokit-ai-first) — translate a theokit `AgentStreamEvent` stream into the
 * Vercel ai-sdk `UIMessageStream` protocol, TEXT ONLY.
 *
 * This is a PURE mapping (D1): it consumes the ALREADY-deduped bridge event
 * stream (downstream of `mergeDeltaStream`) and yields `UIMessageChunk`s. It
 * NEVER calls an LLM and does NOT re-run the agent loop (sdk-runtime.md / G2) —
 * `@theokit/sdk` remains the only runtime.
 *
 * Chunk sequence for a text run:
 *
 *   start → text-start{id} → text-delta{id,delta}* → text-end{id} → finish
 *
 * Invariants:
 * - Exactly one `start` and one `finish` per run.
 * - `text-end` is emitted ONLY if a `text-start` was emitted (no orphan close).
 * - A single shared `id` (`opts.textId`) for the whole text block — injected for
 *   deterministic tests (D3).
 * - Every emitted chunk carries ONLY the fields required by ai-sdk's
 *   `uiMessageChunkSchema` (a z.strictObject union — extra keys are rejected).
 *
 * Error handling (error-handling.md — fail-clear, surface don't swallow, never
 * throw past the boundary): an `error` event OR a thrown/aborted underlying
 * iterable is SURFACED as an ai-sdk `error` chunk (`{ type: 'error', errorText }`),
 * then closes an open text (`text-end`) and terminates with `finish`. The error is
 * not re-thrown — the transport still produces a well-formed, terminated stream the
 * client can render as a failed turn.
 *
 * Tool / reasoning / file chunks are intentionally out of scope for M0 (YAGNI);
 * non-text events are ignored here and widen the mapping in M1.
 */
export async function* translateToUIMessageStream(
  events: AsyncIterable<AgentStreamEvent>,
  opts: { textId: string },
): AsyncGenerator<UIMessageChunk, void, unknown> {
  yield { type: 'start' }
  let textOpen = false
  try {
    for await (const event of events) {
      if (event.type === 'text_delta') {
        if (!textOpen) {
          yield { type: 'text-start', id: opts.textId }
          textOpen = true
        }
        yield { type: 'text-delta', id: opts.textId, delta: event.content }
      } else if (event.type === 'error') {
        // Surface the agent-reported failure to the client as an ai-sdk error
        // chunk instead of silently swallowing it, then close gracefully.
        yield { type: 'error', errorText: event.message }
        break
      }
      // Non-text events (run_started, done, tool_*, thinking, …) produce no
      // text chunk in M0. `done`/end-of-stream close naturally below.
    }
  } catch (err) {
    // The underlying stream aborted/errored. Surface the failure as an error
    // chunk (structured, not console noise), then fall through to a graceful
    // close — never throw past the transport.
    yield { type: 'error', errorText: String(err) }
  }
  if (textOpen) {
    yield { type: 'text-end', id: opts.textId }
  }
  yield { type: 'finish' }
}
