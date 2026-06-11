/**
 * @Memory() — declares persistent memory configuration for an agent.
 *
 * Compiles to SDK's MemorySettings in Agent.create({ memory }).
 * Memory is per-agent, scoped by session strategy.
 *
 * @example
 * ```ts
 * @Agent({ name: 'support', route: '/api/agents/support' })
 * @Memory({ provider: 'built-in', embeddings: true, fts: true, scope: 'per-user' })
 * class SupportAgent { ... }
 * ```
 */
import { setMeta, getMeta } from '../metadata/index.js'

const MEMORY_CONFIG = Symbol.for('theokit:agents:memory')

export type MemoryProvider = 'built-in' | 'honcho' | 'supermemory' | 'mem0'
export type MemoryScope = 'per-user' | 'per-agent' | 'per-tenant' | 'global'

export interface MemoryOptions {
  /** Memory provider backend. */
  provider?: MemoryProvider
  /** Enable semantic search via embeddings. */
  embeddings?: boolean
  /** Enable full-text search (FTS5). */
  fts?: boolean
  /** Memory isolation scope (default: 'per-user'). */
  scope?: MemoryScope
  /** Maximum facts to retain per scope (0 = unlimited). */
  maxFacts?: number
}

export function Memory(options: MemoryOptions = {}): ClassDecorator {
  return (target: Function) => {
    setMeta(MEMORY_CONFIG, target, {
      provider: 'built-in',
      embeddings: false,
      fts: false,
      scope: 'per-user',
      ...options,
    })
  }
}

export function getMemoryConfig(target: Function): MemoryOptions | undefined {
  return getMeta<MemoryOptions>(MEMORY_CONFIG, target)
}
