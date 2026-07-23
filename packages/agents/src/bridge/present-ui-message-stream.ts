
import { UIMessageStreamPresenter } from '@theokit/presenter'
import type { AgentOutputEvent } from '@theokit/presenter'
import type { UIMessageChunk } from 'ai'

import type { AgentStreamEvent, AgentTurnMetadata, DoneEvent } from './agent-stream-events.js'

/**
 * M49 — the web surface, composed over `@theokit/presenter`. Replaces the inline `translateToUIMessageStream`.
 *
 * The PURE-OUTPUT variants of `AgentStreamEvent` map to the canonical `AgentOutputEvent` and are rendered
 * by the shared {@link UIMessageStreamPresenter} (the single source of the UIMessageChunk state machine,
 * reused by every surface). The FRAMEWORK variants that only the web/devtools path has — HITL
 * `approval_required`, `checkpoint_saved` — are composed INLINE here (ADR-4: they are not pure agent
 * output, so they never entered the presenter's canonical event). Behavior is byte-identical to the
 * original translator (proven by `present-ui-message-stream.test.ts`).
 */

/** Map a pure-output `AgentStreamEvent` to the canonical event, or `null` for framework/no-output variants. */
function toAgentOutputEvent(e: AgentStreamEvent): AgentOutputEvent | null {
  switch (e.type) {
    case 'text_delta':
      return { type: 'text', text: e.content }
    case 'thinking':
      return { type: 'reasoning', text: e.content }
    case 'tool_call':
      return { type: 'tool-call', callId: e.callId, name: e.toolName, input: e.input }
    case 'tool_result':
      return {
        type: 'tool-result',
        callId: e.callId,
        name: e.toolName,
        result: e.output,
        isError: e.isError,
      }
    default:
      return null
  }
}

/** Project the `done` event's authoritative totals into the finish chunk's metadata (unchanged from M1). */
function doneToMetadata(event: DoneEvent): AgentTurnMetadata {
  return event.cost === undefined
    ? { usage: event.usage, durationMs: event.durationMs }
    : { usage: event.usage, durationMs: event.durationMs, cost: event.cost }
}

export async function* presentUIMessageStream(
  events: AsyncIterable<AgentStreamEvent>,
  opts: { textId: string },
): AsyncGenerator<UIMessageChunk, void, unknown> {
  const presenter = new UIMessageStreamPresenter({ textId: opts.textId })
  yield { type: 'start' }
  let turnMetadata: AgentTurnMetadata | undefined
  try {
    for await (const event of events) {
      const output = toAgentOutputEvent(event)
      if (output !== null) {
        yield* presenter.present(output)
        continue
      }
      if (event.type === 'approval_required') {
        // A framework chunk must not sit inside an open text/reasoning block — close it first (as the
        // original translator did), then synthesize the tool-input (EC-1) once, then the approval.
        yield* presenter.closeBlock()
        if (!presenter.hasSeen(event.callId)) {
          presenter.markSeen(event.callId)
          yield {
            type: 'tool-input-available',
            toolCallId: event.callId,
            toolName: event.toolName,
            input: event.input ?? {},
            dynamic: true,
          }
        }
        yield { type: 'tool-approval-request', approvalId: event.callId, toolCallId: event.callId }
        continue
      }
      if (event.type === 'checkpoint_saved') {
        yield* presenter.closeBlock()
        yield {
          type: 'data-checkpoint',
          data: {
            checkpointId: event.checkpointId,
            resumeToken: event.resumeToken,
            step: event.step,
          },
          transient: true,
        }
        continue
      }
      if (event.type === 'error') {
        yield { type: 'error', errorText: event.message }
        break
      }
      if (event.type === 'done') {
        turnMetadata = doneToMetadata(event)
        break
      }
      // run_started, iteration, partial_tool_call, artifact_*, state_update, file_edit → no web chunk.
    }
  } catch (err) {
    yield { type: 'error', errorText: String(err) }
  }
  yield* presenter.finish(turnMetadata)
}
