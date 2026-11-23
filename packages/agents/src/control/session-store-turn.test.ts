import { describe, expect, it, vi } from 'vitest'

import { createSessionStore } from './session-store.js'

interface Agent {
  steered: string[]
  disposed: boolean
}

const newAgent = (): Agent => ({ steered: [], disposed: false })

describe('createSessionStore with a custom turn', () => {
  it('runs the turn, steers and disposes through the options, and renames a refused id', async () => {
    const agent = newAgent()
    const store = createSessionStore<Agent>({
      build: async () => agent,
      badSessionCode: 'bad_frame',
      closedReason: 'closing',
      reportPrefix: 'p',
      runTurn: async (c) => {
        c.emit({ type: 'text', text: c.message } as never)
        return { ok: true }
      },
      steerAgent: async (a, message) => {
        a.steered.push(message)
      },
      dispose: async (a) => {
        a.disposed = true
      },
    })
    const events: unknown[] = []
    expect(
      await store.run(
        's',
        'hi',
        (e) => {
          events.push(e)
        },
        {},
      ),
    ).toEqual({ ok: true })
    expect(events).toHaveLength(1)
    expect(await store.run('bad id', 'hi', () => undefined, {})).toEqual({
      ok: false,
      code: 'bad_frame',
    })
    await store.close()
    expect(agent.disposed).toBe(true)
    expect(await store.run('s', 'hi', () => undefined, {})).toEqual({
      ok: false,
      code: 'turn_failed',
      reason: 'closing',
    })
  })

  it('cancels the run on interrupt, and answers no_turn once its events ended', async () => {
    const cancel = vi.fn(async () => undefined)
    let release = (): void => undefined
    let ended = (): void => undefined
    const reachedEnd = new Promise<void>((r) => {
      ended = r
    })
    let started = (): void => undefined
    const running = new Promise<void>((r) => {
      started = r
    })
    const store = createSessionStore<Agent>({
      build: async () => newAgent(),
      drainMs: 20,
      runTurn: async (c) => {
        c.onRun(cancel)
        started()
        await new Promise<void>((r) => {
          release = r
        })
        c.onEventsEnded()
        ended()
        await new Promise<void>(() => undefined)
        return { ok: true }
      },
      steerAgent: async () => undefined,
    })
    const first = store.run('s', 'a', () => undefined, {})
    await running
    expect(store.interrupt('s')).toBe('cancelled')
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    release()
    await reachedEnd
    expect(store.interrupt('s')).toBe('no_turn')
    expect(await store.steer('s', 'x')).toBe('no_turn')
    void first
  })
})
