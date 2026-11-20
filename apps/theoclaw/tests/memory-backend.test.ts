import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { memoryBackend, memoryBackendName } from '../src/memory/backend.js'
import { createMemory } from '../src/memory/wiring.js'

const fakeMem0 = () => {
  const plugin = { kind: 'memory', createProvider: () => ({}) }
  const importer = (specifier: string) => Promise.resolve(specifier === '@theokit/memory-mem0' ? { mem0Memory: () => plugin } : {})
  return { plugin, importer }
}
const dir = () => mkdtempSync(join(tmpdir(), 'mem-'))

describe('THEOCLAW_MEMORY_BACKEND', () => {
  it('defaults to builtin and rejects an unknown name', () => {
    expect(memoryBackendName({})).toBe('builtin')
    expect(memoryBackend({})).toBeUndefined()
    expect(() => memoryBackendName({ THEOCLAW_MEMORY_BACKEND: 'nope' })).toThrow(/must be one of/)
  })

  it('needs the backend key', () => {
    expect(() => memoryBackend({ THEOCLAW_MEMORY_BACKEND: 'mem0' })).toThrow(/MEM0_API_KEY/)
  })

  it('hands every agent the mem0 plugin and has the SDK mirror facts to it and recall from it first', async () => {
    const { plugin, importer } = fakeMem0()
    const backend = memoryBackend({ THEOCLAW_MEMORY_BACKEND: 'mem0', MEM0_API_KEY: 'k' }, importer)
    const memory = createMemory(dir(), () => undefined, backend)
    expect((await memory.agentOptions()).plugins).toEqual([plugin])
    expect(memory.settings()).toMatchObject({ userId: 'owner', mirror: { write: true, recall: 'adapters-first' } })
  })

  it('keeps the SDK store alone, without a mirror, for the builtin backend', () => {
    expect(createMemory(dir(), () => undefined).settings().mirror).toBeUndefined()
  })

  it('falls back to the SDK store when the backend fails, and says so', async () => {
    const lines: string[] = []
    const backend = memoryBackend({ THEOCLAW_MEMORY_BACKEND: 'mem0', MEM0_API_KEY: 'k' }, () => Promise.reject(new Error('missing')))
    const memory = createMemory(dir(), (line) => lines.push(line), backend)
    expect(await memory.agentOptions()).toEqual({})
    expect(lines.join('\n')).toMatch(/needs @theokit\/memory-mem0/)
  })

  it('gives agents the sdk-memory provider', async () => {
    const provider = { kind: 'provider' }
    const backend = memoryBackend({ THEOCLAW_MEMORY_BACKEND: 'sdk-memory' }, () => Promise.resolve({ createInMemoryMarkdownProvider: () => provider }))
    expect(await backend?.agentOptions()).toEqual({ memoryProvider: provider })
  })
})
