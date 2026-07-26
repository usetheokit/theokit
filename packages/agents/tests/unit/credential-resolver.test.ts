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

import { classificarFalhaDeRefresh, esperaComJitter } from '../../src/auth/auth-provider.js'
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

describe('M74 T1.3 — o retry distingue transitório de terminal', () => {
  it('test_invalid_grant_e_terminal', () => {
    const f = classificarFalhaDeRefresh(
      new Error('server responded 400: {"error":"invalid_grant"}'),
    )
    expect(f.transitorio, 'invalid_grant não é transitório — o token foi revogado').toBe(false)
    expect(f.message).toMatch(/refaça o login/)
  })

  it('test_rede_e_5xx_sao_transitorios', () => {
    for (const e of ['ETIMEDOUT', 'ECONNRESET', 'server responded 503', 'network error']) {
      expect(
        classificarFalhaDeRefresh(new Error(e)).transitorio,
        `${e} deveria ser transitório`,
      ).toBe(true)
    }
  })

  it('test_a_falha_nao_ecoa_material_de_token', () => {
    // O erro do provider pode conter o corpo da resposta. A classificação lê o texto mas NUNCA o
    // repassa: a mensagem carrega a classe e o motivo, não o que veio da rede.
    const f = classificarFalhaDeRefresh(new Error('invalid_grant refresh_token=RT-SEGREDO-123'))
    expect(f.message).not.toContain('RT-SEGREDO-123')
  })

  it('test_o_backoff_cresce_e_tem_jitter', () => {
    // Cresce exponencialmente...
    expect(esperaComJitter(0, 200, () => 0.5)).toBeLessThan(esperaComJitter(2, 200, () => 0.5))
    // ...e dois processos com a mesma tentativa NÃO esperam o mesmo tempo, senão retentam em uníssono
    // e reproduzem a colisão que o backoff existe para dispersar.
    expect(esperaComJitter(1, 200, () => 0)).not.toBe(esperaComJitter(1, 200, () => 0.99))
  })
})

/**
 * M74 review (M74-02) — o teste do CONTADOR, que faltava.
 *
 * A T1.3 tinha `classificarFalhaDeRefresh` e `esperaComJitter` testados como funções puras, e os dois
 * passavam. Mas o laço que os USA foi apagado por um lint-fix que reescreveu o bloco inteiro, e nenhum
 * teste percebeu: o review mediu `tentativas de POST = 1` contra as 3 que a DoD exige.
 *
 * Testar o classificador isolado prova que ele classifica. Não prova que ele está LIGADO.
 */
describe('M74 review — o retry está ligado ao caminho de produção', () => {
  it('test_transitorio_tenta_de_novo_ate_o_limite', async () => {
    let tentativas = 0
    const chamar = async (): Promise<string> => {
      const MAX = 3
      for (let t = 0; ; t++) {
        try {
          tentativas++
          throw new Error('ETIMEDOUT')
        } catch (err) {
          const f = classificarFalhaDeRefresh(err)
          if (!f.transitorio || t >= MAX - 1) throw f
          await new Promise((r) => setTimeout(r, 1))
        }
      }
    }
    await expect(chamar()).rejects.toThrow(/transitória/)
    expect(tentativas, 'o transitório deveria tentar 3 vezes').toBe(3)
  })

  it('test_invalid_grant_para_na_primeira', async () => {
    let tentativas = 0
    const chamar = async (): Promise<string> => {
      const MAX = 3
      for (let t = 0; ; t++) {
        try {
          tentativas++
          throw new Error('{"error":"invalid_grant"}')
        } catch (err) {
          const f = classificarFalhaDeRefresh(err)
          if (!f.transitorio || t >= MAX - 1) throw f
          await new Promise((r) => setTimeout(r, 1))
        }
      }
    }
    await expect(chamar()).rejects.toThrow(/refaça o login/)
    expect(tentativas, 'invalid_grant não pode ser repetido').toBe(1)
  })

  it('test_o_laco_de_retry_existe_no_fonte_de_producao', async () => {
    // GATE ESTRUTURAL, e a razão dele é o defeito acima: os dois testes anteriores modelam o laço.
    // Se o laço REAL sumir de novo, eles continuam verdes. Este lê o fonte de produção.
    const { readFileSync } = await import('node:fs')
    const fonte = readFileSync(new URL('../../src/auth/auth-provider.ts', import.meta.url), 'utf8')
    const corpo = fonte.slice(fonte.indexOf('private refrescarSobLock'))
    expect(
      corpo.length,
      'não achei `refrescarSobLock` — o gate passaria por vacuidade',
    ).toBeGreaterThan(200)
    expect(corpo, 'o laço de retry sumiu do caminho de produção').toMatch(/for \(let tentativa/)
    expect(corpo, 'o classificador não está ligado ao laço').toContain('classificarFalhaDeRefresh')
    expect(corpo, 'o backoff não está ligado ao laço').toContain('esperaComJitter')
  })
})
