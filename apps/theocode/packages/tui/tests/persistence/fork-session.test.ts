import { describe, expect, it, vi } from 'vitest'

import { handleFork } from '../../src/commands/session-commands.js'
import { forkCurrentSessionWith } from '../../src/persistence/fork-session.js'

function harness(fork: (from: string, to: string) => Promise<{ newId: string; copied: boolean }>) {
  let current = 'a'
  let blocked = false
  const commit = vi.fn((id: string) => {
    current = id
  })
  return {
    commit,
    move: (id: string) => {
      current = id
    },
    block: () => {
      blocked = true
    },
    run: () =>
      forkCurrentSessionWith({
        newId: () => 'b',
        fork,
        current: () => current,
        commit,
        shouldCommit: () => !blocked,
      }),
  }
}

describe('forkCurrentSessionWith with a delayed fork', () => {
  it('commits when nothing changed while it ran', async () => {
    const h = harness(async (_f, to) => ({ newId: to, copied: true }))
    expect(await h.run()).toEqual({ newId: 'b', copied: true })
    expect(h.commit).toHaveBeenCalledWith('b')
  })

  it('does not commit when the session changed while it ran', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const h = harness(async (_f, to) => {
      await gate
      return { newId: to, copied: true }
    })
    const pending = h.run()
    h.move('other')
    release()
    expect(await pending).toEqual({ newId: 'b', copied: true, switched: false })
    expect(h.commit).not.toHaveBeenCalled()
  })

  it('does not commit when a turn started while it ran', async () => {
    const h = harness(async (_f, to) => {
      h.block()
      return { newId: to, copied: true }
    })
    expect((await h.run()).switched).toBe(false)
    expect(h.commit).not.toHaveBeenCalled()
  })

  it('reports an absent transcript as not copied', async () => {
    const h = harness(async () => ({ newId: 'b', copied: false }))
    expect(await h.run()).toEqual({ newId: 'a', copied: false })
    expect(h.commit).not.toHaveBeenCalled()
  })
})

describe('handleFork reports the real outcome', () => {
  it('toasts the failure of a rejected fork', async () => {
    const setToast = vi.fn()
    await handleFork(() => Promise.reject(new Error('boom')), setToast)
    expect(setToast.mock.calls[0]![0].message).toMatch(/Fork failed: boom/)
  })

  it('does not claim a copy that did not happen', async () => {
    const setToast = vi.fn()
    await handleFork(() => Promise.resolve({ newId: 'a', copied: false }), setToast)
    expect(setToast.mock.calls[0]![0].message).toMatch(/no prior transcript/)
  })
})
