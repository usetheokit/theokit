/**
 * theokit#141, second layer — translating the event is only half the trip.
 *
 * `translateSdkEvent` now produces `input_requested`, `task_progress` and `shell_output`. But
 * `presentUIMessageStream` ends its dispatch with a catch-all that emits nothing for any event it
 * does not name, so a variant added upstream is dropped one layer down — silently, and this time
 * with no warning at all, because the warning lives in the translator.
 *
 * That is the same defect the issue reports, moved rather than fixed. These tests pin the whole
 * trip: SDK message in, web chunk out.
 *
 * The chunks are data parts, like `data-checkpoint` already is in this file, and `transient: true`
 * because all three are turn diagnostics rather than message content — the SDK does not persist
 * them in the conversation history, which is what we want for a pause notice, a progress line and
 * shell output.
 */
import { describe, expect, it } from 'vitest'
import { uiMessageChunkSchema, type UIMessageChunk } from 'ai'

import type { AgentStreamEvent } from '../../src/bridge/agent-stream-events.js'
import {
  DATA_PART_DO_INPUT_REQUESTED,
  DATA_PART_DO_SHELL_OUTPUT,
  DATA_PART_DO_TASK_PROGRESS,
  presentUIMessageStream,
} from '../../src/bridge/present-ui-message-stream.js'

async function* fromArray(events: AgentStreamEvent[]): AsyncIterable<AgentStreamEvent> {
  for (const ev of events) yield ev
}

async function collect(events: AgentStreamEvent[]): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = []
  for await (const c of presentUIMessageStream(fromArray(events), { textId: 't0' })) out.push(c)
  return out
}

describe('theokit#141 — the three signals survive the presenter', () => {
  it('test_input_requested_reaches_the_web_consumer', async () => {
    const chunks = await collect([{ type: 'input_requested', requestId: 'req-7' }])
    expect(
      chunks,
      'the pause signal died in the presenter — the UI still shows a silent hang',
    ).toContainEqual({
      type: DATA_PART_DO_INPUT_REQUESTED,
      data: { requestId: 'req-7' },
      transient: true,
    })
  })

  it('test_task_progress_reaches_the_web_consumer', async () => {
    const chunks = await collect([
      { type: 'task_progress', status: 'RUNNING', text: 'indexing repo' },
    ])
    expect(chunks).toContainEqual({
      type: DATA_PART_DO_TASK_PROGRESS,
      data: { status: 'RUNNING', text: 'indexing repo' },
      transient: true,
    })
  })

  it('test_shell_output_reaches_the_web_consumer', async () => {
    const chunks = await collect([
      { type: 'shell_output', event: { stream: 'stdout', data: 'building...' } },
    ])
    expect(chunks).toContainEqual({
      type: DATA_PART_DO_SHELL_OUTPUT,
      data: { event: { stream: 'stdout', data: 'building...' } },
      transient: true,
    })
  })

  it('test_a_signal_mid_text_does_not_corrupt_the_open_block', async () => {
    // A framework chunk must not sit inside an open text block — the same rule `approval_required`
    // and `checkpoint_saved` already follow here. Without the close, the consumer reconstructs a
    // text part with a foreign frame spliced into the middle of it.
    const chunks = await collect([
      { type: 'text_delta', content: 'partial' },
      { type: 'shell_output', event: { data: 'x' } },
      {
        type: 'done',
        result: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: 1,
      },
    ])
    const iShell = chunks.findIndex((c) => c.type === DATA_PART_DO_SHELL_OUTPUT)
    const iEnd = chunks.findIndex((c) => c.type === 'text-end')
    expect(iEnd, 'the open text block was never closed').toBeGreaterThanOrEqual(0)
    expect(iEnd, 'the data part landed INSIDE the open text block').toBeLessThan(iShell)
  })

  it('test_every_emitted_chunk_validates_against_the_ai_schema', async () => {
    // The oracle that #161 (B) proved this layer needs: ai's chunk schema is strict, and a shape it
    // rejects makes a validating consumer discard the frame entirely.
    const validate = uiMessageChunkSchema().validate
    if (!validate) throw new Error('uiMessageChunkSchema has no validate method')
    const chunks = await collect([
      { type: 'input_requested', requestId: 'req-7' },
      { type: 'task_progress', status: 'RUNNING', text: 'indexing' },
      { type: 'shell_output', event: { data: 'x' } },
    ])
    for (const chunk of chunks) {
      const result = await validate(chunk)
      expect(result.success, `chunk ${JSON.stringify(chunk)} must validate`).toBe(true)
    }
  })
})
