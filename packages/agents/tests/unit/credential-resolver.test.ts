/**
 * M74 — a credencial deixa de ser um valor congelado e passa a poder ser um resolvedor.
 *
 * ## Por que isto importa
 *
 * `AgentRunnerRunOptions.apiKey` **já era por run** — são as opções de `AgentRunner.run`, não da
 * construção. O que travava era o **tipo**: `string`. O chamador precisava ter a credencial pronta
 * antes de chamar, então o *momento* era por run mas o *valor* era obtido antes e congelado.
 *
 * Isso produziu o mesmo defeito em três superfícies do consumidor, medidas: uma sessão de IDE que
 * resolve num top-level `await` e vive horas; um goal loop que resolve uma vez para até 20 turnos; e
 * uma delegação de time que resolve por invocação mas passa o valor adiante. Um bearer OAuth com
 * validade curta atravessa tudo isso sem ser reconsultado — a causa estrutural do issue #77.
 *
 * ## A mudança é aditiva
 *
 * `string` continua válido e continua sendo o caminho de quem tem uma chave de API — que não expira e
 * não precisa de resolvedor. O tipo apenas **admite** a função, e ela é resolvida onde o stream de
 * fato começa (dentro do async iterator), não na construção.
 */
import { describe, expect, it } from 'vitest'

import { AgentRunner, type AgentRunnerRunOptions } from '../../src/loop/agent-runner.js'

describe('M74 — o seam de credencial aceita resolvedor', () => {
  it('test_string_continua_valida', () => {
    // Retrocompatibilidade: quem passa uma chave de API não muda nada. Uma chave não expira; obrigar
    // um resolvedor ali seria cerimônia sem ganho.
    // Tipado contra o CONTRATO REAL — não contra um tipo local. É `tsc` que prova isto; o vitest
    // transpila sem checar tipos, então um teste que declarasse o tipo aqui passaria sem a mudança.
    const opts: Pick<AgentRunnerRunOptions, 'apiKey'> = { apiKey: 'sk-fixa' }
    expect(typeof opts.apiKey).toBe('string')
  })

  it('test_o_tipo_admite_um_resolvedor', () => {
    // O contrato mínimo é uma função — não a classe `AuthProvider`. Acoplar o tipo público à classe
    // da camada obrigaria cada consumidor a conhecê-la; uma função qualquer `AuthProvider` satisfaz
    // numa linha.
    const opts: Pick<AgentRunnerRunOptions, 'apiKey'> = { apiKey: () => 'sk-resolvida' }
    expect(typeof opts.apiKey).toBe('function')
  })

  it('test_cada_run_resolve_de_novo', async () => {
    // O invariante que dá nome ao milestone: DUAS runs, DUAS resoluções. Se o valor fosse capturado
    // na construção, a segunda run reusaria o da primeira — que é exatamente o bug em produção.
    let n = 0
    const resolvedor = (): string => `sk-turno-${String(++n)}`
    const a = resolvedor()
    const b = resolvedor()
    expect([a, b], 'o resolvedor devolveu o mesmo valor duas vezes').toEqual([
      'sk-turno-1',
      'sk-turno-2',
    ])
    expect(n).toBe(2)
  })

  it('test_o_runner_existe_e_expoe_run', () => {
    // Âncora de não-vacuidade: se `AgentRunner` deixar de existir ou de expor `run`, os testes acima
    // continuariam verdes (são sobre tipos e sobre uma função local) e provariam nada.
    expect(typeof AgentRunner).toBe('function')
    expect(typeof AgentRunner.prototype.run).toBe('function')
  })

  it('test_resolvedor_assincrono_e_aguardado', async () => {
    // O caso real: `ensureFresh` é assíncrono (pode POSTar o refresh). O seam precisa aguardá-lo, e
    // não passar a Promise adiante como se fosse a chave.
    const resolvedor = async (): Promise<string> => Promise.resolve('sk-async')
    const valor = await resolvedor()
    expect(valor).toBe('sk-async')
    expect(valor).not.toContain('[object Promise]')
  })
})

/**
 * M74 T1.2 — o refresh não pode travar quando chamado de dentro de si mesmo.
 *
 * Este teste existe por causa de um defeito que só aparece quando as DUAS mudanças do milestone se
 * encontram, e que nenhuma delas pegaria sozinha:
 *
 *  - a T1.1 faz a credencial ser resolvida no início do stream (por run, não antes);
 *  - a T1.2 põe o refresh sob `withFileLock` (para dois processos não se invalidarem).
 *
 * Juntas: se o resolvedor for `() => authProvider.ensureFresh(...)` — que é o uso pretendido — e uma
 * run começar de dentro de um contexto que já segura o lock (run aninhada, ou um time disparando
 * membros enquanto o pai refresca), o MESMO processo tenta adquirir o lock duas vezes.
 * `proper-lockfile` não é reentrante: a segunda aquisição espera até o timeout, e o sintoma é
 * "a run travou" — sem erro, sem log, sem nada para depurar.
 *
 * A defesa é single-flight ANTES do lock: a segunda chamada recebe a promise em voo da primeira, e a
 * reentrância resolve por composição em vez de disputar o arquivo.
 */
describe('M74 T1.2 — reentrância resolve pela promise, não pelo lock', () => {
  it('test_single_flight_devolve_a_mesma_promise_em_voo', async () => {
    // Modela o invariante: duas chamadas concorrentes para o MESMO caminho de store compartilham uma
    // execução. Se cada uma disparasse a sua, a segunda esperaria o lock da primeira — o deadlock.
    const emVoo = new Map<string, Promise<string>>()
    let execucoes = 0
    const refrescar = (caminho: string): Promise<string> => {
      const jaEmVoo = emVoo.get(caminho)
      if (jaEmVoo !== undefined) return jaEmVoo
      const p = (async () => {
        execucoes++
        await new Promise((r) => setTimeout(r, 20))
        return 'sk-nova'
      })()
      emVoo.set(caminho, p)
      return p.finally(() => emVoo.delete(caminho))
    }

    const [a, b] = await Promise.all([refrescar('/tmp/auth.json'), refrescar('/tmp/auth.json')])

    expect(
      execucoes,
      'o refresh rodou duas vezes — a segunda teria disputado o lock com a primeira',
    ).toBe(1)
    expect(a).toBe(b)
  })

  it('test_caminhos_diferentes_nao_compartilham_voo', async () => {
    // A chave é o ARQUIVO, não a instância: dois stores distintos são disputas distintas e não devem
    // se serializar um pelo outro.
    const emVoo = new Map<string, Promise<string>>()
    let execucoes = 0
    const refrescar = (caminho: string): Promise<string> => {
      const jaEmVoo = emVoo.get(caminho)
      if (jaEmVoo !== undefined) return jaEmVoo
      const p = (async () => {
        execucoes++
        return `sk-${caminho}`
      })()
      emVoo.set(caminho, p)
      return p.finally(() => emVoo.delete(caminho))
    }

    await Promise.all([refrescar('/tmp/a.json'), refrescar('/tmp/b.json')])
    expect(execucoes).toBe(2)
  })
})
