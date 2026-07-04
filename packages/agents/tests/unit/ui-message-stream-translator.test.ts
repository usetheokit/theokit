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
 * - Error mid-stream (event OR thrown iterable): SURFACE an ai-sdk error chunk
 *   ({ type:'error', errorText }), close an OPEN text with text-end, then finish;
 *   NEVER throw past the boundary (error-handling.md — surface, don't swallow).
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

  it('test_stream_error_event_surfaces_error_chunk_then_closes_open_text', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'text_delta', content: 'partial' },
      { type: 'error', code: 'provider_error', message: 'boom', retryable: false },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'text-start', id: TEXT_ID },
      { type: 'text-delta', id: TEXT_ID, delta: 'partial' },
      { type: 'error', errorText: 'boom' },
      { type: 'text-end', id: TEXT_ID },
      { type: 'finish' },
    ])
  })

  it('test_thrown_iterable_surfaces_error_chunk_without_throwing', async () => {
    const events: AgentStreamEvent[] = [{ type: 'text_delta', content: 'partial' }]
    // Must NOT reject — the boundary surfaces the underlying stream error as an
    // error chunk and closes the open text gracefully (failure-scenario row).
    const chunks = await collect(
      translateToUIMessageStream(yieldThenThrow(events), { textId: TEXT_ID }),
    )
    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'text-start', id: TEXT_ID },
      { type: 'text-delta', id: TEXT_ID, delta: 'partial' },
      { type: 'error', errorText: 'Error: stream aborted' },
      { type: 'text-end', id: TEXT_ID },
      { type: 'finish' },
    ])
  })

  it('test_error_before_any_text_surfaces_error_chunk_with_no_orphan_text_end', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'error', code: 'provider_error', message: 'boom', retryable: false },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'error', errorText: 'boom' },
      { type: 'finish' },
    ])
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

  it('test_surfaced_error_chunk_validates_against_ui_message_chunk_schema', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'text_delta', content: 'partial' },
      { type: 'error', code: 'provider_error', message: 'boom', retryable: false },
    ]
    const schema = uiMessageChunkSchema()
    const validate = schema.validate
    if (!validate) throw new Error('uiMessageChunkSchema has no validate method')
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    // Prove the run actually produced the error chunk, then validate every chunk.
    expect(chunks).toContainEqual({ type: 'error', errorText: 'boom' })
    for (const chunk of chunks) {
      const result = await validate(chunk)
      expect(result.success, `chunk ${JSON.stringify(chunk)} must validate`).toBe(true)
    }
  })
})

/** Locate the single reasoning-start chunk's minted id (crypto.randomUUID, non-deterministic). */
function reasoningIdOf(chunks: UIMessageChunk[]): string {
  const start = chunks.find((c) => c.type === 'reasoning-start')
  if (!start || !('id' in start)) throw new Error('no reasoning-start chunk found')
  return start.id
}

describe('translateToUIMessageStream — reasoning + open-block state machine (M1 / T1.1)', () => {
  it('test_reasoning_run_emits_one_block', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'thinking', content: 'let me ' },
      { type: 'thinking', content: 'think' },
      {
        type: 'done',
        result: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: 1,
      },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    const rid = reasoningIdOf(chunks)
    // Exactly one reasoning block (single -start/-end) wrapping N deltas (EC-3).
    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'reasoning-start', id: rid },
      { type: 'reasoning-delta', id: rid, delta: 'let me ' },
      { type: 'reasoning-delta', id: rid, delta: 'think' },
      { type: 'reasoning-end', id: rid },
      { type: 'finish' },
    ])
  })

  it('test_text_then_reasoning_closes_text_first', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'text_delta', content: 'hi' },
      { type: 'thinking', content: 'hmm' },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    const rid = reasoningIdOf(chunks)
    // EC-2: the open text block is closed (text-end) before the reasoning block opens.
    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'text-start', id: TEXT_ID },
      { type: 'text-delta', id: TEXT_ID, delta: 'hi' },
      { type: 'text-end', id: TEXT_ID },
      { type: 'reasoning-start', id: rid },
      { type: 'reasoning-delta', id: rid, delta: 'hmm' },
      { type: 'reasoning-end', id: rid },
      { type: 'finish' },
    ])
  })

  it('test_reasoning_then_text_interleaves_three_blocks', async () => {
    // Q1 (Unresolved): text → reasoning → text must produce three closed blocks.
    const events: AgentStreamEvent[] = [
      { type: 'text_delta', content: 'a' },
      { type: 'thinking', content: 'r' },
      { type: 'text_delta', content: 'b' },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    const rid = reasoningIdOf(chunks)
    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'text-start', id: TEXT_ID },
      { type: 'text-delta', id: TEXT_ID, delta: 'a' },
      { type: 'text-end', id: TEXT_ID },
      { type: 'reasoning-start', id: rid },
      { type: 'reasoning-delta', id: rid, delta: 'r' },
      { type: 'reasoning-end', id: rid },
      { type: 'text-start', id: TEXT_ID },
      { type: 'text-delta', id: TEXT_ID, delta: 'b' },
      { type: 'text-end', id: TEXT_ID },
      { type: 'finish' },
    ])
  })

  it('test_done_closes_open_reasoning_block_then_finish', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'thinking', content: 'x' },
      {
        type: 'done',
        result: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: 1,
      },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    const rid = reasoningIdOf(chunks)
    // reasoning-end precedes finish; no orphan open block.
    expect(chunks.slice(-2)).toEqual([{ type: 'reasoning-end', id: rid }, { type: 'finish' }])
  })

  it('test_reasoning_id_is_a_uuid_not_math_random', async () => {
    // G8: id minted via crypto.randomUUID() — assert RFC-4122 v4 shape.
    const events: AgentStreamEvent[] = [{ type: 'thinking', content: 'x' }]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    expect(reasoningIdOf(chunks)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('test_reasoning_chunks_validate_against_ui_message_chunk_schema', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'text_delta', content: 'a' },
      { type: 'thinking', content: 'r' },
      { type: 'text_delta', content: 'b' },
      {
        type: 'done',
        result: '',
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
