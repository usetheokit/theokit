import { describe, expect, it } from 'vitest'

import type { WireChunk } from '../../src/wire/chunk-schema.js'
import { WireStreamError } from '../../src/wire/parse-wire-stream.js'
import { readMessageStream } from '../../src/wire/read-message-stream.js'
import type { WireMessage } from '../../src/wire/types.js'

function chunkStream(chunks: readonly unknown[]): ReadableStream<WireChunk> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c as WireChunk)
      controller.close()
    },
  })
}

async function collect(chunks: readonly unknown[]): Promise<WireMessage[]> {
  const out: WireMessage[] = []
  for await (const m of readMessageStream(chunkStream(chunks))) out.push(m)
  return out
}

describe('readMessageStream — reconstruction', () => {
  it('test_a_snapshot_per_step', () => {
    // N deltas produce N snapshots, not one at the end — that is what lets `useAgent` render while
    // the turn is still streaming.
    return expect(
      collect([
        { type: 'start' },
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'a' },
        { type: 'text-delta', id: 't', delta: 'b' },
        { type: 'text-delta', id: 't', delta: 'c' },
        { type: 'finish' },
      ]),
    ).resolves.toHaveLength(4) // text-start + 3 deltas
  })

  it('test_a_chunk_after_finish_stays_in_the_same_message', async () => {
    // EC-3 flagged the crash (a late chunk met a null message and threw TypeError). The first fix
    // DISCARDED such chunks — which stopped the crash and got the semantics backwards: the oracle
    // keeps appending to the same message after `finish` ('a' + 'B' → 'aB'), and the resumable path
    // (`Last-Event-ID` reconnect) depends on exactly that. Asserting the discard would have frozen
    // a divergence into a test.
    const out = await collect([
      { type: 'start' },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'hi' },
      { type: 'finish' },
      { type: 'text-delta', id: 't', delta: ' late' },
    ])
    expect(out.at(-1)?.parts[0]).toMatchObject({ text: 'hi late' })
  })

  it('test_content_without_start_opens_the_message_implicitly', async () => {
    // The in-process transport pushes `data-message` chunks with no `start`. Requiring one produced
    // zero output for that whole path.
    const out = await collect([
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'sem start' },
    ])
    expect(out.at(-1)?.parts[0]).toMatchObject({ text: 'sem start' })
  })

  it('test_an_error_without_start_rejects_without_crashing', async () => {
    // EC-12: an auth failure lands before any content. The reader must reject with the provider's
    // message, not trip over a null message.
    await expect(collect([{ type: 'error', errorText: 'no credential' }])).rejects.toThrow(
      'no credential',
    )
  })

  it('test_an_error_chunk_rejects_the_stream', async () => {
    // theokit#136 — the whole reason this reader exists rather than `ai`'s default: an error chunk
    // must REJECT. `ai` swallows it unless the caller passes onError + terminateOnError.
    await expect(
      collect([{ type: 'start' }, { type: 'error', errorText: 'rate limited' }]),
    ).rejects.toBeInstanceOf(WireStreamError)
  })

  it('test_an_error_with_no_text_still_rejects_with_a_generic_message', async () => {
    await expect(collect([{ type: 'start' }, { type: 'error' }])).rejects.toThrow(
      'agent stream failed without a message',
    )
  })

  it('test_a_duplicate_start_does_not_lose_the_previous_message', async () => {
    // EC-11: the second `start` must close the message in flight, not silently drop it.
    const out = await collect([
      { type: 'start' },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'first' },
      { type: 'start' },
      { type: 'text-start', id: 't2' },
      { type: 'text-delta', id: 't2', delta: 'second' },
      { type: 'finish' },
    ])
    const texts = out.map((m) => (m.parts[0] as { text?: string } | undefined)?.text)
    expect(texts).toContain('first')
    expect(texts).toContain('second')
  })

  it('test_a_stream_without_finish_does_not_hang', async () => {
    const out = await collect([
      { type: 'start' },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'partial' },
    ])
    expect(out.at(-1)?.parts[0]).toMatchObject({ text: 'partial', state: 'streaming' })
  })

  it('test_finish_without_start_does_not_break', async () => {
    await expect(collect([{ type: 'finish' }])).resolves.toEqual([])
  })

  it('test_a_delta_with_an_unknown_id_is_ignored', async () => {
    const out = await collect([
      { type: 'start' },
      { type: 'text-delta', id: 'never-opened', delta: 'x' },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'ok' },
    ])
    expect(out.at(-1)?.parts).toHaveLength(1)
    expect(out.at(-1)?.parts[0]).toMatchObject({ text: 'ok' })
  })

  it('test_transport_signals_do_not_enter_the_transcript', async () => {
    // `tool-approval-request` and `data-*` are framework signals consumed elsewhere; putting them
    // in the transcript would render protocol plumbing as if it were assistant content.
    const out = await collect([
      { type: 'start' },
      { type: 'tool-approval-request', approvalId: 'a1', toolCallId: 'c1' },
      { type: 'data-checkpoint', data: { handle: 'h' }, transient: true },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'hi' },
    ])
    expect(out.at(-1)?.parts).toHaveLength(1)
  })
})

describe('readMessageStream — cancellation propagation', () => {
  it('test_abandoning_the_for_await_cancels_upstream', async () => {
    let cancelled = false
    const stream = new ReadableStream<WireChunk>({
      start(controller) {
        controller.enqueue({ type: 'start' } as WireChunk)
        controller.enqueue({ type: 'text-start', id: 't' } as WireChunk)
        controller.enqueue({ type: 'text-delta', id: 't', delta: 'a' } as WireChunk)
      },
      cancel() {
        cancelled = true
      },
    })
    for await (const _m of readMessageStream(stream)) break
    expect(cancelled).toBe(true)
  })
})

/**
 * The `finish` chunk's `messageMetadata` reaches the reconstructed message.
 *
 * `remove-ai-dependency` replaced the ai-sdk reader with this one, stating "the FRAME FORMAT is
 * unchanged". The format was; the reconstruction was not. `finish` was dropped whole, and with it
 * a documented behaviour: `@theokit/agents` attaches per-turn usage there so a surface can show
 * real tokens for the turn it just streamed.
 *
 * Nothing tested the field across the swap, so it went silently. Measured in a consumer months
 * later (TheoCode B-090): an assistant message in a live thread had keys `["id","role","parts"]`
 * and no `metadata`, and the TUI's token readout never rendered at all.
 */
describe('finish carries messageMetadata onto the message', () => {
  const usage = { usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 }, durationMs: 940 }

  it('lands_the_metadata_on_the_final_snapshot', async () => {
    const out = await collect([
      { type: 'start', messageId: 'm1' },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'hi' },
      { type: 'text-end', id: 't' },
      { type: 'finish', messageMetadata: usage },
    ])
    expect(out.at(-1)?.metadata).toEqual(usage)
  })

  it('emits_a_snapshot_because_finish_is_usually_last', async () => {
    // The reason attaching alone is not enough: nothing is emitted after the stream ends, so a
    // silent attach would leave the field unreachable by every consumer.
    const withMeta = await collect([
      { type: 'text-delta', id: 't', delta: 'hi' },
      { type: 'finish', messageMetadata: usage },
    ])
    const withoutMeta = await collect([
      { type: 'text-delta', id: 't', delta: 'hi' },
      { type: 'finish' },
    ])
    expect(withMeta.length).toBe(withoutMeta.length + 1)
  })

  it('a_metadata_free_finish_still_emits_nothing', async () => {
    // The measured behaviour every differential case rests on. Widening it unconditionally would
    // change snapshot counts for every existing consumer.
    const out = await collect([
      { type: 'start', messageId: 'm1' },
      { type: 'text-delta', id: 't', delta: 'hi' },
      { type: 'finish' },
    ])
    expect(out.at(-1)?.metadata).toBeUndefined()
  })

  it('finish_still_does_not_close_the_message', async () => {
    // The resumable path depends on it: a chunk after `finish` keeps appending to the same message.
    const out = await collect([
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'a' },
      { type: 'finish', messageMetadata: usage },
      { type: 'text-delta', id: 't', delta: 'B' },
    ])
    const last = out.at(-1)
    expect(JSON.stringify(last?.parts)).toContain('aB')
    expect(last?.metadata).toEqual(usage)
  })
})
