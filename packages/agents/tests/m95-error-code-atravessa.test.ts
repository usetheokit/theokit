/**
 * M95 — o `code` do erro atravessa até o chunk.
 *
 * Um erro de runtime não sobe como exceção para quem consome o stream: ele é convertido num chunk
 * `{type:'error', errorText}`. Isso é o contrato de streaming, e está certo — mas até aqui o chunk
 * carregava **só o texto**, então um consumidor que precise DISTINGUIR a falha (o `exec` forkando
 * quando a sessão já tem escritor) só tinha a mensagem para casar.
 *
 * Casar texto de erro é a heurística que este ecossistema já pagou caro: o M93 classificava
 * transitório por regex sobre a mensagem, e tratava `connect ECONNREFUSED 127.0.0.1:443` como
 * definitivo porque a **porta** casava o padrão de "4xx". `RunErrorDetail` sempre teve `code`.
 */
import { describe, expect, it } from 'vitest'
import { presentUIMessageStream } from '../src/bridge/present-ui-message-stream.js'
import { eventoDeErroDoSdk } from '../src/bridge/sdk-adapter.js'

interface Chunk {
  type: string
  errorText?: string
  errorCode?: string
}

async function chunksDe(eventos: unknown[]): Promise<Chunk[]> {
  const fonte = (async function* () {
    for (const e of eventos) yield e
  })()
  const out: Chunk[] = []
  for await (const c of presentUIMessageStream(fonte as never, { textId: 't' })) out.push(c as Chunk)
  return out
}

describe('M95 — o code do erro chega ao consumidor', () => {
  it('um erro COM code entrega errorCode junto do texto', async () => {
    const chunks = await chunksDe([
      { type: 'error', message: 'another process is already writing this session', code: 'session_busy' },
    ])
    const erro = chunks.find((c) => c.type === 'error')
    expect(erro?.errorCode, 'o code não atravessou — o consumidor teria de casar texto').toBe(
      'session_busy',
    )
    expect(erro?.errorText).toContain('already writing')
  })

  it('um erro SEM code continua exatamente como antes', async () => {
    const chunks = await chunksDe([{ type: 'error', message: 'falha qualquer' }])
    const erro = chunks.find((c) => c.type === 'error')
    expect(erro?.errorText).toBe('falha qualquer')
    expect(erro?.errorCode).toBeUndefined()
  })
})

describe('M95 — o PRODUTOR preserva o code (o estágio onde ele morria)', () => {
  it('um erro do SDK com code chega ao evento como esse code, não como SDK_ERROR', () => {
    // Os testes acima afirmam o SEGUNDO estágio do pipeline, alimentando o evento à mão. A revisão
    // adversarial mediu que isso não prova nada sobre o primeiro: `sdk-adapter.ts` descartava o
    // code e emitia `SDK_ERROR`, e a correção anterior pousou um estágio DEPOIS de onde a
    // informação morre. Este teste exerce o produtor.
    const erro = Object.assign(new Error('another process is already writing this session'), {
      name: 'SessionBusyError',
      code: 'session_busy',
      isRetryable: false,
    })
    const err = eventoDeErroDoSdk(erro)
    expect(err?.code, 'o produtor achatou o code para SDK_ERROR').toBe('session_busy')
    expect(err?.retryable, 'retryable foi fixado em false, contradizendo o erro').toBe(false)
  })

  it('um erro transitório preserva code E retryable', () => {
    const erro = Object.assign(new Error('rate limited'), {
      name: 'RateLimitError',
      code: 'rate_limit',
      isRetryable: true,
    })
    const err = eventoDeErroDoSdk(erro)
    expect(err?.code).toBe('rate_limit')
    expect(err?.retryable).toBe(true)
  })

  it('um erro SEM code continua virando SDK_ERROR — compatibilidade preservada', () => {
    const err = eventoDeErroDoSdk(new Error('falha crua'))
    expect(err?.code).toBe('SDK_ERROR')
  })
})
