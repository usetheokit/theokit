import { UIMessageStreamPresenter } from '@theokit/presenter'
import type { AgentOutputEvent } from '@theokit/presenter'
import { WIRE_APPROVAL_DETAIL_PART } from '@theokit/presenter/wire'
import type { WireChunk as UIMessageChunk } from '@theokit/presenter/wire'

import type { AgentStreamEvent, AgentTurnMetadata, DoneEvent } from './agent-stream-events.js'
import { HitlCallCorrelation } from './hitl-call-correlation.js'

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

/**
 * Project the `done` event's authoritative totals into the finish chunk's metadata.
 *
 * theokit#379 adds `stopReason` to what travels, and usetheokit/theokit#368 adds `model`. Every
 * optional field is spread conditionally rather than assigned as `undefined`: this object IS the
 * `messageMetadata` a client reconstructs onto `UIMessage.metadata`, so a key holding `undefined`
 * would appear on every clean turn. A turn whose producer reported neither therefore produces
 * exactly the metadata it produced before.
 *
 * `model` travels for the same reason `usage` does, one question further on: the token counts say
 * how much was consumed and only the model says what that costs. A span carrying tokens and no
 * model answers "how much" with a number nobody can price.
 */
function doneToMetadata(event: DoneEvent): AgentTurnMetadata {
  return {
    usage: event.usage,
    durationMs: event.durationMs,
    ...(event.cost === undefined ? {} : { cost: event.cost }),
    ...(event.stopReason === undefined ? {} : { stopReason: event.stopReason }),
    ...(event.model === undefined ? {} : { model: event.model }),
  }
}

/** The data-part name carrying the failure `code`. Public in effect: the consumer matches on it. */
export const ERROR_CODE_DATA_PART = 'data-error-code'

/**
 * Data-part names for the three signals theokit#141 restored. Public in effect — a consumer matches
 * on the literal — so they are exported and asserted from the constant, never re-typed at call sites.
 */
export const INPUT_REQUESTED_DATA_PART = 'data-input-requested'
export const TASK_PROGRESS_DATA_PART = 'data-task-progress'
export const SHELL_OUTPUT_DATA_PART = 'data-shell-output'

/**
 * A transient data part. Centralised because the cast is the interesting bit: `UIMessageChunk`'s
 * data variant is keyed on `data-${string}`, which a `const` name does not narrow to on its own.
 * One place to hold the cast beats one per call site.
 */
function dataPart(type: string, data: Record<string, unknown>): UIMessageChunk {
  return { type, data, transient: true } as unknown as UIMessageChunk
}

/**
 * The failure, as chunks the protocol accepts — theokit#161 (B).
 *
 * ## The measured defect
 *
 * M95 put the `code` INSIDE the error chunk (`{type:'error', errorText, errorCode}`), for a good
 * reason: without it a consumer that must DISTINGUISH the failure has only the message, and matching
 * on error text is the heuristic this ecosystem already paid for once — M93 classified failures as
 * transient by regex over the message and read `ECONNREFUSED ...:443` as definitive because the PORT
 * matched its "4xx" pattern.
 *
 * But the `error` variant of ai's `uiMessageChunkSchema` is STRICT: any extra key invalidates it.
 * Measured against `ai@7.0.14` — `{type:'error',errorText:'boom'}` validates; the same chunk with
 * `errorCode` does NOT. So since M95 this path emitted a chunk outside the protocol it claims to
 * speak, and a consumer that validates would reject the whole frame — losing the text along with it.
 *
 * Nobody saw it because the test written to catch exactly this stopped BEFORE validating: its
 * precondition (`toContainEqual({type:'error',errorText:'boom'})`) went stale when `errorCode`
 * appeared, `expect` threw, and the validation loop never ran.
 *
 * ## Why a data part, and not one of the easy exits
 *
 * Dropping the code returns the consumer to the text matching M95 removed. Embedding it in
 * `errorText` is the same thing under another name. The protocol already has the right place — a
 * data part — and this file already uses one for `data-checkpoint`. Measured: it validates.
 *
 * `transient: true` because an error code is turn diagnostics, not message content: the SDK does not
 * persist it in history, which is exactly what we want.
 *
 * The data part comes BEFORE the error chunk deliberately: a sequential consumer already holds the
 * code when the failure arrives. In the other order it would have to handle the error first and only
 * then learn which one it was.
 */
function* errorChunks(errorText: string, code: string | undefined): Generator<UIMessageChunk> {
  if (code !== undefined) yield dataPart(ERROR_CODE_DATA_PART, { code })
  yield { type: 'error', errorText }
}

/**
 * The turn-diagnostic events, as the single data part each becomes — or `null` when the event is
 * not one of them.
 *
 * These are framework variants, so they never entered the presenter's canonical `AgentOutputEvent`
 * (ADR-4). They share one shape — close the open block, emit one transient data part — so they
 * share one function: written as four inline branches in the dispatch loop they pushed
 * `presentUIMessageStream` past both the cyclomatic and cognitive complexity ceilings, and the
 * repetition of `closeBlock()` at each branch was an invitation to forget it at the fifth.
 *
 * `checkpoint_saved` joins them because it always was one of these; only its name predates the
 * pattern. `approval_required` stays inline: it emits THREE chunks (the synthesised tool input, its
 * own detail part, and the gate) and consults presenter state, so it is genuinely a different shape
 * rather than the same one spelled differently.
 */
function diagnosticDataPart(event: AgentStreamEvent): UIMessageChunk | null {
  switch (event.type) {
    case 'checkpoint_saved':
      return dataPart('data-checkpoint', {
        checkpointId: event.checkpointId,
        resumeToken: event.resumeToken,
        step: event.step,
      })
    // theokit#141 — without these cases the three restored events would be dropped by the loop's
    // catch-all, which is the reported defect one layer down: translating an event and never
    // presenting it leaves the consumer just as blind, minus even the warning.
    case 'input_requested':
      return dataPart(INPUT_REQUESTED_DATA_PART, { requestId: event.requestId })
    case 'task_progress':
      return dataPart(TASK_PROGRESS_DATA_PART, {
        ...(event.status !== undefined ? { status: event.status } : {}),
        ...(event.text !== undefined ? { text: event.text } : {}),
      })
    case 'shell_output':
      return dataPart(SHELL_OUTPUT_DATA_PART, { event: event.event })
    default:
      return null
  }
}

/**
 * Reduce a tool event to the ONE id the wire uses for its logical call — usetheokit/theokit#361.
 *
 * A HITL-gated call is announced by whichever of its two producers reaches the wire first (see
 * {@link HitlCallCorrelation}). This folds the other one into that id: `null` means the event is a
 * second announcement of a call already on the wire and must not be emitted again.
 *
 * Non-tool events and ungated tools pass through untouched — the correlation is identity for a call
 * no approval ever claims, which is what keeps the non-HITL wire byte-unchanged.
 */
function correlateToolIds(
  correlation: HitlCallCorrelation,
  output: AgentOutputEvent,
): AgentOutputEvent | null {
  if (output.type === 'tool-call') {
    return correlation.announceToolCall(output.name, output.callId) === 'already-announced'
      ? null
      : output
  }
  if (output.type === 'tool-result') {
    return { ...output, callId: correlation.resultToolCallId(output.name, output.callId) }
  }
  return output
}

export async function* presentUIMessageStream(
  events: AsyncIterable<AgentStreamEvent>,
  opts: { textId: string },
): AsyncGenerator<UIMessageChunk, void, unknown> {
  const presenter = new UIMessageStreamPresenter({ textId: opts.textId })
  const correlation = new HitlCallCorrelation()
  yield { type: 'start' }
  let turnMetadata: AgentTurnMetadata | undefined
  try {
    for await (const event of events) {
      const output = toAgentOutputEvent(event)
      if (output !== null) {
        const correlated = correlateToolIds(correlation, output)
        if (correlated !== null) yield* presenter.present(correlated)
        continue
      }
      if (event.type === 'approval_required') {
        // A framework chunk must not sit inside an open text/reasoning block — close it first (as the
        // original translator did), then synthesize the tool-input (EC-1) once, then the detail part
        // and the approval.
        yield* presenter.closeBlock()
        // #361 — the call this gates, under the id the wire uses for it. That is the runtime's own
        // tool-call id when the SDK already announced it, and the approval id when it did not; the
        // `approvalId` below stays the plugin's, so `approve/${approvalId}` keeps resolving.
        const toolCallId = correlation.approvalToolCallId(event.toolName, event.callId)
        if (!presenter.hasSeen(toolCallId)) {
          presenter.markSeen(toolCallId)
          yield {
            type: 'tool-input-available',
            toolCallId,
            toolName: event.toolName,
            input: event.input ?? {},
            dynamic: true,
          }
        }
        // #394 — the gate says what it is ASKING, and it says it here rather than on the approval
        // frame for the reason `errorChunks` above already documents in full: ai's chunk schema is
        // strict, so a field added to a shared variant does not degrade an ai-sdk client's prompt,
        // it deletes the frame for that client. Same protocol, same right place — a data part.
        //
        // `toolName` and `input` are NOT repeated: the `tool-input-available` above carries them
        // under this same `toolCallId`, and both readers fold the frames into one part.
        //
        // BEFORE the frame it describes, like the error code and for the same reason: a sequential
        // consumer already holds the detail when the thing it describes arrives.
        yield dataPart(WIRE_APPROVAL_DETAIL_PART, {
          approvalId: event.callId,
          question: event.question,
          timeoutMs: event.timeoutMs,
        })
        yield { type: 'tool-approval-request', approvalId: event.callId, toolCallId }
        continue
      }
      const diagnostic = diagnosticDataPart(event)
      if (diagnostic !== null) {
        yield* presenter.closeBlock()
        yield diagnostic
        continue
      }
      if (event.type === 'error') {
        yield* errorChunks(event.message, (event as { code?: string }).code)
        break
      }
      if (event.type === 'done') {
        turnMetadata = doneToMetadata(event)
        break
      }
      // run_started, iteration, partial_tool_call, artifact_*, state_update, file_edit → no web chunk.
    }
  } catch (err) {
    const code = (err as { code?: string }).code
    yield* errorChunks(String(err), typeof code === 'string' ? code : undefined)
  }
  yield* presenter.finish(turnMetadata)
}
