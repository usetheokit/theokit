/**
 * `@Compaction(name, opts)` — declares the agent's transcript-compaction strategy
 * (V4-F). Metadata-only: it records the choice; `AgentRunner.build()` resolves it
 * to a concrete {@link TranscriptCompactionStrategy} via `resolveCompactionStrategy`
 * (EC-5 — an invalid name/budget fails fast at build, not at decoration).
 *
 * Mirrors the `@ContextWindow` metadata pattern (`setMeta`/`getMeta` + a unique
 * Symbol). NOT auto-applied by the loop (ADR D1) — the resolved strategy is exposed
 * as `runner.compaction` for the app to call.
 *
 * @example
 * ```ts
 * @Agent({ model })
 * @Compaction('token-budget', { keepTokens: 8000 })
 * class CodeAgent {}
 * ```
 */
import { setMeta, getMeta } from '../metadata/index.js'

const COMPACTION_CONFIG = Symbol.for('theokit:agents:compaction')

/** Stored `@Compaction` declaration (resolved + validated at `AgentRunner.build()`). */
export interface CompactionDecoratorConfig {
  /** Strategy name (e.g. `'token-budget'`). Validated at resolve time. */
  name: string
  /** Token budget for `'token-budget'`. Required at resolve time (EC-2). */
  keepTokens?: number
}

export function Compaction(name: string, options: { keepTokens?: number } = {}): ClassDecorator {
  return (target: Function) => {
    setMeta(COMPACTION_CONFIG, target, { name, keepTokens: options.keepTokens })
  }
}

export function getCompactionConfig(target: Function): CompactionDecoratorConfig | undefined {
  return getMeta<CompactionDecoratorConfig>(COMPACTION_CONFIG, target)
}
