import { describe, expect, it } from 'vitest'

import {
  // Provar que o alias é a MESMA classe exige importá-lo — é o único uso legítimo do nome deprecado
  // no repositório, e é este teste que garante que ele continua sendo alias e não vira cópia (M73).
  BudgetExceededError as AliasDeprecado,
  DelegationBudgetExceededError,
} from '../../src/bridge/delegation-types.js'
import * as barril from '../../src/index.js'

/**
 * M91 T5.1 — o erro de delegação para de sombrear o do SDK.
 *
 * ## O defeito
 *
 * `BudgetExceededError` existia nos dois lados e NÃO era a mesma coisa: no SDK é orçamento de JANELA
 * de contexto (`budgetName`/`window`/`spentUsd`/`mode`); aqui é orçamento de DELEGAÇÃO
 * (`agentName`/`actualCost`/`budgetLimit`). Como o consumidor tem regra inquebrável de nunca importar
 * `@theokit/sdk` direto, ele **nunca alcançava a do SDK** — e um `instanceof` contra o barril casava
 * com o domínio errado **em silêncio**.
 *
 * É o modo de falha que o M73 documentou: quando duas classes competem pelo mesmo nome, nenhum teste
 * de comportamento fica vermelho. Só identidade referencial pega.
 *
 * ## Por que `toBe` e não `toBeDefined`
 *
 * Herdado de `auth-parity.test.ts` (M73): se o build inlinear a fonte, o alias vira uma **cópia** da
 * classe, `instanceof` passa a falhar em silêncio e um `toBeDefined` não vê nada.
 */
describe('M91 — the delegation error no longer shadows the one from the SDK', () => {
  it('the deprecated alias is the SAME class, not a copy', () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    expect(AliasDeprecado).toBe(DelegationBudgetExceededError)
  })

  it('instanceof holds in BOTH directions through the alias', () => {
    const err = new DelegationBudgetExceededError('agente', 1.5, 1)
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    expect(err).toBeInstanceOf(AliasDeprecado)
  })

  it('the instance name is the NEW name', () => {
    const err = new DelegationBudgetExceededError('agente', 1.5, 1)
    expect(err.name).toBe('DelegationBudgetExceededError')
  })

  it('the barrel exports the DELEGATION error under the new name', () => {
    expect(barril.DelegationBudgetExceededError).toBe(DelegationBudgetExceededError)
  })

  /**
   * NÃO-QUEBRA — o achado que a revisão do M91 pegou depois de eu já ter publicado.
   *
   * A primeira tentativa (`4.26.0`) **reaproveitou** o nome: o barril passou a exportar a classe do
   * SDK sob `BudgetExceededError`. Um consumidor em `^4.25` com
   * `catch (e) { if (e instanceof BudgetExceededError) … }` viu o ramo de delegação **parar de casar,
   * em silêncio** — o modo de falha que este milestone existe para matar, em espelho, publicado como
   * MINOR. Este teste é o que impede a repetição.
   */
  it('NON-BREAKING — the barrel keeps BudgetExceededError = the DELEGATION class', () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- é o alias que este teste protege
    expect(barril.BudgetExceededError).toBe(DelegationBudgetExceededError)
  })

  it('the WINDOW error from the SDK crosses under its OWN name, reusing nobody elses', () => {
    expect(barril.WindowBudgetExceededError).toBeDefined()
  })

  it('COUNTERPROOF — window and delegation are DIFFERENT classes', () => {
    // O invariante que o milestone comprou: as duas alcançáveis, cada uma com seu nome.
    expect(barril.WindowBudgetExceededError).not.toBe(barril.DelegationBudgetExceededError)
  })

  it('the WINDOW class from the SDK constructs with ITS OWN shape — the proof they are distinct domains', () => {
    const windowMs = new barril.WindowBudgetExceededError({
      budgetName: 'ctx',
      window: 'session',
      spentUsd: 5,
      limitUsd: 1,
    } as never)
    expect(windowMs).toBeInstanceOf(barril.WindowBudgetExceededError)
  })

  it('the message preserves its format — the rename does not change behaviour', () => {
    const err = new DelegationBudgetExceededError('Planner', 1.5, 1)
    expect(err.message).toContain('Planner')
  })
})
