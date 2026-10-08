import { TheokitAgentError } from '@theokit/sdk/errors'

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
  /**
   * USD the run's priced rounds cost. A round the SDK could not price adds nothing here, so read it
   * with {@link costUnknown}: when that is set, this is the known spend and not the run's cost.
   */
  cost: number
  /**
   * Present, and `true`, when at least one round reported no finite cost (B-409): the run cost
   * {@link cost} plus an amount nobody knows. Absent on a run whose every round was priced. A
   * consumer summing runs must not read such a `cost` as the run's price (#969).
   */
  costUnknown?: true
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
 * Why a run stopped BEFORE a round rather than after one. Without it the error reports an
 * overspend (`$actual > $limit`), which is only true once the spend passed the limit; a refusal
 * stops while the spend is still under it, so it needs wording that does not claim otherwise.
 */
type BudgetRefusal =
  /** The next round's projected cost (the last completed round's), which would pass the limit. */
  | { readonly projectedRoundCost: number }
  /** The last round's cost is not known, so the limit cannot be enforced for the next one. */
  | { readonly costUnknown: true }

function budgetMessage(
  agentName: string,
  actualCost: number,
  budgetLimit: number,
  refusal: BudgetRefusal | undefined,
): string {
  const limit = `$${budgetLimit.toFixed(4)}`
  if (refusal === undefined) {
    return `Agent "${agentName}" exceeded budget: $${actualCost.toFixed(4)} > ${limit}`
  }
  if ('costUnknown' in refusal) {
    return (
      `Agent "${agentName}" stopped before its next round: the cost of its last round is not known, ` +
      `so the ${limit} limit cannot be enforced (known spend $${actualCost.toFixed(4)})`
    )
  }
  return (
    `Agent "${agentName}" stopped before its next round: spent $${actualCost.toFixed(4)}, ` +
    `next round projected at $${refusal.projectedRoundCost.toFixed(4)}, which would pass the ${limit} limit`
  )
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
/**
 * M80 — extends {@link TheokitAgentError}, not plain `Error`.
 *
 * `isTransientError` is defined over `TheokitAgentError`, so a class outside that hierarchy is
 * INVISIBLE to it and the only recourse left to a consumer is matching on message text. `code` is
 * stable across a rename; `isRetryable` is DECLARED, because a default would be a retry policy
 * nobody chose.
 */
export class DelegationBudgetExceededError extends TheokitAgentError {
  override readonly name = 'DelegationBudgetExceededError'
  /** The cost the refused round was projected at; absent when the spend already passed the limit. */
  public readonly projectedRoundCost: number | undefined
  constructor(
    public readonly agentName: string,
    public readonly actualCost: number,
    public readonly budgetLimit: number,
    refusal?: BudgetRefusal,
  ) {
    super(budgetMessage(agentName, actualCost, budgetLimit, refusal), {
      code: 'DELEGATION_BUDGET_EXCEEDED',
      // The budget does not refill on retry.
      isRetryable: false,
    })
    this.projectedRoundCost =
      refusal !== undefined && 'projectedRoundCost' in refusal
        ? refusal.projectedRoundCost
        : undefined
  }
}

/**
 * A run with a USD ceiling stopped because the cost of its last round is not known (B-409).
 *
 * A model with no price reports no cost, and reading that as $0 would let the run keep spending
 * against a limit it can no longer check, so the run stops instead (fail closed). `actualCost` is
 * the spend that IS known. A subclass so it can be caught on its own while every existing
 * `instanceof DelegationBudgetExceededError` and the `DELEGATION_BUDGET_EXCEEDED` code still match;
 * `name` is inherited because the parent declares it as a string literal, which a subclass cannot
 * override with another.
 */
export class DelegationBudgetCostUnknownError extends DelegationBudgetExceededError {
  constructor(agentName: string, knownSpend: number, budgetLimit: number) {
    super(agentName, knownSpend, budgetLimit, { costUnknown: true })
  }
}

/**
 * @deprecated Use {@link DelegationBudgetExceededError}. The alias is kept for one major so anyone
 * catching by the old name is not broken; it is the **same** class, not a copy — `instanceof` still
 * holds in both directions, and a referential-identity test (`toBe`) pins that.
 *
 * knip reports the value/type pair as a duplicate export, which is exactly what a deprecation
 * alias is; `rules.duplicates` is "warn" for that reason. Removing it is the breaking change it
 * exists to avoid.
 */
export const BudgetExceededError = DelegationBudgetExceededError
/** @deprecated Use {@link DelegationBudgetExceededError}. */
export type BudgetExceededError = DelegationBudgetExceededError

/**
 * M80 — extends {@link TheokitAgentError}, not plain `Error`.
 *
 * `isTransientError` is defined over `TheokitAgentError`, so a class outside that hierarchy is
 * INVISIBLE to it and the only recourse left to a consumer is matching on message text. `code` is
 * stable across a rename; `isRetryable` is DECLARED, because a default would be a retry policy
 * nobody chose.
 */
export class DelegationError extends TheokitAgentError {
  override readonly name = 'DelegationError'
  constructor(
    public readonly agentName: string,
    public readonly cause: unknown,
  ) {
    super(
      `Delegation to agent "${agentName}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        code: 'DELEGATION_FAILED',
        // Not retryable AT THIS LEVEL: whether the underlying cause is transient is the cause's own
        // answer, and `cause` is carried so a caller can ask it rather than guess from the wrapper.
        isRetryable: false,
        cause,
      },
    )
  }
}
