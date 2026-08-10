import { describe, expect, it } from 'vitest'

import type { WireChunk } from '../../src/wire/chunk-schema.js'
import { WireFrameTooLargeError, parseWireStream } from '../../src/wire/parse-wire-stream.js'

/** Feed a string as a byte stream, optionally split at arbitrary offsets. */
function byteStream(...pieces: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const p of pieces) controller.enqueue(enc.encode(p))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<WireChunk>): Promise<WireChunk[]> {
  const out: WireChunk[] = []
  for await (const c of stream as unknown as AsyncIterable<WireChunk>) out.push(c)
  return out
}

const frame = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`

describe('parseWireStream — framing SSE', () => {
  it('test_the_done_sentinel_does_not_break_the_stream', async () => {
    // EC-1, the blocker of plan v1.0: `ui-message-stream-response.ts:27` ends EVERY stream with
    // `data: [DONE]\n\n`, and `JSON.parse('[DONE]')` throws. An unguarded parse would fail on the
    // last frame of every single response — not a rare edge, the common path.
    const chunks = await collect(
      parseWireStream(byteStream(frame({ type: 'start' }), 'data: [DONE]\n\n')),
    )
    expect(chunks).toEqual([{ type: 'start' }])
  })

  it('test_invalid_json_is_discarded_without_breaking', async () => {
    const chunks = await collect(
      parseWireStream(byteStream('data: {broken\n\n', frame({ type: 'finish' }))),
    )
    expect(chunks).toEqual([{ type: 'finish' }])
  })

  it('test_crlf_produces_the_same_chunks_as_lf', async () => {
    // EC-2: SSE admits CRLF (WHATWG HTML §9.2). A reverse proxy can rewrite the terminator; without
    // normalising, the buffer never closes an event and the result is TOTAL SILENCE — no error, no
    // render, the worst failure mode available.
    const lf = frame({ type: 'start' }) + frame({ type: 'finish' })
    const crlf = lf.replace(/\n/g, '\r\n')
    expect(await collect(parseWireStream(byteStream(crlf)))).toEqual(
      await collect(parseWireStream(byteStream(lf))),
    )
  })

  it('test_a_lone_cr_is_also_a_terminator', async () => {
    const cr = (frame({ type: 'start' }) + frame({ type: 'finish' })).replace(/\n/g, '\r')
    expect(await collect(parseWireStream(byteStream(cr)))).toHaveLength(2)
  })

  it('test_a_frame_split_across_chunks_is_reassembled', async () => {
    const whole = frame({ type: 'text-delta', id: 't', delta: 'oi' })
    const at = Math.floor(whole.length / 2)
    const chunks = await collect(parseWireStream(byteStream(whole.slice(0, at), whole.slice(at))))
    expect(chunks).toEqual([{ type: 'text-delta', id: 't', delta: 'oi' }])
  })

  it('test_an_sse_comment_is_ignored', async () => {
    const chunks = await collect(
      parseWireStream(byteStream(':heartbeat\n\n', frame({ type: 'start' }))),
    )
    expect(chunks).toEqual([{ type: 'start' }])
  })

  it('test_data_with_and_without_a_space_are_equivalent', async () => {
    const withSpace = await collect(parseWireStream(byteStream('data: {"type":"start"}\n\n')))
    const without = await collect(parseWireStream(byteStream('data:{"type":"start"}\n\n')))
    expect(without).toEqual(withSpace)
  })

  it('test_multiple_data_lines_are_joined_with_a_newline', async () => {
    // EC-9: SSE concatenates consecutive `data:` lines with \n before the payload is read.
    const chunks = await collect(
      parseWireStream(byteStream('data: {"type":"text-delta","id":"t",\ndata: "delta":"oi"}\n\n')),
    )
    expect(chunks).toEqual([{ type: 'text-delta', id: 't', delta: 'oi' }])
  })

  it('test_an_unknown_variant_is_discarded_with_a_warning', async () => {
    const chunks = await collect(
      parseWireStream(byteStream(frame({ type: 'nonexistent' }), frame({ type: 'finish' }))),
    )
    expect(chunks).toEqual([{ type: 'finish' }])
  })

  it('test_a_frame_with_no_terminator_does_not_grow_without_bound', async () => {
    // EC-10: a frame that never terminates must fail with a TYPED error, not consume memory.
    const huge = `data: ${'x'.repeat(200)}`
    const many = Array.from({ length: 60 }, () => huge)
    await expect(
      collect(parseWireStream(byteStream(...many), { maxFrameBytes: 1_000 })),
    ).rejects.toBeInstanceOf(WireFrameTooLargeError)
  })

  it('test_an_empty_stream_produces_zero_chunks', async () => {
    expect(await collect(parseWireStream(byteStream()))).toEqual([])
  })
})

describe('parseWireStream — the error channel is exempt from the leniency (EC-8)', () => {
  it('test_a_malformed_error_is_emitted_and_not_discarded', async () => {
    // EC-8: `{type:'error'}` with no errorText fails the strict shape. If leniency applied, a real
    // 401/429 would be DISCARDED and the turn would settle as `done` — theokit#136 reintroduced
    // through the side door this plan opened. `type` is therefore read BEFORE validation.
    const chunks = await collect(parseWireStream(byteStream(frame({ type: 'error' }))))
    expect(chunks).toEqual([{ type: 'error' }])
  })

  it('test_an_error_with_text_preserves_the_message', async () => {
    const chunks = await collect(
      parseWireStream(byteStream(frame({ type: 'error', errorText: 'no credential' }))),
    )
    expect(chunks).toEqual([{ type: 'error', errorText: 'no credential' }])
  })

  it('test_content_preceding_the_error_is_not_lost', async () => {
    // The parser ENQUEUES the error rather than throwing. Throwing would error the stream, and an
    // errored stream discards its queue — the partial turn the user had already seen would vanish
    // on the way to the error. Measured by `tests/unit/consume-chunk-stream.test.ts`, which asserts
    // the pre-error text survives.
    const chunks = await collect(
      parseWireStream(
        byteStream(
          frame({ type: 'text-start', id: 't' }) +
            frame({ type: 'text-delta', id: 't', delta: 'Hi' }) +
            frame({ type: 'error', errorText: '401' }),
        ),
      ),
    )
    expect(chunks.map((c) => c.type)).toEqual(['text-start', 'text-delta', 'error'])
  })
})

describe('parseWireStream — cancellation propagation', () => {
  it('test_cancelling_the_output_closes_the_input_stream', async () => {
    let cancelled = false
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frame({ type: 'start' })))
      },
      cancel() {
        cancelled = true
      },
    })
    const out = parseWireStream(input)
    const reader = out.getReader()
    await reader.read()
    await reader.cancel()
    expect(cancelled).toBe(true)
  })
})
