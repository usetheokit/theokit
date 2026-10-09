/**
 * B-433, code review #72, review 2026-10-09: the run option `budget` has two spellings of one
 * ceiling, a number and `{ maxCostUsd }`, read on the same terms. `budget: NaN` (from
 * `Number(process.env.X)` on an unset variable) read as set and enforced nothing; it is refused with
 * a `DelegationError` naming `budget`. A ceiling of 0 or below leaves nothing to spend: it ends the
 * run with `DelegationBudgetExceededError`, the class it always ended in, but before the first
 * round instead of after paying for it. `Infinity` keeps meaning no ceiling (docs/adr/0023).
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import { MainLoopCapability } from '../../src/capability/agent-capabilities.js'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { AgentRunner, DelegationBudgetExceededError, DelegationError } from '../../src/index.js'

function buildRunner() {
  const compiled = applyCapabilities([
    new ModelCapability('test-model'),
    new MainLoopCapability({ maxIterations: 5 }),
  ])
  return AgentRunner.fromSpec({
    compiled,
    name: 'budgetAgent',
    strategy: 'plan-act-reflect',
  }).build()
}

/** Run with a numeric `budget` and return what the call threw, plus how many rounds were opened. */
async function runWith(budget: number): Promise<{ threw: unknown; calls: number }> {
  let calls = 0
  const streamFactory = (): AsyncIterable<StreamEvent> => {
    calls += 1
    return (async function* () {
      yield { type: 'done', cost: 0.01 }
    })()
  }
  try {
    await buildRunner().run('go', { apiKey: 'k', budget, maxIterations: 1, streamFactory })
  } catch (err) {
    return { threw: err, calls }
  }
  return { threw: undefined, calls }
}

describe('a numeric budget the run cannot enforce', () => {
  it('test_a_nan_numeric_budget_is_refused_before_any_round', async () => {
    const { threw, calls } = await runWith(Number.NaN)

    expect(calls).toBe(0)
    expect(threw).toBeInstanceOf(DelegationError)
    expect((threw as DelegationError).cause).toMatchObject({
      message: 'budget must be a number, got NaN',
    })
  })

  it.each([0, -1, Number.NEGATIVE_INFINITY])(
    'test_a_numeric_budget_of_%s_stops_as_budget_exceeded_before_any_round',
    async (budget) => {
      const { threw, calls } = await runWith(budget)

      expect(calls).toBe(0)
      expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
      const error = threw as InstanceType<typeof DelegationBudgetExceededError>
      expect(error.actualCost).toBe(0)
      expect(error.budgetLimit).toBe(budget)
    },
  )

  it.each([1, Number.POSITIVE_INFINITY])('test_a_numeric_budget_of_%s_runs', async (budget) => {
    const { threw, calls } = await runWith(budget)

    expect(threw).toBeUndefined()
    expect(calls).toBe(1)
  })
})
