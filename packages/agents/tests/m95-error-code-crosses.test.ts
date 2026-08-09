/**
 * M95 — o `code` do sdkEvent atravessa até o chunk.
 *
 * Um sdkEvent de runtime não sobe como exceção para quem consome o stream: ele é convertido num chunk
 * `{type:'error', errorText}`. Isso é o contrato de streaming, e está certo — mas até aqui o chunk
 * carregava **só o texto**, então um consumidor que precise DISTINGUIR a falha (o `exec` forkando
 * quando a sessão já tem escritor) só tinha a mensagem para casar.
 *
 * Casar texto de sdkEvent é a heurística que este ecossistema já pagou caro: o M93 classificava
 * transitório por regex sobre a mensagem, e tratava `connect ECONNREFUSED 127.0.0.1:443` como
 * definitivo porque a **porta** casava o padrão de "4xx". `RunErrorDetail` sempre teve `code`.
 */
import { describe, expect, it } from 'vitest'
import {
  ERROR_CODE_DATA_PART,
  presentUIMessageStream,
} from '../src/bridge/present-ui-message-stream.js'
import { sdkErrorEvent } from '../src/bridge/sdk-error.js'

interface Chunk {
  type: string
  errorText?: string
  data?: { code?: string }
}

/**
 * The failure `code`, read the way a consumer reads it — theokit#161 (B).
 *
 * It used to ride inside the error chunk as `errorCode`. That shape is REJECTED by ai's
 * `uiMessageChunkSchema` (the `error` variant is strict), so it now travels as its own data part
 * emitted just before the error. What M95 asserts is unchanged and still asserted here: the code
 * reaches the consumer, so nobody has to match on error text. Only the carrier moved.
 */
function errorCodeOf(chunks: Chunk[]): string | undefined {
  return chunks.find((c) => c.type === ERROR_CODE_DATA_PART)?.data?.code
}

async function chunksDe(eventos: unknown[]): Promise<Chunk[]> {
  const source = (async function* () {
    for (const e of eventos) yield e
  })()
  const out: Chunk[] = []
  for await (const c of presentUIMessageStream(source as never, { textId: 't' }))
    out.push(c as Chunk)
  return out
}

describe('M95 — the error code reaches the consumer', () => {
  it('an error WITH a code delivers errorCode alongside the text', async () => {
    const chunks = await chunksDe([
      {
        type: 'error',
        message: 'another process is already writing this session',
        code: 'session_busy',
      },
    ])
    const sdkEvent = chunks.find((c) => c.type === 'error')
    expect(
      errorCodeOf(chunks),
      'the code did not cross — the consumer would have to match text',
    ).toBe('session_busy')
    expect(sdkEvent?.errorText).toContain('already writing')
    // The code must NOT be back inside the error chunk: that shape fails ai's strict schema, and a
    // consumer validating chunks would reject the failure entirely — losing the text with it.
    expect(sdkEvent).toEqual({ type: 'error', errorText: sdkEvent?.errorText })
    // Ordering is contract, not accident: a sequential consumer must already hold the code when the
    // error arrives, otherwise it has to handle the failure before learning which one it was.
    expect(chunks.findIndex((c) => c.type === ERROR_CODE_DATA_PART)).toBeLessThan(
      chunks.findIndex((c) => c.type === 'error'),
    )
  })

  it('an error WITHOUT a code stays exactly as before', async () => {
    const chunks = await chunksDe([{ type: 'error', message: 'any failure' }])
    const sdkEvent = chunks.find((c) => c.type === 'error')
    expect(sdkEvent?.errorText).toBe('any failure')
    expect(
      errorCodeOf(chunks),
      'a code was invented for a failure that carries none',
    ).toBeUndefined()
    expect(
      chunks.some((c) => c.type === ERROR_CODE_DATA_PART),
      'an empty data part was emitted for a codeless failure — noise on the wire',
    ).toBe(false)
  })
})

describe('M95 — the PRODUCER preserves the code (the stage where it used to die)', () => {
  it('an SDK error with a code reaches the sdkEvent as that code, not as SDK_ERROR', () => {
    // The tests above assert the SECOND stage of the pipeline, feeding the sdkEvent by hand. The
    // adversarial review measured that this proves nothing about the first: `sdk-adapter.ts` dropped
    // the code and emitted `SDK_ERROR`, and the previous fix landed one stage AFTER where the
    // information dies. This test exercises the producer.
    const err = Object.assign(new Error('another process is already writing this session'), {
      name: 'SessionBusyError',
      code: 'session_busy',
      isRetryable: false,
    })
    const sdkEvent = sdkErrorEvent(err)
    expect(sdkEvent?.code, 'the producer flattened the code into SDK_ERROR').toBe('session_busy')
    expect(sdkEvent?.retryable, 'retryable was pinned to false, contradicting the error').toBe(
      false,
    )
  })

  it('a transient error preserves both code AND retryable', () => {
    const err = Object.assign(new Error('rate limited'), {
      name: 'RateLimitError',
      code: 'rate_limit',
      isRetryable: true,
    })
    const sdkEvent = sdkErrorEvent(err)
    expect(sdkEvent?.code).toBe('rate_limit')
    expect(sdkEvent?.retryable).toBe(true)
  })

  it('an error WITHOUT a code still becomes SDK_ERROR — compatibility preserved', () => {
    const sdkEvent = sdkErrorEvent(new Error('a raw failure'))
    expect(sdkEvent?.code).toBe('SDK_ERROR')
  })
})
