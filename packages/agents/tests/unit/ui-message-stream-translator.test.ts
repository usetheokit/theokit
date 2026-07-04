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

  it('test_error_event_mid_open_reasoning_surfaces_error_then_closes_reasoning', async () => {
    // Error-path closeOpenBlock must handle the reasoning branch: the error chunk
    // is surfaced FIRST, then the open reasoning block is closed, then finish.
    const events: AgentStreamEvent[] = [
      { type: 'thinking', content: 'let me think' },
      { type: 'error', code: 'provider_error', message: 'boom', retryable: false },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    const rid = reasoningIdOf(chunks)
    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'reasoning-start', id: rid },
      { type: 'reasoning-delta', id: rid, delta: 'let me think' },
      { type: 'error', errorText: 'boom' },
      { type: 'reasoning-end', id: rid },
      { type: 'finish' },
    ])
  })

  it('test_thrown_iterable_mid_open_reasoning_surfaces_error_without_throwing', async () => {
    // catch-path closeOpenBlock closes the open reasoning block; no throw past
    // the boundary. errorText mirrors the thrown-iterable format (String(err)).
    const events: AgentStreamEvent[] = [{ type: 'thinking', content: 'partial reasoning' }]
    const chunks = await collect(
      translateToUIMessageStream(yieldThenThrow(events), { textId: TEXT_ID }),
    )
    const rid = reasoningIdOf(chunks)
    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'reasoning-start', id: rid },
      { type: 'reasoning-delta', id: rid, delta: 'partial reasoning' },
      { type: 'error', errorText: 'Error: stream aborted' },
      { type: 'reasoning-end', id: rid },
      { type: 'finish' },
    ])
  })

  it('test_reasoning_tool_reasoning_produces_two_distinct_blocks', async () => {
    // A tool call closes the reasoning block; the next thinking opens a FRESH one
    // with a distinct id — never two reasoning blocks sharing an id (EC-3).
    const events: AgentStreamEvent[] = [
      { type: 'thinking', content: 'first' },
      { type: 'tool_call', callId: 'c1', toolName: 'search', input: {} },
      { type: 'thinking', content: 'second' },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    const starts = chunks.filter((c) => c.type === 'reasoning-start')
    const ends = chunks.filter((c) => c.type === 'reasoning-end')
    expect(starts).toHaveLength(2)
    expect(ends).toHaveLength(2)
    const firstId = 'id' in starts[0] ? starts[0].id : undefined
    const secondId = 'id' in starts[1] ? starts[1].id : undefined
    expect(firstId).toBeDefined()
    expect(secondId).toBeDefined()
    expect(firstId).not.toBe(secondId)
  })
})

describe('translateToUIMessageStream — tool chunks (M1 / T1.2)', () => {
  it('test_tool_call_then_result_maps_to_input_and_output_available', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'tool_call', callId: 'c1', toolName: 'search', input: { q: 'x' } },
      {
        type: 'tool_result',
        callId: 'c1',
        toolName: 'search',
        output: 'hit',
        durationMs: 3,
        isError: false,
      },
      {
        type: 'done',
        result: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: 1,
      },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    // dynamic:true (EC-1) so the consumer produces a dynamic-tool part whose
    // toolName survives to the parsed part (ui-messages.ts:384-396).
    expect(chunks).toEqual([
      { type: 'start' },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'search',
        input: { q: 'x' },
        dynamic: true,
      },
      { type: 'tool-output-available', toolCallId: 'c1', output: 'hit' },
      { type: 'finish' },
    ])
  })

  it('test_tool_result_error_maps_to_output_error', async () => {
    // EC-4 (negative case): isError:true → tool-output-error with errorText.
    const events: AgentStreamEvent[] = [
      { type: 'tool_call', callId: 'c1', toolName: 'search', input: {} },
      {
        type: 'tool_result',
        callId: 'c1',
        toolName: 'search',
        output: 'boom',
        durationMs: 3,
        isError: true,
      },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    expect(chunks).toEqual([
      { type: 'start' },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'search',
        input: {},
        dynamic: true,
      },
      { type: 'tool-output-error', toolCallId: 'c1', errorText: 'boom' },
      { type: 'finish' },
    ])
  })

  it('test_orphan_tool_result_synthesizes_input_available_first', async () => {
    // EC-1: a tool_result with no preceding tool_call must synthesize
    // tool-input-available first, else the consumer throws
    // (process-ui-message-stream.ts:115 "No tool invocation found").
    const events: AgentStreamEvent[] = [
      {
        type: 'tool_result',
        callId: 'c9',
        toolName: 'lookup',
        output: 'late',
        durationMs: 3,
        isError: false,
      },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    expect(chunks).toEqual([
      { type: 'start' },
      {
        type: 'tool-input-available',
        toolCallId: 'c9',
        toolName: 'lookup',
        input: {},
        dynamic: true,
      },
      { type: 'tool-output-available', toolCallId: 'c9', output: 'late' },
      { type: 'finish' },
    ])
  })

  it('test_tool_after_open_text_closes_text_first', async () => {
    // EC-2: an open text block is closed before the tool chunk is emitted.
    const events: AgentStreamEvent[] = [
      { type: 'text_delta', content: 'thinking about it' },
      { type: 'tool_call', callId: 'c1', toolName: 'search', input: { q: 'x' } },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'text-start', id: TEXT_ID },
      { type: 'text-delta', id: TEXT_ID, delta: 'thinking about it' },
      { type: 'text-end', id: TEXT_ID },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'search',
        input: { q: 'x' },
        dynamic: true,
      },
      { type: 'finish' },
    ])
  })

  it('test_tool_chunks_validate_against_ui_message_chunk_schema', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'tool_call', callId: 'c1', toolName: 'search', input: { q: 'x' } },
      {
        type: 'tool_result',
        callId: 'c1',
        toolName: 'search',
        output: 'hit',
        durationMs: 3,
        isError: false,
      },
      {
        type: 'tool_result',
        callId: 'c2',
        toolName: 'other',
        output: 'err',
        durationMs: 3,
        isError: true,
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

describe('translateToUIMessageStream — HITL approval (M4)', () => {
  it('test_maps_approval_required_to_tool_input_then_approval_request', async () => {
    // A HITL-gated tool pauses BEFORE running: the translator first synthesizes the
    // tool-input part (so the client has a tool to gate), then the ai-sdk-native
    // tool-approval-request chunk referencing the same toolCallId.
    const events: AgentStreamEvent[] = [
      {
        type: 'approval_required',
        callId: 'call-1',
        toolName: 'ops.deploy',
        question: 'Deploy to prod?',
        input: { env: 'prod' },
        callbackUrl: '/api/agents/x/approve/call-1',
        timeoutMs: 300_000,
      },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    expect(chunks).toEqual([
      { type: 'start' },
      {
        type: 'tool-input-available',
        toolCallId: 'call-1',
        toolName: 'ops.deploy',
        input: { env: 'prod' },
        dynamic: true,
      },
      { type: 'tool-approval-request', approvalId: 'call-1', toolCallId: 'call-1' },
      { type: 'finish' },
    ])
  })

  it('test_approval_request_chunk_validates_against_ai_schema', async () => {
    const schema = uiMessageChunkSchema()
    const validate = (schema as { validate?: (c: unknown) => Promise<{ success: boolean }> })
      .validate
    if (!validate) throw new Error('uiMessageChunkSchema has no validate method')
    const events: AgentStreamEvent[] = [
      {
        type: 'approval_required',
        callId: 'c1',
        toolName: 't',
        question: 'ok?',
        callbackUrl: '/x',
        timeoutMs: 1000,
      },
    ]
    const chunks = await collect(translateToUIMessageStream(fromArray(events), { textId: TEXT_ID }))
    for (const chunk of chunks) {
      const result = await validate(chunk)
      expect(result.success, `chunk ${JSON.stringify(chunk)} must validate`).toBe(true)
    }
  })
})
