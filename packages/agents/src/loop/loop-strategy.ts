/**
 * LoopStrategy — the per-round terminal-decision contract that gives runtime to
 * `@MainLoop({ strategy })`.
 *
 * V4-A proved `@MainLoop`'s `strategy` field was metadata-only (declared +
 * compiled, never executed). This module is the foundation Phase 2's
 * `runReflectiveLoop` branches on. Modeled on Mastra's `agentic-loop`/`stopWhen`
 * (inverted) + `maxSteps` ceiling — NOT Spring's per-call Advisor (plan ADR D1).
 * Config is Zod-validated so an invalid `maxIterations` fails fast at resolve
 * time, never as a silent infinite loop at runtime (plan ADR D3).
 *
 * referencia: knowledge-base/references/mastra agentic-loop/index.ts (stopWhen + maxSteps).
 */
import { z } from 'zod'

/** Why a single round ended (or, for the V4-D terminals, why the whole loop ended). */
export type LoopFinishReason =
  | 'tool-calls'
  | 'stop'
  | 'length'
  | 'error'
  // V4-D outer-loop terminals — set by runReflectiveLoop, not derived from a single round:
  | 'step_limit' // hit the maxIterations ceiling while the round still wanted to continue
  | 'no_progress' // the agent repeated the same round signature for K consecutive rounds

/** Value object describing one round's result. */
export interface LoopOutcome {
  /** Why the round ended (the continuation signal). */
  readonly finishReason: LoopFinishReason
  /** 1-indexed round number that just completed. */
  readonly round: number
  /** Tool calls executed during the round (V4-N: `id` correlates the call to its result). */
  readonly toolCalls: readonly { id: string; name: string; input: unknown; output: string }[]
  /** Accumulated assistant text for the round. */
  readonly responseText: string
}

/** The terminal-decision contract. `shouldContinue` is the inverted `stopWhen`. */
export interface LoopStrategy {
  /**
   * The strategy name, surfaced in `finalize`/logs. M54 relaxes this from
   * `MainLoopMeta['strategy']` to `string` so a caller-injected `.loopStrategy(custom)` can name
   * itself freely — the three built-ins keep their names, but the seam is no longer union-locked.
   * The INTERNAL resolution (`loopStrategyConfigSchema`) still validates the three built-in names
   * via `z.enum`; a custom never passes through it (it enters by the seam, not by name).
   */
  readonly name: string
  /** Hard ceiling on rounds — guarantees termination (enforced by the runner since M54). */
  readonly maxIterations: number
  /** True ⇒ re-enter for another round; false ⇒ terminate. The runner caps it at `maxIterations`. */
  shouldContinue(outcome: LoopOutcome): boolean
}

/** Default round ceiling when `@MainLoop` declares no `maxIterations` (EC-3: finite, never Infinity). */
export const DEFAULT_MAX_ITERATIONS = 8

/** Serializable config for a LoopStrategy. SSoT per type-safety.md (ADR D3). */
export const loopStrategyConfigSchema = z.object({
  name: z.enum(['simple-chat', 'plan-act-reflect', 'react']),
  maxIterations: z.number().int().min(1),
})

export type LoopStrategyConfig = z.infer<typeof loopStrategyConfigSchema>

/**
 * Map a `@MainLoop` strategy + ceiling to a concrete {@link LoopStrategy}.
 *
 * - `simple-chat` ⇒ exactly one round (`shouldContinue` always false).
 * - `react` ⇒ continue while the round ended on `tool-calls` AND the ceiling has not been reached
 *   (`round < maxIterations`) — the reflection is `noop` (no feedback), so the strategy IS the gate.
 * - `plan-act-reflect` ⇒ DEFER continuation to the reflection (V4-S): `shouldContinue` is
 *   `round < maxIterations`, so the loop continues iff the (custom) `ReflectionStrategy` returns
 *   `continue: true` within the ceiling — letting a reflection extend even a terminal (`stop`)
 *   round (e.g. "you answered without editing — make the edit now"). Backward-compatible with the
 *   default `ladderReflectionStrategy`, which itself returns `continue: true` only on `tool-calls`,
 *   so the observable behavior with the shipped ladder is unchanged.
 *
 * Throws (Zod) when `maxIterations < 1` — fail fast, never a silent infinite loop.
 */
export function resolveLoopStrategy(
  // M54 (D2): accepts `string`, but `loopStrategyConfigSchema` (`z.enum`) still admits ONLY the three
  // built-in names — an unknown name throws here (fail-fast), never resolving. A custom strategy
  // never reaches this function; it enters through `AgentRunnerBuilder.loopStrategy(obj)`.
  strategy: string,
  maxIterations: number = DEFAULT_MAX_ITERATIONS,
): LoopStrategy {
  const cfg = loopStrategyConfigSchema.parse({ name: strategy, maxIterations })

  if (cfg.name === 'simple-chat') {
    return { name: cfg.name, maxIterations: cfg.maxIterations, shouldContinue: () => false }
  }

  if (cfg.name === 'plan-act-reflect') {
    // V4-S: defer to the reflection — the ceiling is the only hard bound; the ReflectionStrategy
    // decides whether to continue (so a custom strategy can extend a terminal round).
    return {
      name: cfg.name,
      maxIterations: cfg.maxIterations,
      shouldContinue: (outcome: LoopOutcome): boolean => outcome.round < cfg.maxIterations,
    }
  }

  return {
    name: cfg.name,
    maxIterations: cfg.maxIterations,
    shouldContinue: (outcome: LoopOutcome): boolean =>
      outcome.finishReason === 'tool-calls' && outcome.round < cfg.maxIterations,
  }
}
