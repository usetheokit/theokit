/**
 * M2 T2.1 — `extractThinkTagStream` over a `StreamEvent` stream. Splits `<think>` out of `text_delta`
 * events; passes every other event through unchanged; preserves interleaved order; flushes at end.
 */
import { describe, expect, it } from 'vitest'

import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import { extractThinkTagStream } from '../../src/bridge/think-tag-extractor.js'

async function* from(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const e of events) yield e
}

async function collect(events: StreamEvent[]): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of extractThinkTagStream(from(events))) out.push(e)
  return out
}

describe('extractThinkTagStream', () => {
  it('test_think_stream_passes_through_non_text_events', async () => {
    const input: StreamEvent[] = [
      { type: 'thinking', content: 'native' },
      { type: 'tool_call', callId: 'c1', toolName: 't' },
      { type: 'done', usage: { outputTokens: 1 } },
    ]
    expect(await collect(input)).toEqual(input)
  })

  it('test_think_stream_emits_thinking_events_for_text_delta', async () => {
    expect(await collect([{ type: 'text_delta', content: '<think>r</think>a' }])).toEqual([
      { type: 'thinking', content: 'r' },
      { type: 'text_delta', content: 'a' },
    ])
  })

  it('test_think_stream_splits_tag_across_two_text_deltas', async () => {
    const out = await collect([
      { type: 'text_delta', content: 'a<thi' },
      { type: 'text_delta', content: 'nk>r</think>b' },
    ])
    expect(out).toEqual([
      { type: 'text_delta', content: 'a' },
      { type: 'thinking', content: 'r' },
      { type: 'text_delta', content: 'b' },
    ])
  })

  it('test_think_stream_preserves_interleaved_tool_event_order', async () => {
    const out = await collect([
      { type: 'text_delta', content: 'pre<think>r</think>' },
      { type: 'tool_call', callId: 'X', toolName: 't' },
      { type: 'text_delta', content: 'post' },
    ])
    expect(out).toEqual([
      { type: 'text_delta', content: 'pre' },
      { type: 'thinking', content: 'r' },
      { type: 'tool_call', callId: 'X', toolName: 't' },
      { type: 'text_delta', content: 'post' },
    ])
  })

  it('test_think_stream_flushes_unclosed_thinking_at_end', async () => {
    expect(await collect([{ type: 'text_delta', content: 'x<think>partial' }])).toEqual([
      { type: 'text_delta', content: 'x' },
      { type: 'thinking', content: 'partial' },
    ])
  })

  it('test_think_stream_native_thinking_untouched', async () => {
    // A native {type:'thinking'} event is NOT re-extracted (it is not a text_delta).
    expect(await collect([{ type: 'thinking', content: '<think>not-reparsed</think>' }])).toEqual([
      { type: 'thinking', content: '<think>not-reparsed</think>' },
    ])
  })

  it('test_think_stream_thinking_persists_across_tool_event', async () => {
    // EC-2: the extractor's mode persists across a non-text event splitting a <think> block.
    const out = await collect([
      { type: 'text_delta', content: '<think>r1' },
      { type: 'tool_call', callId: 'X', toolName: 't' },
      { type: 'text_delta', content: 'r2</think>done' },
    ])
    expect(out).toEqual([
      { type: 'thinking', content: 'r1' },
      { type: 'tool_call', callId: 'X', toolName: 't' },
      { type: 'thinking', content: 'r2' },
      { type: 'text_delta', content: 'done' },
    ])
  })

  it('test_think_stream_flushes_buffer_when_source_errors', async () => {
    // Mid-stream source error: the buffered unclosed <think> is flushed (finally) BEFORE the error
    // re-propagates — partial reasoning is surfaced, the error is not swallowed (Rule 8).
    async function* erroring(): AsyncGenerator<StreamEvent> {
      yield { type: 'text_delta', content: 'x<think>partial' }
      throw new Error('boom')
    }
    const out: StreamEvent[] = []
    let caught: unknown
    try {
      for await (const e of extractThinkTagStream(erroring())) out.push(e)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect(out).toEqual([
      { type: 'text_delta', content: 'x' },
      { type: 'thinking', content: 'partial' },
    ])
  })

  it('test_think_stream_handles_nonstring_content', async () => {
    // EC-3: a text_delta with non-string/empty content does not throw + yields no thinking.
    const out = await collect([
      { type: 'text_delta' }, // content undefined
      { type: 'text_delta', content: '' }, // empty
      { type: 'text_delta', content: '<think>r</think>' },
    ])
    expect(out).toEqual([
      { type: 'text_delta' }, // passed through untouched (non-string content)
      { type: 'thinking', content: 'r' },
    ])
  })
})
