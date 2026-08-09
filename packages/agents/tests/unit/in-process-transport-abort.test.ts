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
describe('M92 — the in-process transport evicts approvals from an aborted turn', () => {
  const build = (): {
    transporte: InProcessTransport
    aprovar: () => Promise<unknown>
    abortar: () => void
  } => {
    let park: (() => Promise<unknown>) | undefined
    const controller = new AbortController()
    const transporte = new InProcessTransport({
      run: (opts: { awaitApproval: (r: { approvalId: string }) => Promise<unknown> }) => {
        park = () => opts.awaitApproval({ approvalId: 'ap-1' })
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
      aprovar: () => park!(),
      abortar: () => {
        controller.abort()
      },
    }
  }

  it('abort REJECTS the parked approval with a TYPED error', async () => {
    const { aprovar, abortar } = build()
    const p = aprovar()
    abortar()
    await expect(p).rejects.toBeInstanceOf(ApprovalAbortedError)
  })

  it('the entry is EVICTED — it does not leak in the Map', async () => {
    const { transporte, aprovar, abortar } = build()
    const p = aprovar()
    expect(transporte.pendentes).toBe(1)
    abortar()
    await expect(p).rejects.toThrow()
    expect(transporte.pendentes).toBe(0)
  })

  it('the error names the approval and the reason — diagnostic, not just the type', async () => {
    const { aprovar, abortar } = build()
    const p = aprovar()
    abortar()
    await expect(p).rejects.toThrow(/ap-1/)
    await expect(p).rejects.toThrow(/abortado/)
  })

  it('a DECIDED approval stays distinct from an aborted one', async () => {
    const { transporte, aprovar } = build()
    const p = aprovar()
    await transporte.approve('ap-1', 'approve' as never)
    await expect(p).resolves.toBe('approve')
  })

  it('a NEW send() sweeps the previous turn', async () => {
    const { transporte, aprovar } = build()
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
describe('M92 — holes in the first version of the eviction', () => {
  const buildWith = (opts: { jaAbortado?: boolean } = {}) => {
    let park: ((id?: string) => Promise<unknown>) | undefined
    const controller = new AbortController()
    if (opts.jaAbortado === true) controller.abort()
    const transporte = new InProcessTransport({
      run: (o: { awaitApproval: (r: { approvalId: string }) => Promise<unknown> }) => {
        park = (id = 'ap-1') => o.awaitApproval({ approvalId: id })
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
      park: (id?: string) => park!(id),
      abortar: () => {
        controller.abort()
      },
    }
  }

  it('AN ALREADY ABORTED SIGNAL — the approval is not left hanging', async () => {
    // `addEventListener('abort')` NÃO dispara num sinal que já abortou. Sem a checagem, a promessa
    // ficava pendente para sempre — o travamento que o milestone existe para fechar, ainda alcançável.
    const { transporte, park } = buildWith({ jaAbortado: true })
    const p = park()
    await expect(p).rejects.toBeInstanceOf(ApprovalAbortedError)
    expect(transporte.pendentes).toBe(0)
  })

  it('the turn is captured at SEND — an OLD runner parking after a new send', async () => {
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
    const ofTurn1 = runners[0]!('ap-do-turno-1')
    expect(transporte.pendentes).toBe(1)
    // O abort do turno 1 tem de alcançá-la. Se a etiqueta fosse do turno 2, isto penduraria.
    c1.abort()
    await expect(ofTurn1).rejects.toBeInstanceOf(ApprovalAbortedError)
  })

  it('the rejection does NOT take down the process when nobody handles it — a handler exists', async () => {
    // Node ≥ 15 sai em `unhandledRejection`. Antes do M92 a promessa pendurava; depois, se ninguém a
    // aguardasse, ela poderia MATAR o processo — trocar um travamento por um crash não é conserto.
    const { transporte, park, abortar } = buildWith()
    const abandoned = park('ap-abandonada')
    abandoned.catch(() => undefined) // é o que um runner que desiste faria
    abortar()
    await new Promise((r) => setTimeout(r, 10))
    expect(transporte.pendentes).toBe(0)
  })
})
