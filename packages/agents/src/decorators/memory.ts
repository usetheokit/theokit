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
import type { MemoryOptions } from '../types.js'

const MEMORY_CONFIG = Symbol.for('theokit:agents:memory')

export type { MemoryProvider } from '../types.js'
export type { MemoryScope } from '../types.js'

export type { MemoryOptions } from '../types.js'

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
