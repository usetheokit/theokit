/**
 * theocode#32 T1.1 — pure incremental tool-dialect stripper. The streaming-correctness core:
 * a leaked Hermes `<function=…></tool_call>` block can straddle a chunk boundary (both the OPEN
 * `<function=` and the CLOSE `</tool_call>`), and an UNCLOSED leak at stream end must be flushed
 * as text (lossless — Rule 8), never silently dropped. Mirrors `think-tag-extractor.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { createToolDialectStripper, type Segment } from '../../src/bridge/tool-dialect-stripper.js'

/** Feed all chunks through one stripper (write each, then end) and collect the flat segment list. */
function run(chunks: string[]): Segment[] {
  const s = createToolDialectStripper()
  const out: Segment[] = []
  for (const c of chunks) out.push(...s.write(c))
  out.push(...s.end())
  return out
}

/** The visible text after stripping = concatenation of every emitted segment's content. */
function visible(chunks: string[]): string {
  return run(chunks)
    .map((seg) => seg.content)
    .join('')
}

describe('createToolDialectStripper', () => {
  it('test_stripper_passthrough_no_leak', () => {
    expect(run(['hello world'])).toEqual([{ kind: 'text', content: 'hello world' }])
  })

  it('test_stripper_strips_full_leak', () => {
    expect(visible(['a<function=w><parameter=p>x</parameter></function></tool_call>b'])).toBe('ab')
  })

  it('test_stripper_open_split_across_chunks', () => {
    // '<func' is held as a viable OPEN prefix across the chunk boundary.
    expect(visible(['a<func', 'tion=w></tool_call>z'])).toBe('az')
  })

  it('test_stripper_close_split_across_chunks', () => {
    // '</tool' is held as a viable CLOSE prefix; only 'end' survives once the leak resolves.
    expect(visible(['<function=w></tool', '_call>end'])).toBe('end')
  })

  it('test_stripper_unclosed_function_flushed_as_text', () => {
    // EC-2/Rule 8: an unclosed `<function=` at end flushes the WHOLE block as text — lossless.
    expect(visible(['x<function=w>partial'])).toBe('x<function=w>partial')
  })

  it('test_stripper_close_without_open_stays_text', () => {
    // text mode only scans for OPEN; a stray `</tool_call>` is plain text.
    expect(visible(['answer</tool_call>more'])).toBe('answer</tool_call>more')
  })

  it('test_stripper_multiple_leaks', () => {
    expect(visible(['a<function=1></tool_call>b<function=2></tool_call>c'])).toBe('abc')
  })

  it('test_stripper_adjacent_leaks', () => {
    // EC-3: zero separator between two leaks — both stripped, only 'tail' surfaces.
    expect(visible(['<function=1></tool_call><function=2></tool_call>tail'])).toBe('tail')
  })

  it('test_stripper_partial_open_prefix_then_mismatch', () => {
    // '<functor>' is NOT the OPEN delimiter `<function=` — nothing stripped, text preserved verbatim.
    expect(visible(['a<functor>b'])).toBe('a<functor>b')
    const split = run(['a<functi', 'on>b']) // '<function' then 'on>b' → never becomes '<function='
    expect(split.every((s) => s.kind === 'text')).toBe(true)
    expect(split.map((s) => s.content).join('')).toBe('a<function>b')
  })

  it('test_stripper_empty_input_emits_nothing', () => {
    expect(run([''])).toEqual([])
  })
})
