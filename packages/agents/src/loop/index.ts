/**
 * `loop/` barrel — public surface for the declarative loop runtime.
 *
 * Per architecture.md INVARIANT #3, public API flows through barrels only.
 * `runReflectiveLoop` is INTERNAL (Drawback #4) — it is the bridge's loop
 * driver, consumed by `delegate()`/`AgentRunner`, never imported by consumers.
 * `AgentRunner` (T3.1) — the imperative twin builder — is exported; the loop
 * DRIVER `runReflectiveLoop` stays internal.
 */
export { AgentRunner, AgentRunnerBuilder, type AgentRunnerRunOptions } from './agent-runner.js'
// V4-R: the per-round stream factory type — public so a consumer can type an injected `streamFactory`
// (the loop DRIVER `runReflectiveLoop` stays internal; only the factory contract is exported).
export type { RoundStreamFactory } from './run-reflective-loop.js'
export {
  DEFAULT_KEEP_TOKENS,
  type CompactionCallOptions,
  type CompactionStrategyConfig,
  type CompressibleMessage,
  compactionStrategyConfigSchema,
  resolveCompactionStrategy,
  type Summarize,
  tokenBudgetCompactionStrategy,
  type TranscriptCompactionStrategy,
} from './compaction-strategy.js'
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
  noopReflectionStrategy,
  type ReflectionContext,
  type ReflectionResult,
  type ReflectionStrategy,
  type ReflectionStrategyConfig,
  reflectionStrategyConfigSchema,
} from './reflection-strategy.js'
