/**
 * M0 (theokit-ai-first) — translateToUIMessageStream.
 *
 * The translator maps the theokit `AgentStreamEvent` bridge stream (already
 * deduped by mergeDeltaStream) into the Vercel ai-sdk `UIMessageChunk`
 * protocol for TEXT (M0 scope). Sequence contract:
 *
 *   start → text-start{id} → text-delta{id,delta}* → text-end{id} → finish
 *
 * - Empty run (no text_delta): [start, finish] — no orphan text-start/text-end.
 * - Error mid-stream (event OR thrown iterable): close an OPEN text with
 *   text-end, then finish; NEVER throw past the boundary (error-handling.md).
 * - One shared `id` for the whole text block, injected via opts.textId
 *   for determinism (D3).
 *
 * The oracle for chunk shape is ai-sdk's own `uiMessageChunkSchema` (a
 * z.strictObject union — extra keys rejected). We emit ONLY required fields.
 */
import { uiMessageChunkSchema, type UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import type { AgentStreamEvent } from '../../src/bridge/agent-stream-events.js'
import { translateToUIMessageStream } from '../../src/bridge/ui-message-stream-translator.js'

const TEXT_ID = 't0'

async function* fromArray(events: AgentStreamEvent[]): AsyncIterable<AgentStreamEvent> {
  for (const ev of events) yield ev
}

/** Yields the given events, then throws — simulates run.stream() aborting mid-text. */
async function* yieldThenThrow(events: AgentStreamEvent[]): AsyncIterable<AgentStreamEvent> {
  for (const ev of events) yield ev
  throw new Error('stream aborted')
}

async function collect(chunks: AsyncIterable<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = []
  for await (const c of chunks) out.push(c)
  return out
}

describe('translateToUIMessageStream — text (M0)', () => {
  it('test_translates_text_run_to_ordered_chunks', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'run_started', runId: 'r1', agentName: 'echo' },
      { type: 'text_delta', content: 'he' },
      { type: 'text_delta', content: 'llo' },
      {
        type: 'done',
        result: 'hello',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: 1,
      },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'text-start', id: TEXT_ID },
      { type: 'text-delta', id: TEXT_ID, delta: 'he' },
      { type: 'text-delta', id: TEXT_ID, delta: 'llo' },
      { type: 'text-end', id: TEXT_ID },
      { type: 'finish' },
    ])
  })

  it('test_empty_run_emits_start_then_finish', async () => {
    const chunks = await collect(translateToUIMessageStream(fromArray([]), { textId: TEXT_ID }))
    expect(chunks).toEqual([{ type: 'start' }, { type: 'finish' }])
  })

  it('test_run_started_only_emits_no_orphan_text', async () => {
    const events: AgentStreamEvent[] = [{ type: 'run_started', runId: 'r1', agentName: 'echo' }]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    expect(chunks).toEqual([{ type: 'start' }, { type: 'finish' }])
  })

  it('test_stream_error_event_closes_open_text_gracefully', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'text_delta', content: 'partial' },
      { type: 'error', code: 'provider_error', message: 'boom', retryable: false },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'text-start', id: TEXT_ID },
      { type: 'text-delta', id: TEXT_ID, delta: 'partial' },
      { type: 'text-end', id: TEXT_ID },
      { type: 'finish' },
    ])
  })

  it('test_thrown_iterable_closes_open_text_without_throwing', async () => {
    const events: AgentStreamEvent[] = [{ type: 'text_delta', content: 'partial' }]
    // Must NOT reject — the boundary swallows the underlying stream error and
    // closes the open text gracefully (failure-scenario row in the plan).
    const chunks = await collect(
      translateToUIMessageStream(yieldThenThrow(events), { textId: TEXT_ID }),
    )
    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'text-start', id: TEXT_ID },
      { type: 'text-delta', id: TEXT_ID, delta: 'partial' },
      { type: 'text-end', id: TEXT_ID },
      { type: 'finish' },
    ])
  })

  it('test_error_before_any_text_emits_no_orphan_text_end', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'error', code: 'provider_error', message: 'boom', retryable: false },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    expect(chunks).toEqual([{ type: 'start' }, { type: 'finish' }])
  })

  it('test_every_emitted_chunk_validates_against_ui_message_chunk_schema', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'run_started', runId: 'r1', agentName: 'echo' },
      { type: 'text_delta', content: 'Hello, ' },
      { type: 'text_delta', content: 'world' },
      {
        type: 'done',
        result: 'Hello, world',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: 1,
      },
    ]
    const schema = uiMessageChunkSchema()
    const validate = schema.validate
    if (!validate) throw new Error('uiMessageChunkSchema has no validate method')
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    for (const chunk of chunks) {
      const result = await validate(chunk)
      expect(result.success, `chunk ${JSON.stringify(chunk)} must validate`).toBe(true)
    }
  })
})
