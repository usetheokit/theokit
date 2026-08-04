import { describe, expect, it } from 'vitest'

import { ApprovalAbortedError, InProcessTransport } from '../../src/client/in-process-transport.js'

/**
 * M92 T3.1 — a aprovação estacionada num turno abortado para de pendurar a chamada de tool.
 *
 * ## O defeito
 *
 * `#pending` guardava só o `resolve`, e nada apagava a entrada quando o turno abortava. A promessa
 * ficava pendente **para sempre** e a chamada de tool do SDK pendurava com ela.
 *
 * Uma promessa que nunca resolve **nem** rejeita é a forma mais silenciosa de engolir um erro: não há
 * `catch` que a veja, não há stack trace, não há timeout. `error-handling.md § 2` proíbe engolir; este
 * caso era pior que um `catch {}`, porque um `catch {}` ao menos deixa rastro no código.
 *
 * ## Por que REJEITAR e não `resolve(false)`
 *
 * `false` é indistinguível de *"o usuário negou"*. Negar é decisão; abortar é interrupção. O SDK
 * precisa das duas para desenrolar a chamada corretamente, e um consumidor que registra decisões
 * gravaria uma negação que nunca houve.
 */
describe('M92 — o transporte in-process evicta aprovação de turno abortado', () => {
  const montar = (): {
    transporte: InProcessTransport
    aprovar: () => Promise<unknown>
    abortar: () => void
  } => {
    let estacionar: (() => Promise<unknown>) | undefined
    const controller = new AbortController()
    const transporte = new InProcessTransport({
      run: (opts: { awaitApproval: (r: { approvalId: string }) => Promise<unknown> }) => {
        estacionar = () => opts.awaitApproval({ approvalId: 'ap-1' })
        return (async function* () {
          await new Promise(() => undefined)
          yield undefined as never
        })()
      },
    } as never)
    void transporte.sendMessages({
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'oi' }] }],
      abortSignal: controller.signal,
    } as never)
    return {
      transporte,
      aprovar: () => estacionar!(),
      abortar: () => {
        controller.abort()
      },
    }
  }

  it('abort REJEITA a aprovacao estacionada com erro TIPADO', async () => {
    const { aprovar, abortar } = montar()
    const p = aprovar()
    abortar()
    await expect(p).rejects.toBeInstanceOf(ApprovalAbortedError)
  })

  it('a entrada e EVICTADA — nao fica vazando no Map', async () => {
    const { transporte, aprovar, abortar } = montar()
    const p = aprovar()
    expect(transporte.pendentes).toBe(1)
    abortar()
    await expect(p).rejects.toThrow()
    expect(transporte.pendentes).toBe(0)
  })

  it('o erro nomeia a aprovacao e o motivo — diagnostic, nao so o tipo', async () => {
    const { aprovar, abortar } = montar()
    const p = aprovar()
    abortar()
    await expect(p).rejects.toThrow(/ap-1/)
    await expect(p).rejects.toThrow(/abortado/)
  })

  it('aprovacao DECIDIDA continua distinta de abortada', async () => {
    const { transporte, aprovar } = montar()
    const p = aprovar()
    await transporte.approve('ap-1', 'approve' as never)
    await expect(p).resolves.toBe('approve')
  })

  it('um send() NOVO varre o turno anterior', async () => {
    const { transporte, aprovar } = montar()
    const p = aprovar()
    expect(transporte.pendentes).toBe(1)
    void transporte.sendMessages({
      messages: [{ id: 'u2', role: 'user', parts: [{ type: 'text', text: 'de novo' }] }],
    } as never)
    await expect(p).rejects.toBeInstanceOf(ApprovalAbortedError)
    expect(transporte.pendentes).toBe(0)
  })
})

/**
 * M92 — os três furos que a revisão adversarial mediu, cada um com o cenário que o expõe.
 *
 * Nenhum é hipotético: o revisor rodou os três e reportou o estado observado.
 */
describe('M92 — furos da primeira versão da eviction', () => {
  const montarCom = (opts: { jaAbortado?: boolean } = {}) => {
    let estacionar: ((id?: string) => Promise<unknown>) | undefined
    const controller = new AbortController()
    if (opts.jaAbortado === true) controller.abort()
    const transporte = new InProcessTransport({
      run: (o: { awaitApproval: (r: { approvalId: string }) => Promise<unknown> }) => {
        estacionar = (id = 'ap-1') => o.awaitApproval({ approvalId: id })
        return (async function* () {
          await new Promise(() => undefined)
          yield undefined as never
        })()
      },
    } as never)
    void transporte.sendMessages({
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'oi' }] }],
      abortSignal: controller.signal,
    } as never)
    return {
      transporte,
      estacionar: (id?: string) => estacionar!(id),
      abortar: () => {
        controller.abort()
      },
    }
  }

  it('SINAL JA ABORTADO — a aprovacao nao fica pendurada', async () => {
    // `addEventListener('abort')` NÃO dispara num sinal que já abortou. Sem a checagem, a promessa
    // ficava pendente para sempre — o travamento que o milestone existe para fechar, ainda alcançável.
    const { transporte, estacionar } = montarCom({ jaAbortado: true })
    const p = estacionar()
    await expect(p).rejects.toBeInstanceOf(ApprovalAbortedError)
    expect(transporte.pendentes).toBe(0)
  })

  it('o turno e capturado no SEND — runner ANTIGO estacionando depois de um send novo', async () => {
    // O cenário que distingue, e que a primeira versão deste teste NÃO exercitava: guardar o
    // `awaitApproval` do runner do turno 1 e usá-lo **depois** do `send` do turno 2.
    //
    // Lendo `#turno` no momento da aprovação, essa entrada era etiquetada turno 2 — e o abort do turno
    // 1 não a varria. A revisão do M92 mediu `pendentes=1` nesse estado. Capturando no `send`, ela
    // nasce etiquetada turno 1 e o abort correspondente a alcança.
    const runners: ((id: string) => Promise<unknown>)[] = []
    const c1 = new AbortController()
    const transporte = new InProcessTransport({
      run: (o: { awaitApproval: (r: { approvalId: string }) => Promise<unknown> }) => {
        runners.push((id) => o.awaitApproval({ approvalId: id }))
        return (async function* () {
          await new Promise(() => undefined)
          yield undefined as never
        })()
      },
    } as never)
    void transporte.sendMessages({
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'um' }] }],
      abortSignal: c1.signal,
    } as never)
    // Turno 2 começa ANTES de o runner do turno 1 estacionar.
    void transporte.sendMessages({
      messages: [{ id: 'u2', role: 'user', parts: [{ type: 'text', text: 'dois' }] }],
    } as never)
    const doTurno1 = runners[0]!('ap-do-turno-1')
    expect(transporte.pendentes).toBe(1)
    // O abort do turno 1 tem de alcançá-la. Se a etiqueta fosse do turno 2, isto penduraria.
    c1.abort()
    await expect(doTurno1).rejects.toBeInstanceOf(ApprovalAbortedError)
  })

  it('a rejeicao NAO derruba o processo quando ninguem trata — ha handler', async () => {
    // Node ≥ 15 sai em `unhandledRejection`. Antes do M92 a promessa pendurava; depois, se ninguém a
    // aguardasse, ela poderia MATAR o processo — trocar um travamento por um crash não é conserto.
    const { transporte, estacionar, abortar } = montarCom()
    const abandonada = estacionar('ap-abandonada')
    abandonada.catch(() => undefined) // é o que um runner que desiste faria
    abortar()
    await new Promise((r) => setTimeout(r, 10))
    expect(transporte.pendentes).toBe(0)
  })
})
