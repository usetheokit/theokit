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
  it('test_sentinela_done_nao_derruba_o_stream', async () => {
    // EC-1, the blocker of plan v1.0: `ui-message-stream-response.ts:27` ends EVERY stream with
    // `data: [DONE]\n\n`, and `JSON.parse('[DONE]')` throws. An unguarded parse would fail on the
    // last frame of every single response — not a rare edge, the common path.
    const chunks = await collect(
      parseWireStream(byteStream(frame({ type: 'start' }), 'data: [DONE]\n\n')),
    )
    expect(chunks).toEqual([{ type: 'start' }])
  })

  it('test_json_invalido_e_descartado_sem_derrubar', async () => {
    const chunks = await collect(
      parseWireStream(byteStream('data: {quebrado\n\n', frame({ type: 'finish' }))),
    )
    expect(chunks).toEqual([{ type: 'finish' }])
  })

  it('test_crlf_produz_os_mesmos_chunks_que_lf', async () => {
    // EC-2: SSE admits CRLF (WHATWG HTML §9.2). A reverse proxy can rewrite the terminator; without
    // normalising, the buffer never closes an event and the result is TOTAL SILENCE — no error, no
    // render, the worst failure mode available.
    const lf = frame({ type: 'start' }) + frame({ type: 'finish' })
    const crlf = lf.replace(/\n/g, '\r\n')
    expect(await collect(parseWireStream(byteStream(crlf)))).toEqual(
      await collect(parseWireStream(byteStream(lf))),
    )
  })

  it('test_cr_isolado_tambem_e_terminador', async () => {
    const cr = (frame({ type: 'start' }) + frame({ type: 'finish' })).replace(/\n/g, '\r')
    expect(await collect(parseWireStream(byteStream(cr)))).toHaveLength(2)
  })

  it('test_frame_partido_entre_chunks_e_remontado', async () => {
    const whole = frame({ type: 'text-delta', id: 't', delta: 'oi' })
    const at = Math.floor(whole.length / 2)
    const chunks = await collect(parseWireStream(byteStream(whole.slice(0, at), whole.slice(at))))
    expect(chunks).toEqual([{ type: 'text-delta', id: 't', delta: 'oi' }])
  })

  it('test_comentario_sse_e_ignorado', async () => {
    const chunks = await collect(
      parseWireStream(byteStream(':heartbeat\n\n', frame({ type: 'start' }))),
    )
    expect(chunks).toEqual([{ type: 'start' }])
  })

  it('test_data_com_e_sem_espaco_sao_equivalentes', async () => {
    const withSpace = await collect(parseWireStream(byteStream('data: {"type":"start"}\n\n')))
    const without = await collect(parseWireStream(byteStream('data:{"type":"start"}\n\n')))
    expect(without).toEqual(withSpace)
  })

  it('test_multiplas_linhas_data_sao_concatenadas_com_newline', async () => {
    // EC-9: SSE concatenates consecutive `data:` lines with \n before the payload is read.
    const chunks = await collect(
      parseWireStream(byteStream('data: {"type":"text-delta","id":"t",\ndata: "delta":"oi"}\n\n')),
    )
    expect(chunks).toEqual([{ type: 'text-delta', id: 't', delta: 'oi' }])
  })

  it('test_variante_desconhecida_e_descartada_com_aviso', async () => {
    const chunks = await collect(
      parseWireStream(byteStream(frame({ type: 'inexistente' }), frame({ type: 'finish' }))),
    )
    expect(chunks).toEqual([{ type: 'finish' }])
  })

  it('test_frame_sem_terminador_nao_cresce_sem_limite', async () => {
    // EC-10: a frame that never terminates must fail with a TYPED error, not consume memory.
    const huge = `data: ${'x'.repeat(200)}`
    const many = Array.from({ length: 60 }, () => huge)
    await expect(
      collect(parseWireStream(byteStream(...many), { maxFrameBytes: 1_000 })),
    ).rejects.toBeInstanceOf(WireFrameTooLargeError)
  })

  it('test_stream_vazio_produz_zero_chunks', async () => {
    expect(await collect(parseWireStream(byteStream()))).toEqual([])
  })
})

describe('parseWireStream — o canal de erro é isento da leniência (EC-8)', () => {
  it('test_error_malformado_e_emitido_e_nao_descartado', async () => {
    // EC-8: `{type:'error'}` with no errorText fails the strict shape. If leniency applied, a real
    // 401/429 would be DISCARDED and the turn would settle as `done` — theokit#136 reintroduced
    // through the side door this plan opened. `type` is therefore read BEFORE validation.
    const chunks = await collect(parseWireStream(byteStream(frame({ type: 'error' }))))
    expect(chunks).toEqual([{ type: 'error' }])
  })

  it('test_error_com_texto_preserva_a_mensagem', async () => {
    const chunks = await collect(
      parseWireStream(byteStream(frame({ type: 'error', errorText: 'sem credencial' }))),
    )
    expect(chunks).toEqual([{ type: 'error', errorText: 'sem credencial' }])
  })

  it('test_conteudo_anterior_ao_erro_nao_se_perde', async () => {
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
  it('test_cancelar_a_saida_fecha_o_stream_de_entrada', async () => {
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
