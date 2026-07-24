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
import type { ContextWindowOptions } from '../bridge/compile-context-window.js'
import { setMeta, getMeta } from '../metadata/index.js'

const CONTEXT_WINDOW_CONFIG = Symbol.for('theokit:agents:context-window')

export type { ContextCompactionStrategy } from '../bridge/compile-context-window.js'

export type { ContextWindowOptions } from '../bridge/compile-context-window.js'

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
