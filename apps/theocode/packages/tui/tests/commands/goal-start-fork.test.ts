import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/commands/goal.js', () => ({ runGoalLoop: vi.fn() }))
vi.mock('../../src/commands/interpret-command.js', () => ({
  // Mirrors the real `/goal` handler: it only calls the injected startGoal.
  interpretCommand: (_a: unknown, _t: string, cap: { startGoal: (o: string) => void }) =>
    cap.startGoal('ship it'),
}))
vi.mock('../../src/commands/registry.js', () => ({ routeCommand: () => ({ kind: 'goal' }) }))

import { useComposerCommands } from '../../src/commands/use-composer-commands.js'
import { forkCurrentSessionWith } from '../../src/persistence/fork-session.js'

describe('goal start vs a pending fork', () => {
  it('a goal started while the fork copies makes the fork stale', async () => {
    const commit = vi.fn()
    let finish!: (v: { newId: string; copied: boolean }) => void
    const pending = forkCurrentSessionWith({
      newId: () => 'b',
      fork: () => new Promise((r) => (finish = r)),
      current: () => 'a',
      commit,
    })
    const { handleSubmit } = useComposerCommands({
      reviewResult: null,
      goalFeed: null,
      goalActive: false,
      customCommandNames: [],
    } as never)
    handleSubmit('/goal ship it')
    finish({ newId: 'b', copied: true })
    expect(await pending).toEqual({ newId: 'a', copied: false, stale: true })
    expect(commit).not.toHaveBeenCalled()
  })
})
