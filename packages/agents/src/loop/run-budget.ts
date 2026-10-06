/**
 * The run's USD ceiling, checked BEFORE a round as well as after one (B-409).
 *
 * The reflective loop compares the spend to the ceiling once a round has been paid for, so on its
 * own the round that crosses the ceiling is always spent. This module refuses that round up front:
 * the next round is assumed to cost what the last completed one did, and the run stops when the
 * spend so far plus that projection would pass the ceiling. The post-round check stays in the loop
 * as the backstop for a round that costs more than the one before it.
 *
 * Kept out of `run-reflective-loop.ts`, which is already past the file-size budget.
 */
import { DelegationBudgetExceededError } from '../bridge/delegation-types.js'

/**
 * The refusal to raise before the next round, or `undefined` when the next round is affordable.
 *
 * Only reached after a completed round, so round 1 is never refused: there is nothing to project
 * from yet. The comparison is strict, matching the post-round `spent > ceiling`: a projection that
 * lands exactly on the ceiling still runs.
 */
function refuseNextRound(
  spent: number,
  lastRoundCost: number,
  ceiling: number,
  agentName: string,
): DelegationBudgetExceededError | undefined {
  if (!Number.isFinite(ceiling)) return undefined
  if (spent + lastRoundCost > ceiling) {
    return new DelegationBudgetExceededError(agentName, spent, ceiling, {
      projectedRoundCost: lastRoundCost,
    })
  }
  return undefined
}

/**
 * Throw the refusal {@link refuseNextRound} computes, unless the run was cancelled: an aborted run
 * returns what it spent instead of raising, because the caller asked it to stop, not the budget.
 * One call site in the loop: `runReflectiveLoopStream` sits at the eslint `complexity` limit of 15,
 * so the abort check and the throw cannot be written inline there.
 */
export function throwIfNextRoundRefused(
  spent: number,
  lastRoundCost: number,
  ceiling: number,
  agentName: string,
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted) return
  const refusal = refuseNextRound(spent, lastRoundCost, ceiling, agentName)
  if (refusal) throw refusal
}
