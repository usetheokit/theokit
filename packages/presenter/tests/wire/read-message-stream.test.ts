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
    // A `transient` data part and an approval for a call this message never announced both stay
    // out: the first is plumbing, the second names a part that does not exist. Neither becomes a
    // part of its own — an approval is a STATE of the call it gates (see the two tests below), so
    // synthesising a part here would render a prompt for a tool whose name and input nobody has.
    const out = await collect([
      { type: 'start' },
      { type: 'tool-approval-request', approvalId: 'a1', toolCallId: 'never-announced' },
      { type: 'data-checkpoint', data: { handle: 'h' }, transient: true },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'hi' },
    ])
    expect(out.at(-1)?.parts).toHaveLength(1)
  })

  it('test_an_approval_marks_the_call_it_gates_as_awaiting_a_decision', async () => {
    // usetheokit/theokit#392 — the reported defect, as an assertion. The gated tool used to sit in
    // `input-available`, which is what an UNGATED tool looks like while it runs, so no surface could
    // tell "working" from "waiting for you", and the id `approve()` needs was nowhere.
    const out = await collect([
      { type: 'start' },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'send_email',
        input: { to: 'ops@example.com' },
        dynamic: true,
      },
      // What the gate is ASKING rides a transient `data-*` part, not the approval frame: ai's chunk
      // schema is strict and an ai-sdk client drops any frame carrying a key it does not declare
      // (usetheokit/theokit#394, `chunk-schema.ts`). The reader folds the two into one part.
      {
        type: 'data-approval',
        data: { approvalId: 'ap-1', question: 'Send this email?', timeoutMs: 2_000 },
        transient: true,
      },
      { type: 'tool-approval-request', approvalId: 'ap-1', toolCallId: 'c1' },
    ])

    expect(out.at(-1)?.parts).toEqual([
      {
        type: 'dynamic-tool',
        toolName: 'send_email',
        toolCallId: 'c1',
        state: 'approval-requested',
        input: { to: 'ops@example.com' },
        approval: { id: 'ap-1', question: 'Send this email?', timeoutMs: 2_000 },
      },
    ])
  })

  it('test_a_settled_approval_leaves_no_part_awaiting_a_decision', async () => {
    // The other half of the same claim: `approval-requested` is a state the call LEAVES. If it did
    // not, a surface keyed on it would show a prompt for a decision already made, and the store's
    // derived `pendingApprovals` would never empty.
    const out = await collect([
      { type: 'start' },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'send_email',
        input: {},
        dynamic: true,
      },
      { type: 'tool-approval-request', approvalId: 'ap-1', toolCallId: 'c1' },
      { type: 'tool-output-available', toolCallId: 'c1', output: 'sent' },
    ])

    expect(out.at(-2)?.parts[0]).toMatchObject({ state: 'approval-requested' })
    expect(out.at(-1)?.parts[0]).toMatchObject({ state: 'output-available', output: 'sent' })
  })

  it('test_an_approval_without_a_question_carries_only_the_id', async () => {
    // The ai-sdk's own frame carries neither `question` nor `timeoutMs`, and this wire is readable
    // by an ai-sdk server. Absent must mean absent — not a key whose value is `undefined`, which is
    // what a consumer doing `'question' in approval` would trip over.
    const out = await collect([
      { type: 'start' },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'send_email',
        input: {},
        dynamic: true,
      },
      { type: 'tool-approval-request', approvalId: 'ap-1', toolCallId: 'c1' },
    ])

    expect(out.at(-1)?.parts[0]?.approval).toEqual({ id: 'ap-1' })
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
