import { describe, expect, it, vi } from 'vitest'

import { forkCurrentSessionWith, noteTurnStart } from '../../src/persistence/fork-session.js'

describe('forkCurrentSessionWith', () => {
  it('commits the copy once an async fork resolves', async () => {
    const commit = vi.fn()
    const out = await forkCurrentSessionWith({
      newId: () => 'b',
      fork: () => Promise.resolve({ newId: 'b', copied: true }),
      current: () => 'a',
      commit,
    })
    expect(out).toEqual({ newId: 'b', copied: true })
    expect(commit).toHaveBeenCalledWith('b')
  })

  it('does not adopt the copy when the session changed while it was pending', async () => {
    let cur = 'a'
    const commit = vi.fn()
    const out = await forkCurrentSessionWith({
      newId: () => 'b',
      fork: () => {
        cur = 'z'
        return Promise.resolve({ newId: 'b', copied: true })
      },
      current: () => cur,
      commit,
    })
    expect(out).toEqual({ newId: 'z', copied: false, stale: true })
    expect(commit).not.toHaveBeenCalled()
  })

  it('stays on the current session when nothing was copied, and propagates failure', async () => {
    const commit = vi.fn()
    const base = { newId: () => 'b', current: () => 'a', commit }
    expect(
      await forkCurrentSessionWith({ ...base, fork: () => ({ newId: 'b', copied: false }) }),
    ).toEqual({ newId: 'a', copied: false })
    await expect(
      forkCurrentSessionWith({ ...base, fork: () => Promise.reject(new Error('x')) }),
    ).rejects.toThrow('x')
  })

  it('does not adopt the copy when a new turn started on the same session meanwhile', async () => {
    const commit = vi.fn()
    const out = await forkCurrentSessionWith({
      newId: () => 'b',
      fork: () => {
        noteTurnStart()
        return Promise.resolve({ newId: 'b', copied: true })
      },
      current: () => 'a',
      commit,
    })
    expect(out).toEqual({ newId: 'a', copied: false, stale: true })
    expect(commit).not.toHaveBeenCalled()
  })

  it('a fork started after a turn began is not stale from earlier turns', async () => {
    noteTurnStart()
    const commit = vi.fn()
    const out = await forkCurrentSessionWith({
      newId: () => 'b',
      fork: () => Promise.resolve({ newId: 'b', copied: true }),
      current: () => 'a',
      commit,
    })
    expect(out.copied).toBe(true)
    expect(commit).toHaveBeenCalledWith('b')
  })
})
