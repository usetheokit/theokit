/**
 * #2238 — creation reporting against the REAL `@theokit/sdk`: the SDK's in-flight map and live-agent
 * cache stay the authority, so one id is one handle and the wiring is reported once, by the call that
 * created the agent.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Agent } from '@theokit/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { compileAgentDefinition, defineAgent } from '../../src/bridge/define-agent.js'
import { createSdkAgentStream, toAgentFactory } from '../../src/bridge/sdk-adapter.js'
import {
  getOrCreateReporting,
  acquireSharedAgent,
  releaseSharedAgent,
  type CompiledWiring,
} from '../../src/bridge/compiled-wiring.js'

let cwd: string
let n = 0
const ids: string[] = []
const nextId = () => {
  const id = `creation-cache-${process.pid}-${Date.now()}-${n++}`
  ids.push(id)
  return id
}
const opts = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  apiKey: 'sk-test-0123456789abcdef',
  model: { id: 'openai/gpt-4o-mini' },
  local: { cwd },
  ...extra,
})
const get = (id: string, listener?: (w: CompiledWiring) => void, extra?: Record<string, unknown>) =>
  getOrCreateReporting(Agent, id, opts(extra), listener) as Promise<{
    dispose(): Promise<void>
  }>

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'creation-cache-'))
})

afterEach(async () => {
  for (const id of ids.splice(0)) await Agent.registry.get(id)?.dispose()
  await Agent.registry.evictAll()
  rmSync(cwd, { recursive: true, force: true })
})

describe('getOrCreateReporting against the real SDK', () => {
  it('reports once and shares one handle across simultaneous listener calls', async () => {
    const id = nextId()
    const seen: CompiledWiring[] = []
    const calls = Array.from({ length: 5 }, () => get(id, (w) => seen.push(w)))
    const handles = await Promise.all(calls)
    expect(new Set(handles).size).toBe(1)
    expect(seen).toHaveLength(1)
  })

  it('reports once when listener and no-listener calls race, in either order', async () => {
    for (const order of [0, 1]) {
      const id = nextId()
      const seen: CompiledWiring[] = []
      const withL = () => get(id, (w) => seen.push(w))
      const without = () => get(id)
      const handles = await Promise.all(order === 0 ? [withL(), without()] : [without(), withL()])
      expect(handles[0]).toBe(handles[1])
      // The creator is the first caller: only it can be told it created.
      expect(seen).toHaveLength(order === 0 ? 1 : 0)
    }
  })

  it('serves the live-cache handle and reports nothing on a hit', async () => {
    const id = nextId()
    const seen: CompiledWiring[] = []
    const first = await get(id, (w) => seen.push(w))
    const second = await get(id, (w) => seen.push(w))
    expect(second).toBe(first)
    expect(Agent.registry.get(id)).toBe(first)
    expect(seen).toHaveLength(1)
  })

  it('shares the handle with a direct SDK getOrCreate', async () => {
    const id = nextId()
    const direct = await Agent.getOrCreate(id, opts() as never)
    const seen: CompiledWiring[] = []
    const ours = await get(id, (w) => seen.push(w))
    expect(ours).toBe(direct)
    expect(seen).toHaveLength(0)
  })

  it('reports nothing for a persisted agent that is not live, and caches the resumed handle', async () => {
    const id = nextId()
    const persisted = await Agent.create({ ...opts(), agentId: id } as never)
    await persisted.dispose()
    await Agent.registry.evictAll()
    const seen: CompiledWiring[] = []
    const a = await get(id, (w) => seen.push(w))
    const b = await get(id, (w) => seen.push(w))
    expect(b).toBe(a)
    expect(seen).toHaveLength(0)
  })

  it("keeps the caller's own onBeforeCreate and runs it first", async () => {
    const id = nextId()
    const order: string[] = []
    await get(id, () => order.push('wired'), {
      onBeforeCreate: () => {
        order.push('own')
      },
    })
    expect(order).toEqual(['own', 'wired'])
  })

  it('reports nothing when creation fails, and reports on the retry', async () => {
    const id = nextId()
    const seen: CompiledWiring[] = []
    const failing = get(id, (w) => seen.push(w), {
      onBeforeCreate: () => {
        throw new Error('denied')
      },
    })
    await expect(failing).rejects.toThrow('denied')
    expect(seen).toHaveLength(0)
    await get(id, (w) => seen.push(w))
    expect(seen).toHaveLength(1)
  })

  const acquire = (id: string) =>
    acquireSharedAgent(Agent, id, opts(), undefined) as Promise<{ dispose(): Promise<void> }>

  it('keeps the shared handle cached until the last overlapping user releases it', async () => {
    const id = nextId()
    const a = await acquire(id)
    const b = await acquire(id)
    expect(b).toBe(a)
    await releaseSharedAgent(a)
    expect(Agent.registry.get(id)).toBe(a)
    expect(await get(id)).toBe(a)
    await releaseSharedAgent(b)
    expect(Agent.registry.get(id)).toBeUndefined()
  })

  const served = (id: string) =>
    acquireSharedAgent(Agent, id, opts(), undefined, 'served') as Promise<{
      dispose(): Promise<void>
    }>

  it('repeated served disposal never consumes a stream hold', async () => {
    const id = nextId()
    const owner = await served(id)
    const stream = await acquire(id)
    expect(stream).toBe(owner)
    await owner.dispose()
    await owner.dispose()
    await owner.dispose()
    expect(Agent.registry.get(id)).toBe(stream)
    await releaseSharedAgent(stream)
    expect(Agent.registry.get(id)).toBeUndefined()
  })

  it('a direct SDK dispose of the registry handle cannot drop a stream hold', async () => {
    const id = nextId()
    const stream = await acquire(id)
    await Agent.registry.get(id)?.dispose()
    expect(Agent.registry.get(id)).toBe(stream)
    await releaseSharedAgent(stream)
    expect(Agent.registry.get(id)).toBeUndefined()
  })

  it('an acquire racing the last release never receives a disposed handle', async () => {
    const id = nextId()
    const first = await acquire(id)
    const releasing = releaseSharedAgent(first)
    const second = await acquire(id)
    await releasing
    expect(second).not.toBe(first)
    expect(Agent.registry.get(id)).toBe(second)
  })
})

describe('the real adapter entry points', () => {
  const key = 'theo_test_creation_cache'
  const approvals = { kind: 'owned-by-surface', reason: 'test' } as const
  const factory = (extra: Record<string, unknown> = {}) =>
    toAgentFactory(defineAgent({ model: 'openai/gpt-4o-mini', ...extra }), {
      apiKey: key,
      approvals,
      overrides: { cwd },
    })
  it('two toAgentFactory calls return the registry handle', async () => {
    const id = nextId()
    const make = factory()
    const [a, b] = await Promise.all([make(id), make(id)])
    expect(b).toBe(a)
    expect(a).toBe(Agent.registry.get(id))
    await a.dispose()
    await a.dispose()
    expect(Agent.registry.get(id)).toBeUndefined()
  })

  it.each([
    [
      'guardrails',
      { guardrails: [{ name: 'g', checkOutput: () => ({ action: 'allow' as const }) }] },
    ],
    ['maxIterations', { maxIterations: 3 }],
  ])('two toAgentFactory calls share one handle with %s', async (_n, extra) => {
    const id = nextId()
    const make = factory(extra)
    const a = await make(id)
    const b = await make(id)
    expect(b).toBe(a)
    expect(a).toBe(Agent.registry.get(id))
    await a.dispose()
    expect(Agent.registry.get(id)).toBe(a)
    await b.dispose()
    await b.dispose()
    expect(Agent.registry.get(id)).toBeUndefined()
  })

  it("a later factory without guardrails cannot strip an earlier factory's guards", async () => {
    const id = nextId()
    const block = { name: 'b', checkInput: () => ({ action: 'block' as const, reason: 'no' }) }
    const guarded = await factory({ guardrails: [block] })(id)
    const plain = await factory()(id)
    expect(plain).toBe(guarded)
    expect(plain).toBe(Agent.registry.get(id))
    await expect(plain.send('hi')).rejects.toThrow()
    await guarded.dispose()
    await plain.dispose()
    expect(Agent.registry.get(id)).toBeUndefined()
  })

  // The adapter's own stream generator: its first event comes after the agent is acquired and
  // before the turn ends, so the test can hold the stream open while a served caller completes.
  const adapterStream = (id: string) =>
    createSdkAgentStream(
      compileAgentDefinition(defineAgent({ model: 'openai/gpt-4o-mini' })),
      [],
      key,
      {
        cwd,
      },
    )('Return only: BANANA', id)[Symbol.asyncIterator]()

  it('a served caller completing leaves an active stream live through its completion', async () => {
    const id = nextId()
    const running = adapterStream(id)
    const first = await running.next()
    expect(first.done).toBe(false)
    const live = Agent.registry.get(id)
    expect(live, 'the stream holds the agent while open').toBeDefined()

    const servedHandle = await factory()(id)
    expect(servedHandle).toBe(live)
    await servedHandle.dispose()
    await servedHandle.dispose()
    expect(Agent.registry.get(id)).toBe(live)

    while (!(await running.next()).done) {
      /* drain */
    }
    expect(Agent.registry.get(id)).toBeUndefined()
  })

  it('a stream completing leaves an active served handle live', async () => {
    const id = nextId()
    const servedHandle = await factory()(id)
    const running = adapterStream(id)
    expect((await running.next()).done).toBe(false)
    while (!(await running.next()).done) {
      /* drain */
    }
    expect(Agent.registry.get(id)).toBe(servedHandle)
    await servedHandle.dispose()
    expect(Agent.registry.get(id)).toBeUndefined()
  })
})
