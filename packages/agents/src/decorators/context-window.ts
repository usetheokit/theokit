/**
 * @ContextWindow() — declares context window management strategy.
 *
 * Controls how the agent handles context when conversation history grows
 * beyond the LLM's context window. Mirrors Claude Code's PreCompact behavior.
 *
 * @example
 * ```ts
 * @Agent({ name: 'research', route: '/research' })
 * @ContextWindow({
 *   maxTokens: 100_000,
 *   compactionStrategy: 'summarize-oldest',
 *   preserveSystemPrompt: true,
 *   preserveLastN: 10,
 * })
 * class ResearchAgent { ... }
 * ```
 */
import { setMeta, getMeta } from '../metadata/index.js'

const CONTEXT_WINDOW_CONFIG = Symbol.for('theokit:agents:context-window')

export type ContextCompactionStrategy =
  | 'truncate-oldest'      // Drop oldest messages beyond limit
  | 'summarize-oldest'     // LLM-summarize oldest messages into a single message
  | 'sliding-window'       // Keep last N messages only
  | 'priority-based'       // Keep tool results + recent; summarize reasoning

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

export function ContextWindow(options: ContextWindowOptions = {}): ClassDecorator {
  return (target: Function) => {
    setMeta(CONTEXT_WINDOW_CONFIG, target, {
      maxTokens: 100_000,
      compactionStrategy: 'summarize-oldest',
      preserveSystemPrompt: true,
      preserveLastN: 10,
      preserveToolResults: true,
      ...options,
    })
  }
}

export function getContextWindowConfig(target: Function): ContextWindowOptions | undefined {
  return getMeta<ContextWindowOptions>(CONTEXT_WINDOW_CONFIG, target)
}
