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
  /** V4-O: reasoning/cache token buckets accumulated across rounds. Absent for the single-shot path. */
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

export class BudgetExceededError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly actualCost: number,
    public readonly budgetLimit: number,
  ) {
    super(
      `Agent "${agentName}" exceeded budget: $${actualCost.toFixed(4)} > $${budgetLimit.toFixed(4)}`,
    )
    this.name = 'BudgetExceededError'
  }
}

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
