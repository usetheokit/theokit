import { describe, expect, it, vi } from 'vitest'

import type { SdkMessage } from '../bridge/event-translator.js'
import type { SdkAgentHandle } from '../bridge/sdk-adapter.js'
import * as entry from '../control-entry.js'
import { createSessionStore } from './session-store.js'

interface Fake {
  agent: SdkAgentHandle<SdkMessage>
  sends: Array<{ message: string; opts: Record<string, unknown> }>
  dispose: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  /** Resolves every held send with a run that finishes when `finish` is called. */
  release: () => void
  finish: () => void
}

function fake(hold = false): Fake {
  const sends: Fake['sends'] = []
  const dispose = vi.fn(async () => {})
  const cancel = vi.fn(async () => {})
  let release = (): void => undefined
  const gate = new Promise<void>((r) => {
    release = r
  })
  let finish = (): void => undefined
  const done = new Promise<void>((r) => {
    finish = r
  })
  const agent = {
    agentId: 'a',
    dispose,
    send: async (message: string, opts: Record<string, unknown>) => {
      sends.push({ message, opts })
      if (hold) await gate
      return {
        cancel,
        wait: async () => {
          if (hold) await done
          return { status: 'finished' }
        },
      }
    },
  } as unknown as SdkAgentHandle<SdkMessage>
  return { agent, sends, dispose, cancel, release, finish }
}

const noop = (): void => undefined
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

describe('createSessionStore', () => {
  it('is exported from the control entry', () => {
    expect(entry.createSessionStore).toBe(createSessionStore)
  })

  it('two concurrent new sessions cannot both take the last slot', async () => {
    const f = fake(true)
    const store = createSessionStore({ build: async () => f.agent, max: 1 })
    const first = store.run('a', 'hi', noop, {})
    const second = await store.run('b', 'hi', noop, {})
    expect(second).toEqual({ ok: false, code: 'busy' })
    f.release()
    f.finish()
    expect((await first).ok).toBe(true)
    await store.close()
  })

  it('a full store evicts the least recently used idle session and disposes its agent', async () => {
    const agents: Fake[] = []
    const store = createSessionStore({
      build: async () => {
        const f = fake()
        agents.push(f)
        return f.agent
      },
      max: 2,
    })
    await store.run('a', 'x', noop, {})
    await store.run('b', 'x', noop, {})
    await store.run('a', 'x', noop, {})
    expect((await store.run('c', 'x', noop, {})).ok).toBe(true)
    expect(agents[1]!.dispose).toHaveBeenCalledTimes(1)
    expect(agents[0]!.dispose).not.toHaveBeenCalled()
    await store.close()
  })

  it('an interrupt sent before send resolves still cancels the turn', async () => {
    const f = fake(true)
    const store = createSessionStore({ build: async () => f.agent })
    const turn = store.run('a', 'hi', noop, {})
    await tick()
    expect(store.interrupt('a')).toBe('cancelled')
    expect(await turn).toEqual({ ok: false, code: 'interrupted' })
    f.release()
    await tick()
    expect(f.cancel).toHaveBeenCalled()
    await store.close()
  })

  it('the message after an interrupt carries the redirect note', async () => {
    const f = fake(true)
    const store = createSessionStore({
      build: async () => f.agent,
      redirectNote: 'NOTE:',
      drainMs: 20,
    })
    const turn = store.run('a', 'first', noop, {})
    await tick()
    store.interrupt('a')
    await turn
    f.release()
    f.finish()
    expect((await store.run('a', 'second', noop, {})).ok).toBe(true)
    expect(f.sends.at(-1)!.message).toBe('NOTE:second')
    await store.close()
  })

  it('steer on an idle session answers no_turn', async () => {
    const f = fake()
    const store = createSessionStore({ build: async () => f.agent })
    expect(await store.steer('a', 'x')).toBe('no_turn')
    await store.run('a', 'x', noop, {})
    expect(await store.steer('a', 'x')).toBe('no_turn')
    await store.close()
  })

  it('steer sends into a running turn with queueMode steer', async () => {
    const f = fake(true)
    const store = createSessionStore({ build: async () => f.agent })
    const turn = store.run('a', 'hi', noop, {})
    await tick()
    f.release()
    await tick()
    expect(await store.steer('a', 'more')).toBe('steered')
    expect(f.sends.at(-1)).toMatchObject({ message: 'more', opts: { queueMode: 'steer' } })
    f.finish()
    await turn
    await store.close()
  })

  it('cancelOwnedBy stops only the turns of that owner', async () => {
    const fa = fake(true)
    const fb = fake(true)
    const fs = [fa, fb]
    const store = createSessionStore({ build: async () => fs.shift()!.agent })
    const ownerA = {}
    const ownerB = {}
    const a = store.run('a', 'hi', noop, ownerA)
    const b = store.run('b', 'hi', noop, ownerB)
    await tick()
    store.cancelOwnedBy(ownerA)
    expect(await a).toEqual({ ok: false, code: 'interrupted' })
    expect(store.interrupt('b')).toBe('cancelled')
    await b
    await store.close()
  })

  it('an invalid session id answers bad_session', async () => {
    const store = createSessionStore({ build: async () => fake().agent })
    expect(await store.run('bad id!', 'x', noop, {})).toEqual({ ok: false, code: 'bad_session' })
    expect(await store.run('', 'x', noop, {})).toEqual({ ok: false, code: 'bad_session' })
  })

  it('a failing build answers turn_failed and never rejects', async () => {
    const store = createSessionStore({
      build: async () => {
        throw new Error('boom')
      },
    })
    expect(await store.run('a', 'x', noop, {})).toEqual({
      ok: false,
      code: 'turn_failed',
      reason: 'boom',
    })
  })

  it('close disposes every agent once and refuses later turns', async () => {
    const f = fake()
    const store = createSessionStore({ build: async () => f.agent })
    await store.run('a', 'x', noop, {})
    await store.close()
    expect(f.dispose).toHaveBeenCalledTimes(1)
    expect(await store.run('a', 'x', noop, {})).toMatchObject({ ok: false, code: 'turn_failed' })
  })

  it('rejects an invalid max', () => {
    expect(() => createSessionStore({ build: async () => fake().agent, max: 0 })).toThrow(
      RangeError,
    )
  })
})
