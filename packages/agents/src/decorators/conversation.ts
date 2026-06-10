/**
 * @Conversation() — declares conversation persistence strategy for an agent.
 *
 * Controls how the agent remembers message history across sessions.
 * Compiles to SDK's ConversationStorageAdapter configuration.
 *
 * @example
 * ```ts
 * @Agent({ name: 'support', route: '/support' })
 * @Conversation({
 *   storage: 'drizzle',
 *   maxHistory: 100,
 *   compaction: 'summarize',
 *   ttl: 24 * 60 * 60 * 1000,
 * })
 * class SupportAgent { ... }
 * ```
 */
import { setMeta, getMeta } from '../metadata/index.js'

const CONVERSATION_CONFIG = Symbol.for('theokit:agents:conversation')

export type ConversationStorage = 'memory' | 'filesystem' | 'drizzle' | 'redis'
export type CompactionStrategy = 'truncate' | 'summarize' | 'sliding-window'

export interface ConversationOptions {
  /** Storage backend for conversation history. */
  storage?: ConversationStorage
  /** Maximum messages before compaction triggers (0 = no limit). */
  maxHistory?: number
  /** How to compact when maxHistory is exceeded. */
  compaction?: CompactionStrategy
  /** Time-to-live in milliseconds before conversation expires (0 = never). */
  ttl?: number
  /** Number of recent messages to always preserve during compaction. */
  preserveLastN?: number
}

export function Conversation(options: ConversationOptions = {}): ClassDecorator {
  return (target: Function) => {
    setMeta(CONVERSATION_CONFIG, target, {
      storage: 'memory',
      maxHistory: 0,
      compaction: 'truncate',
      ttl: 0,
      preserveLastN: 5,
      ...options,
    })
  }
}

export function getConversationConfig(target: Function): ConversationOptions | undefined {
  return getMeta<ConversationOptions>(CONVERSATION_CONFIG, target)
}
