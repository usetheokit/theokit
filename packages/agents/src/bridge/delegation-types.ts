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
 * DELEGATION budget exceeded — the dollar cost of a delegated agent.
 *
 * ## Why the name changed in M91
 *
 * It was called `BudgetExceededError` and **shadowed** the SDK class of the same name, which belongs
 * to another domain: context-WINDOW budget (`budgetName`/`window`/`mode`) against DELEGATION budget
 * (`agentName`/`actualCost`). Since the consumer holds an unbreakable rule never to import
 * `@theokit/sdk` directly, it **could never reach the SDK's** — and an `instanceof` against this
 * barrel silently matched the wrong domain.
 *
 * It is the failure mode M73 documented in `auth-parity.test.ts`: when two classes compete for the
 * same name, no behavioural test goes red — only an identity `toBe` catches it.
 *
 * `subpath-coverage.test.ts` recorded the collision as a `gap` on `./errors`, with the reason written
 * down and the acknowledgement that renaming was breaking and out of M78's scope. M91 paid the bill.
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
 * @deprecated Use {@link DelegationBudgetExceededError}. The alias is kept for one major so anyone
 * catching by the old name is not broken; it is the **same** class, not a copy — `instanceof` still
 * holds in both directions, and a referential-identity test (`toBe`) pins that.
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
