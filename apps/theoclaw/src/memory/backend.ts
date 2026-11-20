import type { AgentOptions, Plugin } from '@theokit/sdk'

import { TheoClawConfigError } from '../control-plane/errors.js'

export const MEMORY_BACKENDS = ['builtin', 'mem0', 'honcho', 'supermemory', 'sdk-memory'] as const
export type MemoryBackendName = (typeof MEMORY_BACKENDS)[number]

/** What the selected backend adds to the SDK's own memory. */
export interface MemoryBackend {
  readonly name: MemoryBackendName
  /** A hosted backend: the SDK mirrors every saved fact to its plugin and recalls from it first. */
  readonly mirrored: boolean
  /** Options added to every agent: the hosted plugin, or `sdk-memory`'s `memoryProvider`. */
  agentOptions(): Promise<Partial<AgentOptions>>
}

type Importer = (specifier: string) => Promise<Record<string, unknown>>
const defaultImporter: Importer = (specifier) => import(specifier) as Promise<Record<string, unknown>>

const ADAPTERS = {
  mem0: { pkg: '@theokit/memory-mem0', factory: 'mem0Memory', key: 'MEM0_API_KEY', peer: 'mem0ai' },
  honcho: {
    pkg: '@theokit/memory-honcho',
    factory: 'honchoMemory',
    key: 'HONCHO_API_KEY',
    peer: '@honcho-ai/sdk',
  },
  supermemory: {
    pkg: '@theokit/memory-supermemory',
    factory: 'supermemoryMemory',
    key: 'SUPERMEMORY_API_KEY',
    peer: 'supermemory',
  },
} as const

/** `THEOCLAW_MEMORY_BACKEND`: `builtin` (default), `mem0`, `honcho`, `supermemory` or `sdk-memory`. */
export function memoryBackendName(env: Readonly<Record<string, string | undefined>>): MemoryBackendName {
  const raw = (env.THEOCLAW_MEMORY_BACKEND ?? '').trim().toLowerCase()
  if (raw === '') return 'builtin'
  const found = MEMORY_BACKENDS.find((name) => name === raw)
  if (found === undefined) {
    throw new TheoClawConfigError(`THEOCLAW_MEMORY_BACKEND must be one of ${MEMORY_BACKENDS.join(', ')}, got "${raw}"`, { variable: 'THEOCLAW_MEMORY_BACKEND' })
  }
  return found
}

/** The memory plugin of a hosted backend, imported on first use so a backend nobody asks for costs nothing. */
function hostedPlugin(name: keyof typeof ADAPTERS, apiKey: string, importer: Importer): () => Promise<Plugin> {
  const spec = ADAPTERS[name]
  let plugin: Promise<Plugin> | undefined
  return () =>
    (plugin ??= (async () => {
      let mod: Record<string, unknown>
      try {
        mod = await importer(spec.pkg)
      } catch (error) {
        throw new Error(`THEOCLAW_MEMORY_BACKEND=${name} needs ${spec.pkg} and ${spec.peer} installed (${String(error)})`)
      }
      const made = (mod[spec.factory] as (options: { apiKey: string }) => Plugin)({ apiKey })
      if (made.kind !== 'memory') throw new Error(`${spec.pkg} did not return a memory plugin`)
      return made
    })())
}

/**
 * The backend `THEOCLAW_MEMORY_BACKEND` selects. The hosted adapters take their key from
 * `MEM0_API_KEY`, `HONCHO_API_KEY` or `SUPERMEMORY_API_KEY`; `sdk-memory` hands the SDK its
 * markdown provider; the SDK mirrors facts to the hosted plugin itself. Absent or `builtin`: undefined, the built-in store alone.
 */
export function memoryBackend(env: Readonly<Record<string, string | undefined>>, importer: Importer = defaultImporter): MemoryBackend | undefined {
  const name = memoryBackendName(env)
  if (name === 'builtin') return undefined
  if (name === 'sdk-memory') {
    return {
      name,
      mirrored: false,
      async agentOptions() {
        let mod: Record<string, unknown>
        try {
          mod = await importer('@theokit/sdk-memory')
        } catch (error) {
          throw new Error(`THEOCLAW_MEMORY_BACKEND=sdk-memory needs @theokit/sdk-memory installed (${String(error)})`)
        }
        return {
          memoryProvider: (mod.createInMemoryMarkdownProvider as () => unknown)(),
        } as Partial<AgentOptions>
      },
    }
  }
  const apiKey = env[ADAPTERS[name].key]?.trim() ?? ''
  if (apiKey === '') {
    throw new TheoClawConfigError(`THEOCLAW_MEMORY_BACKEND=${name} needs ${ADAPTERS[name].key}`, {
      variable: ADAPTERS[name].key,
    })
  }
  const plugin = hostedPlugin(name, apiKey, importer)
  return {
    name,
    mirrored: true,
    agentOptions: async () => ({ plugins: [await plugin()] }),
  }
}
