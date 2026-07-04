import type { UIMessageChunk } from 'ai'

import type {
  AgentStreamEvent,
  ApprovalRequiredEvent,
  ToolCallEvent,
  ToolResultEvent,
} from './agent-stream-events.js'

/**
 * M1 (theokit-ai-first) — translate a theokit `AgentStreamEvent` stream into the
 * Vercel ai-sdk `UIMessageStream` protocol: TEXT (M0) + REASONING + TOOL chunks.
 *
 * This is a PURE mapping (D1): it consumes the ALREADY-deduped bridge event
 * stream (downstream of `mergeDeltaStream`) and yields `UIMessageChunk`s. It
 * NEVER calls an LLM and does NOT re-run the agent loop (sdk-runtime.md / G2) —
 * `@theokit/sdk` remains the only runtime.
 *
 * Chunk sequences:
 *
 *   text run:      start → text-start{id} → text-delta{id,delta}* → text-end{id} → finish
 *   reasoning run: start → reasoning-start{id} → reasoning-delta{id,delta}* → reasoning-end{id} → finish
 *   tool run:      start → tool-input-available{callId,name,input} → tool-output-available{callId,output} → finish
 *
 * Open-block state machine (EC-2): at most ONE streaming block (text OR
 * reasoning) is open at a time; before emitting a chunk of a DIFFERENT kind
 * (the other block, a tool chunk, or `finish`) the current block is closed
 * (`text-end` / `reasoning-end`) via `closeOpenBlock`. Consecutive `thinking`
 * events collapse into ONE reasoning block (EC-3).
 *
 * Tool chunks (EC-1): theokit tools are runtime-discovered, so tool chunks
 * carry `dynamic: true` — the ai-sdk consumer then materializes a `dynamic-tool`
 * UIPart (`process-ui-message-stream.ts:626`) whose explicit `toolName` survives
 * to the parsed part (a static `tool-<name>` part carries the name only in its
 * `type`; `ui-messages.ts:384-396`). A `tool_result` for a callId that never had
 * a preceding `tool_call` FIRST synthesizes `tool-input-available` — otherwise
 * the consumer throws `No tool invocation found` (`process-ui-message-stream.ts:115`).
 *
 * Invariants:
 * - Exactly one `start` and one `finish` per run.
 * - A single shared `id` (`opts.textId`) for every text block — injected for
 *   deterministic tests (D3). Reasoning ids are minted per-block via
 *   `crypto.randomUUID()` (G8).
 * - Every emitted chunk carries ONLY the fields required by ai-sdk's
 *   `uiMessageChunkSchema` (a z.strictObject union — extra keys are rejected).
 *
 * Error handling (error-handling.md — fail-clear, surface don't swallow, never
 * throw past the boundary): an `error` event OR a thrown/aborted underlying
 * iterable is SURFACED as an ai-sdk `error` chunk, then the open block is closed
 * and the stream terminates with `finish`. The error is not re-thrown — the
 * transport still produces a well-formed, terminated stream the client renders as
 * a failed turn.
 */

interface BlockState {
  openBlock: 'text' | 'reasoning' | null
  reasoningId: string | null
}

/** Close the currently-open text/reasoning block (EC-2). Idempotent when none open. */
function* closeOpenBlock(state: BlockState, textId: string): Generator<UIMessageChunk> {
  if (state.openBlock === 'text') {
    yield { type: 'text-end', id: textId }
  } else if (state.openBlock === 'reasoning' && state.reasoningId) {
    yield { type: 'reasoning-end', id: state.reasoningId }
  }
  state.openBlock = null
  // Reset the just-closed block's stale reasoning id so it can never be reused
  // by a later thinking event (reasoningId is always re-minted before read).
  state.reasoningId = null
}

/** Emit a tool-input-available for a committed tool call (EC-1: `dynamic:true`). */
function* emitToolCall(event: ToolCallEvent, seen: Set<string>): Generator<UIMessageChunk> {
  seen.add(event.callId)
  yield {
    type: 'tool-input-available',
    toolCallId: event.callId,
    toolName: event.toolName,
    input: event.input,
    dynamic: true,
  }
}

/**
 * Emit the tool output; for a callId never introduced by a `tool_call`, first
 * synthesize `tool-input-available` (EC-1) so the consumer has a part to update.
 */
function* emitToolResult(event: ToolResultEvent, seen: Set<string>): Generator<UIMessageChunk> {
  if (!seen.has(event.callId)) {
    seen.add(event.callId)
    yield {
      type: 'tool-input-available',
      toolCallId: event.callId,
      toolName: event.toolName,
      input: {},
      dynamic: true,
    }
  }
  if (event.isError) {
    // ToolResultEvent.output is already a string (agent-stream-events.ts:40).
    yield { type: 'tool-output-error', toolCallId: event.callId, errorText: event.output }
  } else {
    yield { type: 'tool-output-available', toolCallId: event.callId, output: event.output }
  }
}

/**
 * Emit a HITL approval request (M4): first synthesize the tool-input part (EC-1) so the
 * client has a tool to gate, then the ai-sdk-native `tool-approval-request` chunk referencing
 * the same toolCallId. The client renders the approval + responds via `tool-approval-response`
 * (out-of-band POST resolves the paused SDK `pre_tool_call` hook — the run is genuinely paused).
 */
function* emitApprovalRequest(
  event: ApprovalRequiredEvent,
  seen: Set<string>,
): Generator<UIMessageChunk> {
  if (!seen.has(event.callId)) {
    seen.add(event.callId)
    yield {
      type: 'tool-input-available',
      toolCallId: event.callId,
      toolName: event.toolName,
      input: event.input ?? {},
      dynamic: true,
    }
  }
  yield { type: 'tool-approval-request', approvalId: event.callId, toolCallId: event.callId }
}

export async function* translateToUIMessageStream(
  events: AsyncIterable<AgentStreamEvent>,
  opts: { textId: string },
): AsyncGenerator<UIMessageChunk, void, unknown> {
  yield { type: 'start' }
  const state: BlockState = { openBlock: null, reasoningId: null }
  const seenToolCallIds = new Set<string>()
  try {
    for await (const event of events) {
      if (event.type === 'text_delta') {
        if (state.openBlock !== 'text') {
          yield* closeOpenBlock(state, opts.textId)
          yield { type: 'text-start', id: opts.textId }
          state.openBlock = 'text'
        }
        yield { type: 'text-delta', id: opts.textId, delta: event.content }
      } else if (event.type === 'thinking') {
        let reasoningId = state.openBlock === 'reasoning' ? state.reasoningId : null
        if (reasoningId === null) {
          yield* closeOpenBlock(state, opts.textId)
          reasoningId = crypto.randomUUID()
          state.reasoningId = reasoningId
          yield { type: 'reasoning-start', id: reasoningId }
          state.openBlock = 'reasoning'
        }
        yield { type: 'reasoning-delta', id: reasoningId, delta: event.content }
      } else if (event.type === 'tool_call') {
        yield* closeOpenBlock(state, opts.textId)
        yield* emitToolCall(event, seenToolCallIds)
      } else if (event.type === 'approval_required') {
        yield* closeOpenBlock(state, opts.textId)
        yield* emitApprovalRequest(event, seenToolCallIds)
      } else if (event.type === 'tool_result') {
        yield* closeOpenBlock(state, opts.textId)
        yield* emitToolResult(event, seenToolCallIds)
      } else if (event.type === 'error') {
        // Surface the agent-reported failure to the client instead of swallowing
        // it (M0 order: error chunk, then close the open block below, then finish).
        yield { type: 'error', errorText: event.message }
        break
      } else if (event.type === 'done') {
        break
      }
      // Other events (run_started, iteration, …) produce no chunk.
    }
  } catch (err) {
    // The underlying stream aborted/errored. Surface it as an error chunk, then
    // fall through to a graceful close — never throw past the transport.
    yield { type: 'error', errorText: String(err) }
  }
  yield* closeOpenBlock(state, opts.textId)
  yield { type: 'finish' }
}
