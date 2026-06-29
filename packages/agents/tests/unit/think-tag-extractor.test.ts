/**
 * M2 T1.1 — pure incremental `<think>` extractor. The streaming-correctness core: a `<think>` /
 * `</think>` delimiter can straddle a chunk boundary, and a buffered prefix that turns out NOT to
 * be a tag (`<thinkers>`) must be flushed as text (EC-1).
 */
import { describe, expect, it } from 'vitest'

import { createThinkTagExtractor, type Segment } from '../../src/bridge/think-tag-extractor.js'

/** Feed all chunks through one extractor (write each, then end) and collect the flat segment list. */
function run(chunks: string[]): Segment[] {
  const ex = createThinkTagExtractor()
  const out: Segment[] = []
  for (const c of chunks) out.push(...ex.write(c))
  out.push(...ex.end())
  return out
}

describe('createThinkTagExtractor', () => {
  it('test_extractor_passthrough_no_tags', () => {
    expect(run(['hello world'])).toEqual([{ kind: 'text', content: 'hello world' }])
  })

  it('test_extractor_single_think_block', () => {
    expect(run(['<think>reason</think>answer'])).toEqual([
      { kind: 'thinking', content: 'reason' },
      { kind: 'text', content: 'answer' },
    ])
  })

  it('test_extractor_interleaved_think_blocks', () => {
    expect(run(['a<think>r1</think>b<think>r2</think>c'])).toEqual([
      { kind: 'text', content: 'a' },
      { kind: 'thinking', content: 'r1' },
      { kind: 'text', content: 'b' },
      { kind: 'thinking', content: 'r2' },
      { kind: 'text', content: 'c' },
    ])
  })

  it('test_extractor_open_tag_split_across_chunks', () => {
    const ex = createThinkTagExtractor()
    expect(ex.write('a<thi')).toEqual([{ kind: 'text', content: 'a' }]) // '<thi' held as a viable prefix
    expect(ex.write('nk>r</think>z')).toEqual([
      { kind: 'thinking', content: 'r' },
      { kind: 'text', content: 'z' },
    ])
    expect(ex.end()).toEqual([])
  })

  it('test_extractor_close_tag_split_across_chunks', () => {
    const ex = createThinkTagExtractor()
    expect(ex.write('<think>re')).toEqual([{ kind: 'thinking', content: 're' }])
    expect(ex.write('as</thi')).toEqual([{ kind: 'thinking', content: 'as' }]) // '</thi' held
    expect(ex.write('nk>end')).toEqual([{ kind: 'text', content: 'end' }])
  })

  it('test_extractor_unclosed_think_flushed_as_thinking_on_end', () => {
    const ex = createThinkTagExtractor()
    expect(ex.write('x<think>partial')).toEqual([
      { kind: 'text', content: 'x' },
      { kind: 'thinking', content: 'partial' },
    ])
    expect(ex.end()).toEqual([]) // already flushed incrementally; nothing left
  })

  it('test_extractor_unclosed_think_buffered_then_flushed_on_end', () => {
    // When the open tag arrives whole but no content follows in that chunk, end() flushes nothing
    // extra; when content is mid-buffer with a held close-prefix, end() flushes it as thinking.
    const ex = createThinkTagExtractor()
    expect(ex.write('<think>deep</thi')).toEqual([{ kind: 'thinking', content: 'deep' }])
    expect(ex.end()).toEqual([{ kind: 'thinking', content: '</thi' }]) // truncated close held → flushed as thinking
  })

  it('test_extractor_empty_think_block_emits_nothing', () => {
    expect(run(['<think></think>ok'])).toEqual([{ kind: 'text', content: 'ok' }])
  })

  it('test_extractor_lone_lt_is_text', () => {
    expect(run(['a < b </think? c'])).toEqual([{ kind: 'text', content: 'a < b </think? c' }])
  })

  it('test_extractor_adjacent_blocks', () => {
    expect(run(['<think>a</think><think>b</think>'])).toEqual([
      { kind: 'thinking', content: 'a' },
      { kind: 'thinking', content: 'b' },
    ])
  })

  it('test_extractor_unclosed_open_prefix_flushed_as_text', () => {
    // A held OPEN-tag prefix at stream end is text (it never became `<think>`), not thinking.
    const ex = createThinkTagExtractor()
    expect(ex.write('hi<thi')).toEqual([{ kind: 'text', content: 'hi' }]) // '<thi' held
    expect(ex.end()).toEqual([{ kind: 'text', content: '<thi' }]) // flushed as text (still text mode)
  })

  it('test_extractor_close_without_open_stays_text', () => {
    // A stray `</think>` in text mode is just text (text mode only scans for the OPEN tag).
    expect(run(['answer</think>more'])).toEqual([{ kind: 'text', content: 'answer</think>more' }])
  })

  it('test_extractor_partial_tag_prefix_then_mismatch', () => {
    // EC-1: '<thinkers>' is NOT a tag — no thinking is extracted; the text is preserved verbatim.
    // Whole-input ⇒ one segment; split-input ⇒ may chunk into ≥1 text segments (a stream detail),
    // but ALL are text and concatenate back to the original (no content lost, no false thinking).
    expect(run(['a<thinkers>b'])).toEqual([{ kind: 'text', content: 'a<thinkers>b' }])
    const split = run(['a<thin', 'kers>b'])
    expect(split.every((s) => s.kind === 'text')).toBe(true)
    expect(split.map((s) => s.content).join('')).toBe('a<thinkers>b')
  })
})
