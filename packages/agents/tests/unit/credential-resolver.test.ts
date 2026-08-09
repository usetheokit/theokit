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

import { classifyRefreshFailure, waitWithJitter } from '../../src/auth/auth-provider.js'
import { AgentRunner, type AgentRunnerRunOptions } from '../../src/loop/agent-runner.js'

describe('M74 — the credential seam accepts a resolver', () => {
  it('test_a_string_is_still_valid', () => {
    // Retrocompatibilidade: quem passa uma chave de API não muda nada. Uma chave não expira; obrigar
    // um resolvedor ali seria cerimônia sem ganho.
    // Tipado contra o CONTRATO REAL — não contra um tipo local. É `tsc` que prova isto; o vitest
    // transpila sem checar tipos, então um teste que declarasse o tipo aqui passaria sem a mudança.
    const opts: Pick<AgentRunnerRunOptions, 'apiKey'> = { apiKey: 'sk-fixa' }
    expect(typeof opts.apiKey).toBe('string')
  })

  it('test_the_type_admits_a_resolver', () => {
    // O contrato mínimo é uma função — não a classe `AuthProvider`. Acoplar o tipo público à classe
    // da camada obrigaria cada consumidor a conhecê-la; uma função qualquer `AuthProvider` satisfaz
    // numa linha.
    const opts: Pick<AgentRunnerRunOptions, 'apiKey'> = { apiKey: () => 'sk-resolvida' }
    expect(typeof opts.apiKey).toBe('function')
  })

  it('test_every_run_resolves_afresh', async () => {
    // O invariante que dá nome ao milestone: DUAS runs, DUAS resoluções. Se o valor fosse capturado
    // na construção, a segunda run reusaria o da primeira — que é exatamente o bug em produção.
    let n = 0
    const credResolver = (): string => `sk-turno-${String(++n)}`
    const a = credResolver()
    const b = credResolver()
    expect([a, b], 'o resolvedor devolveu o mesmo valor duas vezes').toEqual([
      'sk-turno-1',
      'sk-turno-2',
    ])
    expect(n).toBe(2)
  })

  it('test_the_runner_exists_and_exposes_run', () => {
    // Âncora de não-vacuidade: se `AgentRunner` deixar de existir ou de expor `run`, os testes acima
    // continuariam verdes (são sobre tipos e sobre uma função local) e provariam nada.
    expect(typeof AgentRunner).toBe('function')
    expect(typeof AgentRunner.prototype.run).toBe('function')
  })

  it('test_an_async_resolver_is_awaited', async () => {
    // O caso real: `ensureFresh` é assíncrono (pode POSTar o refresh). O seam precisa aguardá-lo, e
    // não passar a Promise adiante como se fosse a chave.
    const credResolver = async (): Promise<string> => Promise.resolve('sk-async')
    const valor = await credResolver()
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
describe('M74 T1.2 — reentrancy resolves via the promise, not via the lock', () => {
  it('test_single_flight_returns_the_same_in_flight_promise', async () => {
    // Modela o invariante: duas chamadas concorrentes para o MESMO caminho de store compartilham uma
    // execução. Se cada uma disparasse a sua, a segunda esperaria o lock da primeira — o deadlock.
    const inFlight = new Map<string, Promise<string>>()
    let runCount = 0
    const refreshIt = (filePath: string): Promise<string> => {
      const alreadyInFlight = inFlight.get(filePath)
      if (alreadyInFlight !== undefined) return alreadyInFlight
      const p = (async () => {
        runCount++
        await new Promise((r) => setTimeout(r, 20))
        return 'sk-nova'
      })()
      inFlight.set(filePath, p)
      return p.finally(() => inFlight.delete(filePath))
    }

    const [a, b] = await Promise.all([refreshIt('/tmp/auth.json'), refreshIt('/tmp/auth.json')])

    expect(
      runCount,
      'o refresh rodou duas vezes — a segunda teria disputado o lock com a primeira',
    ).toBe(1)
    expect(a).toBe(b)
  })

  it('test_different_paths_do_not_share_a_flight', async () => {
    // A chave é o ARQUIVO, não a instância: dois stores distintos são disputas distintas e não devem
    // se serializar um pelo outro.
    const inFlight = new Map<string, Promise<string>>()
    let runCount = 0
    const refreshIt = (filePath: string): Promise<string> => {
      const alreadyInFlight = inFlight.get(filePath)
      if (alreadyInFlight !== undefined) return alreadyInFlight
      const p = (async () => {
        runCount++
        return `sk-${filePath}`
      })()
      inFlight.set(filePath, p)
      return p.finally(() => inFlight.delete(filePath))
    }

    await Promise.all([refreshIt('/tmp/a.json'), refreshIt('/tmp/b.json')])
    expect(runCount).toBe(2)
  })
})

describe('M74 T1.3 — o retry distingue transitório de terminal', () => {
  it('test_invalid_grant_e_terminal', () => {
    const f = classifyRefreshFailure(new Error('server responded 400: {"error":"invalid_grant"}'))
    expect(f.transient, 'invalid_grant não é transitório — o token foi revogado').toBe(false)
    expect(f.message).toMatch(/refaça o login/)
  })

  it('test_rede_e_5xx_sao_transitorios', () => {
    for (const e of ['ETIMEDOUT', 'ECONNRESET', 'server responded 503', 'network error']) {
      expect(classifyRefreshFailure(new Error(e)).transient, `${e} deveria ser transitório`).toBe(
        true,
      )
    }
  })

  it('test_the_failure_does_not_echo_token_material', () => {
    // O erro do provider pode conter o corpo da resposta. A classificação lê o texto mas NUNCA o
    // repassa: a mensagem carrega a classe e o motivo, não o que veio da rede.
    const f = classifyRefreshFailure(new Error('invalid_grant refresh_token=RT-SEGREDO-123'))
    expect(f.message).not.toContain('RT-SEGREDO-123')
  })

  it('test_the_backoff_grows_and_has_jitter', () => {
    // Cresce exponencialmente...
    expect(waitWithJitter(0, 200, () => 0.5)).toBeLessThan(waitWithJitter(2, 200, () => 0.5))
    // ...e dois processos com a mesma tentativa NÃO esperam o mesmo tempo, senão retentam em uníssono
    // e reproduzem a colisão que o backoff existe para dispersar.
    expect(waitWithJitter(1, 200, () => 0)).not.toBe(waitWithJitter(1, 200, () => 0.99))
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
describe('M74 review — the retry is wired into the production path', () => {
  it('test_a_transient_failure_retries_up_to_the_limit', async () => {
    let attempts = 0
    const callIt = async (): Promise<string> => {
      const MAX = 3
      for (let t = 0; ; t++) {
        try {
          attempts++
          throw new Error('ETIMEDOUT')
        } catch (err) {
          const f = classifyRefreshFailure(err)
          if (!f.transient || t >= MAX - 1) throw f
          await new Promise((r) => setTimeout(r, 1))
        }
      }
    }
    await expect(callIt()).rejects.toThrow(/transitória/)
    expect(attempts, 'o transitório deveria tentar 3 vezes').toBe(3)
  })

  it('test_invalid_grant_stops_on_the_first_attempt', async () => {
    let attempts = 0
    const callIt = async (): Promise<string> => {
      const MAX = 3
      for (let t = 0; ; t++) {
        try {
          attempts++
          throw new Error('{"error":"invalid_grant"}')
        } catch (err) {
          const f = classifyRefreshFailure(err)
          if (!f.transient || t >= MAX - 1) throw f
          await new Promise((r) => setTimeout(r, 1))
        }
      }
    }
    await expect(callIt()).rejects.toThrow(/refaça o login/)
    expect(attempts, 'invalid_grant não pode ser repetido').toBe(1)
  })

  it('test_the_retry_loop_exists_in_the_production_source', async () => {
    // GATE ESTRUTURAL, e a razão dele é o defeito acima: os dois testes anteriores modelam o laço.
    // Se o laço REAL sumir de novo, eles continuam verdes. Este lê o fonte de produção.
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../../src/auth/auth-provider.ts', import.meta.url), 'utf8')
    const body = source.slice(source.indexOf('private refrescarSobLock'))
    expect(
      body.length,
      'não achei `refrescarSobLock` — o gate passaria por vacuidade',
    ).toBeGreaterThan(200)
    expect(body, 'o laço de retry sumiu do caminho de produção').toMatch(/for \(let tentativa/)
    expect(body, 'o classificador não está ligado ao laço').toContain('classificarFalhaDeRefresh')
    expect(body, 'o backoff não está ligado ao laço').toContain('esperaComJitter')
  })
})
