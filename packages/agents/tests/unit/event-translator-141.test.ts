/**
 * theokit#141 — the three signals the translator dropped.
 *
 * PR #159 closed half of this issue: an unrecognised type no longer vanishes without a trace, it
 * warns once. That made the loss VISIBLE; it did not make the signal ARRIVE. Three types are still
 * discarded, and each has a named consequence in the report:
 *
 *   `request`             — "Awaiting user input or approval". On any non-streaming/serving path
 *                           this IS the pause signal. Dropping it means the run blocks and the UI
 *                           shows nothing at all, forever.
 *   `task`                — milestones/summaries. Progress invisibility.
 *   `shell-output-delta`  — live shell output never reaches the UI.
 *
 * ## Why these are NOT mapped onto existing events
 *
 * `approval_required` is the framework's own rich signal, produced by `createHitlPlugin`, and it
 * carries `toolName`, `question`, `callbackUrl` and `timeoutMs` — the fields an approval UI needs to
 * be actionable. The SDK's `request` carries only `request_id`. Mapping one onto the other would
 * force us to invent a tool name and an empty callback URL, and the result is worse than the drop:
 * an approval prompt nobody can answer, which reads as a product bug rather than a missing feature.
 *
 * Likewise, shell output is not `text_delta`. Routing it there would splice command output into the
 * assistant's message, corrupting the very transcript the consumer persists.
 *
 * So each gets its own variant, carrying exactly what the SDK actually provides — no more.
 */
import { describe, expect, it } from 'vitest'

import { translateInteractionUpdate, translateSdkEvent } from '../../src/bridge/event-translator.js'

const RUN = 'run-1'

describe('theokit#141 — `request` reaches the consumer as a pause signal', () => {
  it('test_request_message_surfaces_input_requested_with_the_request_id', () => {
    const events = translateSdkEvent(
      { type: 'request', agent_id: 'a', run_id: RUN, request_id: 'req-7' },
      RUN,
    )
    expect(
      events,
      'the pause signal was dropped — the UI has no way to know the run is blocked',
    ).toEqual([{ type: 'input_requested', requestId: 'req-7' }])
  })

  it('test_request_does_NOT_fabricate_an_approval_required', () => {
    // Guards the design decision, not just the output. `approval_required` drives a UI that must be
    // actionable; synthesizing one from a request_id alone produces a prompt with no tool, no
    // question and no callback — an approval the user cannot possibly answer.
    const events = translateSdkEvent(
      { type: 'request', agent_id: 'a', run_id: RUN, request_id: 'req-7' },
      RUN,
    )
    expect(events.some((e) => e.type === 'approval_required')).toBe(false)
  })
})

describe('theokit#141 — `task` reaches the consumer as progress', () => {
  it('test_task_message_surfaces_status_and_text', () => {
    const events = translateSdkEvent(
      { type: 'task', agent_id: 'a', run_id: RUN, status: 'RUNNING', text: 'indexing repo' },
      RUN,
    )
    expect(events).toEqual([{ type: 'task_progress', status: 'RUNNING', text: 'indexing repo' }])
  })

  it('test_task_with_neither_status_nor_text_is_not_emitted_as_an_empty_event', () => {
    // Both fields are optional in `SDKTaskMessage`. An event carrying nothing is noise on the wire:
    // it costs a frame and tells the consumer nothing it did not already know.
    expect(translateSdkEvent({ type: 'task', agent_id: 'a', run_id: RUN }, RUN)).toEqual([])
  })
})

describe('theokit#141 — `shell-output-delta` reaches the consumer', () => {
  it('test_shell_output_delta_surfaces_the_event_payload', () => {
    const events = translateInteractionUpdate({
      type: 'shell-output-delta',
      event: { stream: 'stdout', data: 'building...' },
    } as never)
    expect(events, 'live shell output never reaches the UI').toEqual([
      { type: 'shell_output', event: { stream: 'stdout', data: 'building...' } },
    ])
  })

  it('test_shell_output_is_NOT_spliced_into_the_assistant_text', () => {
    // The payload is opaque (`Record<string, unknown>` in the SDK), so the layer cannot render it.
    // Routing it through `text_delta` to "show something" would write command output into the
    // assistant message the consumer persists as the transcript.
    const events = translateInteractionUpdate({
      type: 'shell-output-delta',
      event: { data: 'building...' },
    } as never)
    expect(events.some((e) => e.type === 'text_delta')).toBe(false)
  })
})
