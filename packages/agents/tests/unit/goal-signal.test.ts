import { describe, expect, it } from 'vitest'
import { createGoalSignal } from '../../src/loop/goal-signal.js'
import { GoalRunner, type GoalLoopAgent } from '../../src/loop/index.js'

const ctx = {} as never

describe('createGoalSignal', () => {
  it('the judge answers continue until update_goal is called', async () => {
    const s = createGoalSignal()
    expect(s.status()).toBeUndefined()
    expect(await s.judge(ctx)).toEqual({
      verdict: 'continue',
      reason: 'no update_goal call yet',
      parseFailed: false,
    })
  })

  it('update_goal complete makes the judge answer done, blocked answers blocked', async () => {
    const a = createGoalSignal()
    await a.tool.handler({ status: 'complete' })
    expect((await a.judge(ctx)).verdict).toBe('done')
    expect(a.status()).toBe('complete')
    const b = createGoalSignal()
    await b.tool.handler({ status: 'blocked' })
    expect((await b.judge(ctx)).verdict).toBe('blocked')
  })

  it('reset clears the status', async () => {
    const s = createGoalSignal()
    await s.tool.handler({ status: 'complete' })
    s.reset()
    expect(s.status()).toBeUndefined()
    expect((await s.judge(ctx)).verdict).toBe('continue')
  })

  it('an invalid status is refused by the tool input schema', async () => {
    const s = createGoalSignal()
    await expect(
      Promise.resolve().then(() => s.tool.handler({ status: 'paused' })),
    ).rejects.toThrow()
    expect(s.status()).toBeUndefined()
  })

  it('the tool name and description can be set', () => {
    const s = createGoalSignal({ toolName: 'finish', description: 'd' })
    expect(s.tool.name).toBe('finish')
    expect(s.tool.description).toBe('d')
    expect(createGoalSignal().tool.description).toMatch(/Do NOT use this to pause or manage budget/)
  })

  it('a GoalRunner with the signal judge stops after the round that called the tool', async () => {
    const s = createGoalSignal()
    let rounds = 0
    const agent = {
      send: async () => {
        rounds += 1
        if (rounds === 2) await s.tool.handler({ status: 'complete' })
        return {
          id: `r${rounds}`,
          stream: async function* () {},
          wait: async () => ({ status: 'finished', result: 'ok' }),
        }
      },
    } as unknown as GoalLoopAgent
    const gen = new GoalRunner(agent).run('ship', { maxIterations: 5 } as never, { judge: s.judge })
    let step = await gen.next()
    while (!step.done) step = await gen.next()
    expect(rounds).toBe(2)
  })
})
