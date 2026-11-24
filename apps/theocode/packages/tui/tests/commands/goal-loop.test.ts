import { afterEach, describe, expect, it, vi } from 'vitest'

import { GoalTurnFailedError } from '@theokit/agents/client'

const runGoal = vi.fn()
vi.mock('@theocode/agent/goal', () => ({
  GOAL_DEFAULTS: { maxTurns: 20, tokenBudget: 150_000 },
  routeGoalModel: () => 'm',
  runGoal: (...a: unknown[]) => runGoal(...a),
}))
vi.mock('@theocode/agent/config', () => ({
  resolveEffectiveConfig: () => ({ sandbox_mode: 'x', goal_oracle: 'judge', model: 'm' }),
}))

import { runGoalLoop } from '../../src/commands/goal.js'
import { forkCurrentSessionWith } from '../../src/persistence/fork-session.js'

function start(sendAndWait: ReturnType<typeof vi.fn>) {
  const done = new Promise<void>((resolve) => {
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
  return done
}

afterEach(() => {
  vi.useRealTimers()
  runGoal.mockReset()
})

describe('goal loop over sendAndWait', () => {
  it('completes two turns with fake timers never advanced', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
    const sendAndWait = vi
      .fn()
      .mockResolvedValueOnce({ status: 'done', text: 'one', usage: { totalTokens: 3 } })
      .mockResolvedValueOnce({ status: 'done', text: 'two' })
    const results: unknown[] = []
    runGoal.mockImplementation(
      async (agent: { send(p: string): Promise<{ wait(): Promise<unknown> }> }) => {
        for (const p of ['a', 'b']) results.push(await (await agent.send(p)).wait())
        return { status: 'completed', turnsUsed: 2, tokensUsed: 3 }
      },
    )
    await start(sendAndWait)
    expect(results).toEqual([{ result: 'one', usage: { totalTokens: 3 } }, { result: 'two' }])
    expect(sendAndWait).toHaveBeenNthCalledWith(1, { message: 'a' })
    expect(sendAndWait).toHaveBeenNthCalledWith(2, { message: 'b' })
  })

  it('an errored turn rejects with GoalTurnFailedError carrying status and cause', async () => {
    const cause = new Error('boom')
    const sendAndWait = vi.fn().mockResolvedValue({ status: 'error', error: cause })
    let caught: unknown
    runGoal.mockImplementation(
      async (agent: { send(p: string): Promise<{ wait(): Promise<unknown> }> }) => {
        try {
          await (await agent.send('a')).wait()
        } catch (e) {
          caught = e
          throw e
        }
      },
    )
    await start(sendAndWait)
    expect(caught).toBeInstanceOf(GoalTurnFailedError)
    expect((caught as GoalTurnFailedError).status).toBe('error')
    expect((caught as GoalTurnFailedError).cause).toBe(cause)
  })

  it('a goal turn sent while a fork copies makes the fork stale', async () => {
    const commit = vi.fn()
    let finish!: (v: { newId: string; copied: boolean }) => void
    const pending = forkCurrentSessionWith({
      newId: () => 'b',
      fork: () => new Promise((r) => (finish = r)),
      current: () => 'a',
      commit,
    })
    const sendAndWait = vi.fn().mockResolvedValue({ status: 'done' })
    runGoal.mockImplementation(async (agent: { send(p: string): Promise<unknown> }) => {
      await agent.send('continue')
      return { status: 'completed', turnsUsed: 1, tokensUsed: 0 }
    })
    await start(sendAndWait)
    finish({ newId: 'b', copied: true })
    expect(await pending).toEqual({ newId: 'a', copied: false, stale: true })
    expect(commit).not.toHaveBeenCalled()
  })
})
