import { describe, expect, it, vi } from 'vitest'

import { createStoreGoalAgent } from '../../src/commands/goal-store-agent.js'
import { forkCurrentSessionWith } from '../../src/persistence/fork-session.js'

describe('goal-loop turns vs a pending fork', () => {
  it('a goal turn sent while the fork copies makes the fork stale', async () => {
    const commit = vi.fn()
    let finish!: (v: { newId: string; copied: boolean }) => void
    const pending = forkCurrentSessionWith({
      newId: () => 'b',
      fork: () => new Promise((r) => (finish = r)),
      current: () => 'a',
      commit,
    })
    const agent = createStoreGoalAgent({
      send: vi.fn(),
      snapshot: () => ({ status: 'idle', thread: [] }) as never,
    })
    await agent.send('continue')
    finish({ newId: 'b', copied: true })
    expect(await pending).toEqual({ newId: 'a', copied: false, stale: true })
    expect(commit).not.toHaveBeenCalled()
  })
})
