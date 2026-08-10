import { runGoalLoop } from '@theokit/sdk'
import type { GoalEvent, GoalLoopAgent, GoalOptions, GoalResult } from '@theokit/sdk'

// M59 — the goal domain's types travel WITH `GoalRunner` (the layer owns the whole goal surface now):
// a consumer types against `GoalRunner` — `run(): AsyncGenerator<GoalEvent, GoalResult>`, the
// `GoalLoopAgent` it binds, the `GoalOptions` it takes — entirely from `@theokit/agents`, never
// reaching back to `@theokit/sdk`.
export type { GoalEvent, GoalLoopAgent, GoalOptions, GoalResult } from '@theokit/sdk'
// M80 — the judge's vocabulary crosses alongside. Without `JudgeResult`/`Verdict`, a consumer
// wanting to react to `blocked` without a magic string would have to redeclare the shape — and the
// UNBREAKABLE boundary stops it importing from the SDK. `JudgeCredentialError` is the error M80's
// fail-fast throws; whoever catches in the goal loop must tell it from any other failure.
export type { JudgeResult, Verdict } from '@theokit/sdk'
export { JudgeCredentialError } from '@theokit/sdk'

/**
 * M59 — `GoalRunner`, the OO twin of the SDK's free `runGoalLoop`, parallel to {@link AgentRunner}.
 *
 * The SDK ships goal orchestration as a free function: `runGoalLoop(agent, goal, options, deps)` drives
 * a goal to completion (Codex states + token budget, an LLM judge as the completion oracle), streaming
 * `GoalEvent`s and resolving a `GoalResult`. This class imposes the layer's OO shape on it so the
 * consumer authors `new GoalRunner(agent).run(goal, options)` instead of a bare function call — the same
 * `SDK → Theokit → AgentBuilder` boundary the M58 barrels established, here ENRICHING (a contract) an
 * orchestration primitive rather than passing a pure one through.
 *
 * It DELEGATES, never reimplements (parsimony Rung 9): `run` forwards verbatim to `runGoalLoop`, so the
 * emitted `GoalEvent` stream and the final `GoalResult` are identical to calling the SDK directly. The
 * parity test pins that by construction.
 */

/** The optional 4th arg of `runGoalLoop` (the SDK's internal `RunUntilDeps` — judge/clock overrides). */
export type GoalRunnerDeps = Parameters<typeof runGoalLoop>[3]

export class GoalRunner {
  constructor(private readonly agent: GoalLoopAgent) {}

  /**
   * Drive `goal` to completion against the bound agent. Returns the SAME async generator `runGoalLoop`
   * returns — yielding `GoalEvent`s, resolving a `GoalResult`. `deps` (judge/clock overrides) threads
   * straight through; a test seam for the judge lives there, exactly as on the free function.
   */
  run(
    goal: string,
    options?: GoalOptions,
    deps?: GoalRunnerDeps,
  ): AsyncGenerator<GoalEvent, GoalResult, void> {
    return runGoalLoop(this.agent, goal, options, deps)
  }
}
