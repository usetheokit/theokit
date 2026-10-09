/**
 * B-433, code review #72: the run option `budget` has two spellings of one ceiling, a number and
 * `{ maxCostUsd }`. The object form refused 0, a negative and a non-finite value before any round,
 * while the number form was returned unchecked, so `budget: NaN` (from `Number(process.env.X)` on
 * an unset variable) read as set and enforced nothing, and `budget: 0` was charged one round. The
 * number is now refused on the same terms, with the same typed error, naming `budget`.
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import { MainLoopCapability } from '../../src/capability/agent-capabilities.js'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { AgentRunner, DelegationError } from '../../src/index.js'

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
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'test_a_numeric_budget_of_%s_is_refused_before_any_round',
    async (budget) => {
      const { threw, calls } = await runWith(budget)

      expect(calls).toBe(0)
      expect(threw).toBeInstanceOf(DelegationError)
      expect((threw as DelegationError).cause).toMatchObject({
        message: `budget must be a finite number > 0, got ${String(budget)}`,
      })
    },
  )

  it('test_a_positive_numeric_budget_still_runs', async () => {
    const { threw, calls } = await runWith(1)

    expect(threw).toBeUndefined()
    expect(calls).toBe(1)
  })
})
