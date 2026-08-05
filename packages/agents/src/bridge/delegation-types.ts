/**
 * Shared delegation value types + typed errors.
 *
 * Extracted from `agent-orchestrator.ts` so BOTH the orchestrator (`delegate`)
 * and the loop driver (`loop/run-reflective-loop.ts`) can import them WITHOUT a
 * cycle (orchestrator → loop → delegation-types; orchestrator → delegation-types;
 * delegation-types has only a TYPE-ONLY import of `LoopFinishReason` (erased at
 * runtime → no runtime edge; `loop-strategy.ts` is a leaf importing only zod, so
 * no cycle — Acyclic Dependencies Principle, G1).
 * `agent-orchestrator.ts` re-exports these for backward compatibility.
 */
import type { LoopFinishReason } from '../loop/loop-strategy.js'

export interface DelegationResult {
  response: string
  toolCalls: { id: string; name: string; input: unknown; output: string }[]
  cost: number
  tokens: number
  /** V4-N: split token usage accumulated across rounds (`tokens` stays as the total). Absent for the single-shot path. */
  tokensInput?: number
  tokensOutput?: number
  /** V4-O: reasoning/cache token buckets accumulated across rounds (0 on any loop-driven run; the loop seeds them). Optional for type compat. */
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** Rounds the reflective loop ran (set by `runReflectiveLoop`; absent for the single-shot path). */
  rounds?: number
  /**
   * The loop's terminal reason (set by `runReflectiveLoop`): `'stop'`/`'length'` natural end,
   * `'step_limit'` (hit maxIterations), `'no_progress'` (stuck). Absent for the single-shot path. (V4-D)
   */
  finishReason?: LoopFinishReason
}

/**
 * Orçamento de DELEGAÇÃO estourado — custo em dólares de um agente delegado.
 *
 * ## Por que o nome mudou no M91
 *
 * Chamava-se `BudgetExceededError` e **sombreava** a classe homônima do SDK, que é de outro domínio:
 * orçamento de JANELA de contexto (`budgetName`/`window`/`mode`) contra orçamento de DELEGAÇÃO
 * (`agentName`/`actualCost`). Como o consumidor tem regra inquebrável de nunca importar `@theokit/sdk`
 * direto, ele **nunca conseguia alcançar a do SDK** — e um `instanceof` contra este barril casava
 * silenciosamente com o domínio errado.
 *
 * É o modo de falha que o M73 documentou em `auth-parity.test.ts`: quando duas classes competem pelo
 * mesmo nome, nenhum teste de comportamento fica vermelho — só o `toBe` de identidade pega.
 *
 * `subpath-coverage.test.ts` registrava a colisão como `lacuna` de `./errors`, com a razão escrita e o
 * reconhecimento de que renomear era breaking e estava fora do escopo do M78. O M91 pagou a conta.
 */
export class DelegationBudgetExceededError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly actualCost: number,
    public readonly budgetLimit: number,
  ) {
    super(
      `Agent "${agentName}" exceeded budget: $${actualCost.toFixed(4)} > $${budgetLimit.toFixed(4)}`,
    )
    this.name = 'DelegationBudgetExceededError'
  }
}

/**
 * @deprecated Use {@link DelegationBudgetExceededError}. Alias mantido por uma major para não quebrar
 * quem captura pelo nome antigo; é a **mesma** classe, não uma cópia — `instanceof` continua valendo
 * nos dois sentidos, e um teste de identidade referencial (`toBe`) trava isso.
 */
export const BudgetExceededError = DelegationBudgetExceededError
/** @deprecated Use {@link DelegationBudgetExceededError}. */
export type BudgetExceededError = DelegationBudgetExceededError

export class DelegationError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly cause: unknown,
  ) {
    super(
      `Delegation to agent "${agentName}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
    this.name = 'DelegationError'
  }
}
