import { describe, expect, it, vi } from 'vitest'

vi.mock('@theocode/agent/goal', () => ({
  GOAL_DEFAULTS: { maxTurns: 20, tokenBudget: 150_000 },
  routeGoalModel: () => 'm',
  runGoal: async (agent: { send(p: string): Promise<unknown> }) => {
    await agent.send('continue')
    return { status: 'completed', turnsUsed: 1, tokensUsed: 0 }
  },
}))
vi.mock('@theocode/agent/config', () => ({
  resolveEffectiveConfig: () => ({ sandbox_mode: 'x', goal_oracle: 'judge', model: 'm' }),
}))

import { runGoalLoop } from '../../src/commands/goal.js'
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
    const sendAndWait = vi.fn().mockResolvedValue({ status: 'done' })
    await new Promise<void>((resolve) => {
      runGoalLoop('ship it', undefined, {
        agentRef: { current: { status: 'idle', sendAndWait } },
        goalAbort: { current: null },
        setGoalRun: (v: unknown) => {
          if (typeof v === 'function') resolve()
        },
        setGoalFeed: vi.fn(),
        setToast: vi.fn(),
        credential: () => ({ kind: 'api', provider: 'p', apiKey: 'k' }),
      } as never)
    })
    finish({ newId: 'b', copied: true })
    expect(await pending).toEqual({ newId: 'a', copied: false, stale: true })
    expect(commit).not.toHaveBeenCalled()
    expect(sendAndWait).toHaveBeenCalledWith({ message: 'continue' })
  })
})
