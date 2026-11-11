import type { AgentOptions, MemoryAdapter, MemoryContext, Plugin } from '@theokit/sdk'

import { TheoClawConfigError } from '../control-plane/errors.js'
import { MAX_RECALLED_FACTS } from './memory-store.js'

export const MEMORY_BACKENDS = ['builtin', 'mem0', 'honcho', 'supermemory', 'sdk-memory'] as const
export type MemoryBackendName = (typeof MEMORY_BACKENDS)[number]

/** A hosted memory the owner's facts are mirrored to, and recalled from when a session opens. */
export interface RemoteMemory {
  readonly id: string
  write(fact: string, scope: string): Promise<void>
  recall(scope: string): Promise<string[]>
}

/** What the selected backend adds to the built-in store. */
export interface MemoryBackend {
  readonly name: MemoryBackendName
  readonly remote?: RemoteMemory
  /** Options added to every agent (`sdk-memory` sets its `memoryProvider`). */
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

function hosted(name: keyof typeof ADAPTERS, apiKey: string, cwd: string, importer: Importer): RemoteMemory {
  const spec = ADAPTERS[name]
  let adapter: Promise<MemoryAdapter> | undefined
  // Opened on first use: the package is imported then, so a backend nobody asks for costs nothing.
  const open = (): Promise<MemoryAdapter> =>
    (adapter ??= (async () => {
      let mod: Record<string, unknown>
      try {
        mod = await importer(spec.pkg)
      } catch (error) {
        throw new Error(`THEOCLAW_MEMORY_BACKEND=${name} needs ${spec.pkg} and ${spec.peer} installed (${String(error)})`)
      }
      const plugin = (mod[spec.factory] as (options: { apiKey: string }) => Plugin)({ apiKey })
      if (plugin.kind !== 'memory') throw new Error(`${spec.pkg} did not return a memory plugin`)
      const opened = await plugin.createProvider(cwd)
      await opened.initialize?.()
      return opened
    })())
  const context = (scope: string): MemoryContext => ({ userId: scope })
  return {
    id: name,
    async write(fact, scope) {
      await (await open()).write(fact, context(scope))
    },
    async recall(scope) {
      const opened = await open()
      const facts: string[] = []
      if (opened.list !== undefined) {
        for await (const item of opened.list(context(scope), { limit: MAX_RECALLED_FACTS })) {
          facts.push(item.content)
          if (facts.length >= MAX_RECALLED_FACTS) break
        }
      } else {
        for (const item of await opened.recall('facts about the user', context(scope), MAX_RECALLED_FACTS)) facts.push(item.content)
      }
      return facts
    },
  }
}

/**
 * The backend `THEOCLAW_MEMORY_BACKEND` selects. The hosted adapters take their key from
 * `MEM0_API_KEY`, `HONCHO_API_KEY` or `SUPERMEMORY_API_KEY`; `sdk-memory` hands the SDK its
 * markdown provider. Absent or `builtin`: undefined, the built-in store alone.
 */
export function memoryBackend(env: Readonly<Record<string, string | undefined>>, workspace: string, importer: Importer = defaultImporter): MemoryBackend | undefined {
  const name = memoryBackendName(env)
  if (name === 'builtin') return undefined
  if (name === 'sdk-memory') {
    return {
      name,
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
  return {
    name,
    remote: hosted(name, apiKey, workspace, importer),
    agentOptions: () => Promise.resolve({}),
  }
}
