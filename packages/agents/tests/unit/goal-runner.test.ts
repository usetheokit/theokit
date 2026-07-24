import { describe, expect, it, vi } from 'vitest'

/**
 * M59 — `GoalRunner` is the OO twin of the SDK's free `runGoalLoop`. It must DELEGATE, never
 * reimplement (parsimony Rung 9). These tests pin the delegation two ways:
 *  1. it forwards the exact (agent, goal, options, deps) tuple to `runGoalLoop`;
 *  2. the `GoalEvent` stream and final `GoalResult` it produces are IDENTICAL to what `runGoalLoop`
 *     yields/returns — because `run` returns that very generator.
 */

const h = vi.hoisted(() => ({ calls: [] as unknown[][] }))

vi.mock('@theokit/sdk', () => ({
  // A fake goal loop with a KNOWN event/result shape. GoalRunner must surface it unchanged.
  runGoalLoop: vi.fn((agent: unknown, goal: string, options: unknown, deps: unknown) => {
    h.calls.push([agent, goal, options, deps])
    return (async function* () {
      yield { type: 'goal_start', goal } as unknown
      yield { type: 'iteration', n: 1 } as unknown
      return { status: 'achieved', finalResponse: `done: ${goal}` } as unknown
    })()
  }),
}))

const { GoalRunner } = await import('../../src/loop/goal-runner.js')
const sdk = await import('@theokit/sdk')

const AGENT = { id: 'fake-goal-agent' } as never

async function drain<T, R>(gen: AsyncGenerator<T, R, void>): Promise<{ events: T[]; result: R }> {
  const events: T[] = []
  let step = await gen.next()
  while (!step.done) {
    events.push(step.value)
    step = await gen.next()
  }
  return { events, result: step.value }
}

describe('M59 — GoalRunner delegates to the SDK runGoalLoop (Rung 9, no reimplementation)', () => {
  it('forwards the exact (agent, goal, options, deps) tuple to runGoalLoop', async () => {
    h.calls.length = 0
    const options = { judgeModel: 'x' } as never
    const deps = { now: () => 0 } as never
    const runner = new GoalRunner(AGENT)
    runner.run('ship it', options, deps)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]).toEqual([AGENT, 'ship it', options, deps])
  })

  it('surfaces the SAME GoalEvent stream and final GoalResult the loop yields (parity)', async () => {
    const runner = new GoalRunner(AGENT)
    const viaRunner = await drain(runner.run('build the thing'))
    const viaFree = await drain(
      (sdk.runGoalLoop as typeof sdk.runGoalLoop)(AGENT, 'build the thing') as never,
    )
    // Same events, same terminal result — the class adds a shape, not behavior.
    expect(viaRunner.events).toEqual(viaFree.events)
    expect(viaRunner.result).toEqual(viaFree.result)
    expect(viaRunner.result).toEqual({ status: 'achieved', finalResponse: 'done: build the thing' })
  })
})
