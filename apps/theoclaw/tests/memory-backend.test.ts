import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Agent, type MemoryContext } from '@theokit/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { memoryBackend, memoryBackendName } from '../src/memory/backend.js'
import { createMemory } from '../src/memory/wiring.js'
import { startModelStub } from './model-stub.js'

/** A hosted memory in process: what the SDK writes to it, and what it recalls by user. */
const fakeMem0 = () => {
  const written: { content: unknown; userId: string }[] = []
  const adapter = {
    id: 'mem0',
    capabilities: {
      history: false,
      sessions: false,
      tenancy: false,
      reasoning: false,
      toolSchemas: false,
      prefetch: false,
    },
    isAvailable: () => true,
    write: (content: unknown, ctx: MemoryContext) => {
      written.push({ content, userId: ctx.userId })
      return Promise.resolve('mem0:1')
    },
    recall: (_q: string, ctx: MemoryContext) =>
      Promise.resolve(
        written
          .filter((w) => w.userId === ctx.userId)
          .map((w, i) => ({ id: `mem0:${i}`, content: String(w.content) })),
      ),
    delete: () => Promise.resolve(),
  }
  const plugin = { kind: 'memory', name: 'mem0', createProvider: () => adapter }
  const importer = (specifier: string) =>
    Promise.resolve(specifier === '@theokit/memory-mem0' ? { mem0Memory: () => plugin } : {})
  return { plugin, written, importer }
}

afterEach(() => vi.unstubAllEnvs())

/** One real SDK agent opened the way TheoClaw opens it (`createMemory`'s settings and backend options); `reply` is what the model stub says. */
async function agentWith(
  memory: ReturnType<typeof createMemory>,
  reply: readonly Parameters<typeof startModelStub>[0][],
) {
  const stub = await startModelStub(reply[0])
  vi.stubEnv('OPENAI_API_BASE_URL', stub.url)
  vi.stubEnv('HOME', dir())
  const agent = await Agent.create({
    model: 'openai/stub',
    apiKey: 'sk-stub-key-0123456789',
    withheldBuiltinTools: ['shell'],
    local: { cwd: dir() },
    memory: memory.settings(),
    ...(await memory.agentOptions()),
  })
  return { agent, stub }
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

  it(
    'mirrors a saved fact to mem0 and recalls it in a new session',
    { timeout: 60_000 },
    async () => {
      const { written, importer } = fakeMem0()
      const backend = memoryBackend(
        { THEOCLAW_MEMORY_BACKEND: 'mem0', MEM0_API_KEY: 'k' },
        importer,
      )
      const first = await agentWith(
        createMemory(dir(), () => undefined, backend),
        [[{ text: 'noted' }]],
      )
      await (await first.agent.send('Remember: The owner lives in Lisbon')).wait()
      await first.agent.dispose()
      await first.stub.close()
      expect(written).toEqual([{ content: 'The owner lives in Lisbon', userId: 'owner' }])
      // A new chat on a fresh local directory still recalls it: it comes from Mem0.
      const second = await agentWith(
        createMemory(dir(), () => undefined, backend),
        [[{ text: 'ok' }]],
      )
      await (await second.agent.send('where do I live?')).wait()
      await second.agent.dispose()
      await second.stub.close()
      expect(JSON.stringify(second.stub.requests)).toContain('The owner lives in Lisbon')
    },
  )

  it(
    'mirrors a fact the post-turn reviewer saved to mem0, once, and recalls it in a new session',
    { timeout: 60_000 },
    async () => {
      const { written, importer } = fakeMem0()
      const backend = memoryBackend(
        { THEOCLAW_MEMORY_BACKEND: 'mem0', MEM0_API_KEY: 'k' },
        importer,
      )
      const memory = createMemory(dir(), () => undefined, backend)
      const review = [
        { text: 'noted' },
        {
          toolCalls: [
            { name: 'save_memory', args: { fact: 'The owner keeps a heron called Quillon-7731' } },
          ],
        },
        { text: 'done' },
      ]
      const first = await agentWith(memory, [review])
      // The SDK agent itself, without TheoClaw's recording wrapper: the SDK mirrors the reviewer's fact.
      await (await first.agent.send('hello')).wait()
      await first.agent.dispose()
      await first.stub.close()
      expect(written).toEqual([
        { content: 'The owner keeps a heron called Quillon-7731', userId: 'owner' },
      ])
      const second = await agentWith(
        createMemory(dir(), () => undefined, backend),
        [[{ text: 'ok' }]],
      )
      await (await second.agent.send('what do you know?')).wait()
      await second.agent.dispose()
      await second.stub.close()
      expect(JSON.stringify(second.stub.requests)).toContain('Quillon-7731')
    },
  )

  it('hands every agent the mem0 plugin and has the SDK mirror facts to it and recall from it first', async () => {
    const { plugin, importer } = fakeMem0()
    const backend = memoryBackend({ THEOCLAW_MEMORY_BACKEND: 'mem0', MEM0_API_KEY: 'k' }, importer)
    const memory = createMemory(dir(), () => undefined, backend)
    expect((await memory.agentOptions()).plugins).toEqual([plugin])
    expect(memory.settings()).toMatchObject({
      userId: 'owner',
      mirror: { write: true, recall: 'adapters-first' },
    })
  })

  it('keeps the SDK store alone, without a mirror, for the builtin backend', () => {
    expect(createMemory(dir(), () => undefined).settings().mirror).toBeUndefined()
  })

  it('falls back to the local store when the backend fails', { timeout: 60_000 }, async () => {
    const lines: string[] = []
    const backend = memoryBackend({ THEOCLAW_MEMORY_BACKEND: 'mem0', MEM0_API_KEY: 'k' }, () =>
      Promise.reject(new Error('missing')),
    )
    const local = dir()
    const first = await agentWith(
      createMemory(local, (line) => lines.push(line), backend),
      [[{ text: 'noted' }]],
    )
    await (await first.agent.send('Remember: local fact')).wait()
    await first.agent.dispose()
    await first.stub.close()
    const second = await agentWith(
      createMemory(local, (line) => lines.push(line), backend),
      [[{ text: 'ok' }]],
    )
    await (await second.agent.send('what do you know?')).wait()
    await second.agent.dispose()
    await second.stub.close()
    expect(JSON.stringify(second.stub.requests)).toContain('local fact')
    expect(lines.join('\n')).toMatch(/needs @theokit\/memory-mem0/)
  })

  it('gives agents the sdk-memory provider', async () => {
    const provider = { kind: 'provider' }
    const backend = memoryBackend({ THEOCLAW_MEMORY_BACKEND: 'sdk-memory' }, () =>
      Promise.resolve({ createInMemoryMarkdownProvider: () => provider }),
    )
    expect(await backend?.agentOptions()).toEqual({ memoryProvider: provider })
  })
})
