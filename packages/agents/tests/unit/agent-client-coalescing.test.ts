import { describe, expect, it, vi } from 'vitest'

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
/**
 * Transporte falso que emite N deltas de texto no MESMO tick — a forma do caminho quente.
 *
 * A primeira versão destes testes instalava `vi.useFakeTimers()` e **nunca os avançava**, e só
 * exercitava `reset()` — que faz flush síncrono por decisão. Resultado medido pela revisão: substituir
 * o corpo inteiro de `#agendarEmit` por `return` deixava **580/580 testes verdes**. O gate não
 * conseguia falhar; era o pior tipo de gate.
 */
const transporteComDeltas = (n: number): unknown => ({
  sendMessages: () =>
    Promise.resolve(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < n; i++) {
            controller.enqueue({
              type: 'data-message',
              data: {
                id: 'a1',
                role: 'assistant',
                parts: [{ type: 'text', text: 'x'.repeat(i + 1) }],
              },
            })
          }
          controller.close()
        },
      }),
    ),
})

describe('M92 — coalescing opt-in do AgentClient', () => {
  const contarEmits = (c: AgentClient): { n: () => number } => {
    let n = 0
    c.subscribe(() => {
      n += 1
    })
    return { n: () => n }
  }

  /** Deixa o stream drenar; sem fake timers, para o coalescing usar o relógio real. */
  const drenar = async (c: AgentClient): Promise<void> => {
    await vi.waitFor(
      () => {
        if (c.getSnapshot().status === 'streaming') throw new Error('ainda streaming')
      },
      { timeout: 2000 },
    )
  }

  it('SEM coalescing, cada delta emite — o comportamento pre-M92', async () => {
    const c = new AgentClient(transporteComDeltas(30) as never)
    const contador = contarEmits(c)
    c.send('oi' as never)
    await drenar(c)
    // 30 deltas + as transições de status. O piso é o que importa: um emit POR delta.
    expect(contador.n()).toBeGreaterThanOrEqual(30)
  })

  it('COM coalescing, MUITO menos emits para os mesmos deltas — o ponto do milestone', async () => {
    const c = new AgentClient(transporteComDeltas(30) as never, undefined, { emitIntervalMs: 16 })
    const contador = contarEmits(c)
    c.send('oi' as never)
    await drenar(c)
    // Os 30 deltas caem na mesma janela de 16 ms; sobram as transições de status, que fazem flush.
    expect(contador.n()).toBeLessThan(30)
  })

  it('o ESTADO FINAL sobrevive ao coalescing — nenhum token se perde', async () => {
    const c = new AgentClient(transporteComDeltas(30) as never, undefined, { emitIntervalMs: 16 })
    c.send('oi' as never)
    await drenar(c)
    // O último delta carrega 30 caracteres. Se o flush síncrono não rodasse, o snapshot pararia num
    // prefixo — que é exatamente o risco nº 1 do plano: estado final preso num timer é estado perdido.
    const parte = c.getSnapshot().messages.at(-1)?.parts.at(-1) as
      | { data?: { parts?: { text?: string }[] } }
      | undefined
    expect(parte?.data?.parts?.[0]?.text).toHaveLength(30)
  })

  it('CONTRAPROVA — a reducao de emits e material, nao marginal', async () => {
    const sem = new AgentClient(transporteComDeltas(30) as never)
    const com = new AgentClient(transporteComDeltas(30) as never, undefined, { emitIntervalMs: 16 })
    let nSem = 0
    let nCom = 0
    sem.subscribe(() => {
      nSem += 1
    })
    com.subscribe(() => {
      nCom += 1
    })
    sem.send('oi' as never)
    com.send('oi' as never)
    await drenar(sem)
    await drenar(com)
    // Medido no probe: 32 contra 2 para 30 deltas. O piso de 5× é folgado o bastante para não piscar
    // sob contenção de CPU e apertado o bastante para reprovar se o coalescing sumir.
    expect(nSem / nCom).toBeGreaterThan(5)
  })

  it('o status final e done nas duas configuracoes', async () => {
    const sem = new AgentClient(transporteComDeltas(10) as never)
    const com = new AgentClient(transporteComDeltas(10) as never, undefined, { emitIntervalMs: 16 })
    sem.send('a' as never)
    com.send('a' as never)
    await drenar(sem)
    await drenar(com)
    expect(sem.getSnapshot().status).toBe(com.getSnapshot().status)
  })

  it('o snapshot mantem referencia estavel entre emits', () => {
    const c = new AgentClient(transporteComDeltas(0) as never, undefined, { emitIntervalMs: 16 })
    const a = c.getSnapshot()
    const b = c.getSnapshot()
    expect(b).toBe(a)
  })

  it('FLUSH — reset() e transicao de status e emite NA HORA, sem esperar a janela', () => {
    const c = new AgentClient(transporteComDeltas(0) as never, undefined, { emitIntervalMs: 16 })
    const contador = contarEmits(c)
    c.reset()
    expect(contador.n()).toBe(1)
  })

  it('emitIntervalMs = 0 e tratado como DESLIGADO, nao como janela de zero', () => {
    const c = new AgentClient(transporteComDeltas(0) as never, undefined, { emitIntervalMs: 0 })
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
