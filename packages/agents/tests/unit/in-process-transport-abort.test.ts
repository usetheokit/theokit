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

  it('o erro nomeia a aprovacao e o motivo — diagnostico, nao so o tipo', async () => {
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
