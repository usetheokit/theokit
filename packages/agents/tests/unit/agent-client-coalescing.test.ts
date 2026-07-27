import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentClient } from '../../src/client/agent-client.js'

/**
 * M92 T1.1 + T2.1 — o prefixo commitado para de ser reconstruído, e o emit ganha coalescing opt-in.
 *
 * ## A medição que reordena as prioridades
 *
 * O ROADMAP chama o spread `[...#committed, …]` de `O(C·T)` por turno, e está certo — mas a constante é
 * minúscula: medido, **0,0062 ms por delta @400 mensagens**, ou 3,1 ms no turno inteiro de 500 deltas.
 * Copiar *referências* de array é barato.
 *
 * O que custa é o que roda **depois** de cada emit: a derivação da timeline, medida no M86 em
 * **3,274 ms por chamada** no mesmo tamanho de thread — **≈ 528×** o spread. Por isso o coalescing não
 * tenta tornar o emit mais barato: ele faz **menos emits acontecerem**.
 *
 * ## Por que os testes contam EMITS
 *
 * O invariante é a frequência, não o conteúdo. Um teste que medisse tempo seria não-determinístico numa
 * suíte paralela — é a razão que `gates/perf-budget.test.ts` do consumidor registra para contar causa
 * em vez de medir parede.
 */
describe('M92 — coalescing opt-in do AgentClient', () => {
  const transporteFalso = { sendMessages: () => Promise.resolve(new ReadableStream()) } as never

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const contarEmits = (c: AgentClient): { n: () => number } => {
    let n = 0
    c.subscribe(() => {
      n += 1
    })
    return { n: () => n }
  }

  it('SEM emitIntervalMs, cada agendamento emite na hora — comportamento pre-M92', () => {
    const c = new AgentClient(transporteFalso)
    const contador = contarEmits(c)
    for (let i = 0; i < 5; i++) c.reset()
    expect(contador.n()).toBe(5)
  })

  it('COM emitIntervalMs, o snapshot mantem referencia estavel entre emits', () => {
    const c = new AgentClient(transporteFalso, undefined, { emitIntervalMs: 16 })
    const a = c.getSnapshot()
    const b = c.getSnapshot()
    expect(b).toBe(a)
  })

  it('FLUSH — reset() e transicao de status e emite NA HORA, sem esperar a janela', () => {
    const c = new AgentClient(transporteFalso, undefined, { emitIntervalMs: 16 })
    const contador = contarEmits(c)
    c.reset()
    // Sem avançar o relógio: se o reset tivesse ido para o timer, isto seria 0.
    expect(contador.n()).toBe(1)
  })

  it('o construtor aceita a terceira posicao sem quebrar as duas primeiras', () => {
    const semOpcoes = new AgentClient(transporteFalso)
    const comOpcoes = new AgentClient(transporteFalso, undefined, { emitIntervalMs: 16 })
    expect(semOpcoes.getSnapshot().status).toBe(comOpcoes.getSnapshot().status)
  })

  it('emitIntervalMs = 0 e tratado como DESLIGADO, nao como janela de zero', () => {
    const c = new AgentClient(transporteFalso, undefined, { emitIntervalMs: 0 })
    const contador = contarEmits(c)
    c.reset()
    expect(contador.n()).toBe(1)
  })
})

/**
 * M92 T1.1 — o prefixo é invalidado NA ESCRITA.
 *
 * Comparar para decidir se mudou custaria o mesmo O(C) que isto evita; memoizar por comprimento erraria
 * em `reset()`, onde comprimento igual com conteúdo diferente é possível e o bug seria invisível.
 */
describe('M92 — o prefixo commitado é materializado uma vez por escrita', () => {
  /**
   * Constrói um cliente com histórico REAL commitado.
   *
   * A primeira versão destes testes usava um cliente novo e asseria `thread === []` depois do `reset()`.
   * **Mutante sobreviveu:** num cliente novo, `#prefixo` e `#committed` são ambos vazios, então remover
   * a invalidação não muda nada e o teste não distingue. Um teste que não consegue falhar não é gate —
   * é o defeito que esta suíte inteira existe para caçar.
   *
   * Aqui o histórico é construído de verdade: um turno completo (`streaming` → `done`) e um `send()`
   * seguinte, que é o ponto onde `#committed` cresce.
   */
  /**
   * Constrói um cliente com histórico REAL commitado, dirigindo um turno completo.
   *
   * Duas versões anteriores destes testes **não conseguiam falhar**, e as duas foram pegas por mutação:
   *
   * 1. A primeira usava cliente novo e asseria `thread === []` após `reset()`. Num cliente novo,
   *    `#prefixo` e `#committed` são ambos vazios — remover a invalidação não mudava nada.
   * 2. A segunda tentou forçar `#status` por acesso indexado. `#status` é campo privado de verdade;
   *    o truque não funciona, e `#committed` continuava vazio.
   *
   * A única forma de `#committed` crescer é a real: um turno que **chega a `done`** e um `send()`
   * seguinte. O transporte falso devolve um stream que fecha na hora, para o turno terminar limpo.
   */
  const streamVazio = (): ReadableStream =>
    new ReadableStream({
      start(controller) {
        controller.close()
      },
    })

  const clienteComHistorico = async (): Promise<AgentClient> => {
    const c = new AgentClient({ sendMessages: () => Promise.resolve(streamVazio()) } as never)
    c.send('primeiro' as never)
    // Deixa o stream drenar e o status virar `done`.
    await vi.waitFor(() => {
      if (c.getSnapshot().status !== 'done') throw new Error('ainda não terminou')
    })
    // O SEGUNDO send é o que commita o turno anterior — é lá que `#committed` cresce.
    c.send('segundo' as never)
    return c
  }

  it('depois de DOIS turnos, o prefixo commitado nao esta vazio', async () => {
    const c = await clienteComHistorico()
    const tamanho = c.getSnapshot().thread.length
    expect(tamanho).toBeGreaterThan(1)
  })

  it('reset() INVALIDA o prefixo — com historico REAL, o unico jeito de o teste poder falhar', async () => {
    const c = await clienteComHistorico()
    const antes = c.getSnapshot().thread.length
    expect(antes).toBeGreaterThan(1)
    c.reset()
    expect(c.getSnapshot().thread).toEqual([])
  })

  it('o thread emitido e prefixo + turno em voo, nesta ordem', async () => {
    const c = await clienteComHistorico()
    const papeis = c.getSnapshot().thread.map((m) => m.role)
    expect(papeis[0]).toBe('user')
  })
})
