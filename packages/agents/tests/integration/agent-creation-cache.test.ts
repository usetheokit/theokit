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

import {
  getOrCreateReporting,
  acquireSharedAgent,
  leaseSharedAgent,
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

  it('a served owner disposing does not dispose a handle a stream still holds', async () => {
    const id = nextId()
    const served = leaseSharedAgent(await acquire(id))
    const stream = await acquire(id)
    await served.dispose()
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

  it('two served acquisitions of one live session share the registry handle', async () => {
    const id = nextId()
    const a = leaseSharedAgent(await acquire(id))
    const b = leaseSharedAgent(await acquire(id))
    expect(b).toBe(a)
    expect(a).toBe(Agent.registry.get(id))
    await a.dispose()
    expect(Agent.registry.get(id)).toBe(b)
    await b.dispose()
    expect(Agent.registry.get(id)).toBeUndefined()
  })

  it('overlapping served and stream callers: the stream finishing first keeps the served handle', async () => {
    const id = nextId()
    const served = leaseSharedAgent(await acquire(id))
    const stream = await acquire(id)
    expect(stream).toBe(served)
    await releaseSharedAgent(stream)
    expect(Agent.registry.get(id)).toBe(served)
    await served.dispose()
    expect(Agent.registry.get(id)).toBeUndefined()
  })
})
