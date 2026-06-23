/**
 * ReflectionStrategy — composes INTO the loop between rounds (the loop calls
 * `reflect()` then `LoopStrategy.shouldContinue()`).
 *
 * `'plan-act-reflect'` resolves to the `'ladder'` default shipped here; a custom
 * strategy may be supplied (OCP — plan Drawback #2). `reflect()` is pure (no
 * I/O, no LLM) — it inspects the round's outcome and returns feedback to inject
 * into the next round's prompt plus a `continue` hint. The hard round ceiling
 * lives in `LoopStrategy.shouldContinue` (maxIterations), NOT here.
 *
 * referencia: knowledge-base/references/mastra agentic-loop/index.ts (onIterationComplete → { feedback, continue }).
 */
import { z } from 'zod'

import type { LoopOutcome } from './loop-strategy.js'

/** Result of reflecting on a completed round. */
export interface ReflectionResult {
  /** Optional text prepended to the next round's prompt. */
  readonly feedback?: string
  /** Hint: should the loop reflect-and-continue? (the ceiling still bounds it) */
  readonly continue: boolean
}

/** Pluggable between-round reflection. Pure — never performs I/O. */
export interface ReflectionStrategy {
  /** Strategy identifier (e.g. `'ladder'`). */
  readonly name: string
  /** Inspect the round outcome; return feedback + continue hint. */
  reflect(outcome: LoopOutcome): ReflectionResult
}

/** Serializable config for a ReflectionStrategy. SSoT per type-safety.md (ADR D3). */
export const reflectionStrategyConfigSchema = z.object({
  name: z.string().min(1),
})

export type ReflectionStrategyConfig = z.infer<typeof reflectionStrategyConfigSchema>

/**
 * The default `'ladder'` reflection (what `'plan-act-reflect'` resolves to).
 *
 * Continues with bounded templated feedback while the round ended on
 * `tool-calls`; terminates on any terminal `finishReason` (`stop`/`error`/
 * `length`). The feedback is a short fixed template (bounded — EC-5; context
 * growth is the SDK's responsibility, not the loop's).
 */
export const ladderReflectionStrategy: ReflectionStrategy = {
  name: 'ladder',
  reflect(outcome: LoopOutcome): ReflectionResult {
    if (outcome.finishReason === 'tool-calls') {
      return {
        feedback: `Tool results received (round ${outcome.round}). Reflect on whether the goal is met; if not, refine the approach and continue.`,
        continue: true,
      }
    }
    return { continue: false }
  },
}

/**
 * No-op reflection for `'react'` (multi-round WITHOUT reflection feedback).
 *
 * Returns `{ continue: true }` (no feedback) so the round-continuation decision
 * is delegated entirely to `LoopStrategy.shouldContinue` (i.e. `react` loops
 * while `finishReason === 'tool-calls'` under the ceiling). NOTE: the plan's
 * pseudo-code (Files-to-edit) sketched `{ continue: false }`, which would make
 * `react` single-shot — that contradicts the plan's own Deep Dives ("`react`
 * still multi-rounds while finishReason==='tool-calls'"); `continue: true` is
 * the behavior the resolved react LoopStrategy requires.
 */
export const noopReflectionStrategy: ReflectionStrategy = {
  name: 'noop',
  reflect(): ReflectionResult {
    return { continue: true }
  },
}
