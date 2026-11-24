import { describe, expect, it, vi } from 'vitest'

// The real GoalRunner drives the real adapter; only the judge (a network call) is stubbed.
vi.mock('@theocode/agent/goal', async (orig) => {
  const actual = await orig<typeof import('@theocode/agent/goal')>()
  return {
    ...actual,
    runGoal: (a: never, g: string, o: never, d: Record<string, unknown>) =>
      actual.runGoal(a, g, o, {
        ...d,
        depsOverride: { judge: async () => ({ verdict: 'done', reason: 'ok' }) } as never,
      } as never),
  }
})
vi.mock('@theocode/agent/config', async (orig) => ({
  ...(await orig<typeof import('@theocode/agent/config')>()),
  resolveEffectiveConfig: () => ({ sandbox_mode: 'x', goal_oracle: 'judge', model: 'm' }),
}))

import { runGoalLoop } from '../../src/commands/goal.js'

async function run(sendAndWait: ReturnType<typeof vi.fn>) {
  const feed: Array<string | null> = []
  const toasts: Array<{ message: string }> = []
  let finalRun: unknown
  await new Promise<void>((resolve) => {
    runGoalLoop('ship it', undefined, {
      agentRef: { current: { status: 'idle', sendAndWait } },
      goalAbort: { current: null },
      setGoalRun: (v: unknown) => {
        if (typeof v === 'function') {
          finalRun = (v as (g: unknown) => unknown)({
            objective: 'ship it',
            status: 'active',
            startedAt: 0,
          })
          resolve()
        }
      },
      setGoalFeed: (v: string | null) => feed.push(v),
      setToast: (t: { message: string }) => toasts.push(t),
      credential: () => ({ kind: 'api', provider: 'p', apiKey: 'k' }),
    } as never)
  })
  return { feed, toasts, finalRun }
}

describe('goal loop with the real runner', () => {
  it('completes when the turn settles done', async () => {
    const r = await run(vi.fn().mockResolvedValue({ status: 'done', text: 'x' }))
    expect(r.finalRun).toMatchObject({ status: 'completed' })
  })

  it.each(['error', 'aborted'] as const)(
    'a turn settling %s ends the goal visibly',
    async (status) => {
      const sendAndWait = vi.fn().mockResolvedValue({ status, error: new Error('boom') })
      const r = await run(sendAndWait)
      expect(r.finalRun).not.toMatchObject({ status: 'completed' })
      const seen = [...r.feed, ...r.toasts.map((t) => t.message)].join('\n')
      expect(seen).toMatch(/failed|aborted|error|blocked/i)
    },
  )
})
