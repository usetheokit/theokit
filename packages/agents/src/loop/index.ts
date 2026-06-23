/**
 * `loop/` barrel — public surface for the declarative loop runtime.
 *
 * Per architecture.md INVARIANT #3, public API flows through barrels only.
 * `runReflectiveLoop` is INTERNAL (Drawback #4) — it is the bridge's loop
 * driver, consumed by `delegate()`/`AgentRunner`, never imported by consumers.
 * `AgentRunner` is added here in T3.1.
 */
export {
  DEFAULT_MAX_ITERATIONS,
  type LoopFinishReason,
  type LoopOutcome,
  type LoopStrategy,
  type LoopStrategyConfig,
  loopStrategyConfigSchema,
  resolveLoopStrategy,
} from './loop-strategy.js'
export {
  ladderReflectionStrategy,
  type ReflectionResult,
  type ReflectionStrategy,
  type ReflectionStrategyConfig,
  reflectionStrategyConfigSchema,
} from './reflection-strategy.js'
