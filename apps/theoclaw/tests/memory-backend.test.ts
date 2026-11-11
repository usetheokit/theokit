import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { memoryBackend, memoryBackendName } from '../src/memory/backend.js'
import { createMemory } from '../src/memory/wiring.js'

const fakeMem0 = () => {
  const written: { content: unknown; userId: string }[] = []
  const adapter = {
    write: (content: unknown, ctx: { userId: string }) => {
      written.push({ content, userId: ctx.userId })
      return Promise.resolve('1')
    },
    recall: (_q: string, ctx: { userId: string }) => Promise.resolve(written.filter((w) => w.userId === ctx.userId).map((w) => ({ id: '1', content: String(w.content) }))),
  }
  const importer = (specifier: string) => Promise.resolve(specifier === '@theokit/memory-mem0' ? { mem0Memory: () => ({ kind: 'memory', createProvider: () => adapter }) } : {})
  return { written, importer }
}

describe('THEOCLAW_MEMORY_BACKEND', () => {
  it('defaults to builtin and rejects an unknown name', () => {
    expect(memoryBackendName({})).toBe('builtin')
    expect(memoryBackend({}, '/w')).toBeUndefined()
    expect(() => memoryBackendName({ THEOCLAW_MEMORY_BACKEND: 'nope' })).toThrow(/must be one of/)
  })

  it('needs the backend key', () => {
    expect(() => memoryBackend({ THEOCLAW_MEMORY_BACKEND: 'mem0' }, '/w')).toThrow(/MEM0_API_KEY/)
  })

  it('mirrors a saved fact to mem0 and recalls it in a new session', async () => {
    const { written, importer } = fakeMem0()
    const backend = memoryBackend({ THEOCLAW_MEMORY_BACKEND: 'mem0', MEM0_API_KEY: 'k' }, '/w', importer)
    const dir = mkdtempSync(join(tmpdir(), 'mem-'))
    const first = createMemory(dir, () => undefined, backend)
    first.store.saveFact('The owner lives in Lisbon')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(written).toEqual([{ content: 'The owner lives in Lisbon', userId: 'owner' }])
    // A new chat on a fresh local directory still recalls it: it comes from Mem0.
    const second = createMemory(mkdtempSync(join(tmpdir(), 'mem-')), () => undefined, backend)
    expect(await second.recall('owner')).toContain('- The owner lives in Lisbon')
  })

  it('falls back to the local store when the backend fails', async () => {
    const lines: string[] = []
    const backend = memoryBackend({ THEOCLAW_MEMORY_BACKEND: 'mem0', MEM0_API_KEY: 'k' }, '/w', () => Promise.reject(new Error('missing')))
    const memory = createMemory(mkdtempSync(join(tmpdir(), 'mem-')), (line) => lines.push(line), backend)
    memory.store.saveFact('local fact')
    expect(await memory.recall('owner')).toContain('- local fact')
    expect(lines.join('\n')).toMatch(/needs @theokit\/memory-mem0/)
  })

  it('gives agents the sdk-memory provider', async () => {
    const provider = { kind: 'provider' }
    const backend = memoryBackend({ THEOCLAW_MEMORY_BACKEND: 'sdk-memory' }, '/w', () => Promise.resolve({ createInMemoryMarkdownProvider: () => provider }))
    expect(await backend?.agentOptions()).toEqual({ memoryProvider: provider })
  })
})
