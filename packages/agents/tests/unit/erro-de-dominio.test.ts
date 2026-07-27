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
describe('M91 — o erro de delegação não sombreia mais o do SDK', () => {
  it('o alias deprecado e a MESMA classe, nao uma copia', () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    expect(AliasDeprecado).toBe(DelegationBudgetExceededError)
  })

  it('instanceof vale nos DOIS sentidos pelo alias', () => {
    const err = new DelegationBudgetExceededError('agente', 1.5, 1)
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    expect(err).toBeInstanceOf(AliasDeprecado)
  })

  it('o name da instancia e o nome NOVO', () => {
    const err = new DelegationBudgetExceededError('agente', 1.5, 1)
    expect(err.name).toBe('DelegationBudgetExceededError')
  })

  it('o barril exporta o erro de DELEGACAO com o nome novo', () => {
    expect(barril.DelegationBudgetExceededError).toBe(DelegationBudgetExceededError)
  })

  it('o barril agora exporta TAMBEM o erro de JANELA do SDK — antes era inalcancavel', () => {
    const doSdk = barril.BudgetExceededError
    expect(doSdk).toBeDefined()
  })

  it('CONTRAPROVA — os dois erros do barril sao classes DIFERENTES', () => {
    // Este é o invariante que o milestone comprou. Antes, `barril.BudgetExceededError` era a classe
    // da camada, e a do SDK não tinha caminho nenhum.
    expect(barril.BudgetExceededError).not.toBe(barril.DelegationBudgetExceededError)
  })

  it('a mensagem preserva o formato — o rename nao muda comportamento', () => {
    const err = new DelegationBudgetExceededError('Planner', 1.5, 1)
    expect(err.message).toContain('Planner')
  })
})
