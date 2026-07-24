/**
 * M8-1 — compile `@ContextWindow` metadata into the SDK's `ContextSettings`.
 *
 * Per sdk-runtime.md, the SDK owns session/transcript storage + compaction.
 * The bridge therefore maps the one knob the SDK natively exposes as a budget —
 * `maxTokens` → `ContextSettings.maxTokens` — and reports the strategy knobs that
 * have NO native `AgentOptions` equivalent (`compactionStrategy`, `preserveLastN`,
 * `preserveToolResults`, `preserveSystemPrompt`). Those are surfaced as
 * `metadataOnlyKnobs` so the walk can emit an honest `metadata-only` warning
 * (ADR D2) instead of silently dropping them (G10 — honest enforcement).
 */
import type { ContextSettings } from '@theokit/sdk'

/** How to compact the transcript when `maxTokens` is exceeded. */
export type ContextCompactionStrategy =
  | 'truncate-oldest'
  | 'summarize-oldest'
  | 'sliding-window'
  | 'priority-based'

/**
 * M53 — declared here, with its conversion, instead of on the decorator being deleted.
 */
export interface ContextWindowOptions {
  /** Maximum tokens before compaction triggers. */
  maxTokens?: number
  /** How to compact when maxTokens is exceeded. */
  compactionStrategy?: ContextCompactionStrategy
  /** Always preserve the system prompt during compaction (default: true). */
  preserveSystemPrompt?: boolean
  /** Number of recent messages to always keep intact (default: 10). */
  preserveLastN?: number
  /** Keep all tool results even during compaction (default: true). */
  preserveToolResults?: boolean
}

/** `@ContextWindow` knobs with no native SDK `AgentOptions` mapping. */
const STRATEGY_KNOBS = [
  'compactionStrategy',
  'preserveLastN',
  'preserveToolResults',
  'preserveSystemPrompt',
] as const

export interface CompiledContextWindow {
  /** SDK-shaped context budget passed to `Agent.create({ context })`. */
  context: ContextSettings
  /** Declared knobs the SDK does not expose — reported, never silently dropped. */
  metadataOnlyKnobs: string[]
}

export function compileContextWindow(options: ContextWindowOptions): CompiledContextWindow {
  const context: ContextSettings = {}
  if (typeof options.maxTokens === 'number') {
    context.maxTokens = options.maxTokens
  }

  const opts = options as Record<string, unknown>
  const metadataOnlyKnobs = STRATEGY_KNOBS.filter((knob) => opts[knob] !== undefined)

  return { context, metadataOnlyKnobs }
}
