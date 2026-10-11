/**
 * B-409 (FR-005) — a `BudgetOptions` the run cannot enforce is refused before any round.
 *
 * `window` asks for a rolling daily or monthly budget, which needs spend persisted across runs; a
 * single run has nowhere to keep it, so honouring the field silently would cap nothing. A
 * `maxCostUsd` that is missing, `NaN` or not a number is no ceiling either. These are refused at
 * the call with `DelegationError`, before the round factory is invoked; `stream()` throws them
 * synchronously (D4), not at the first `next()`. A `maxCostUsd` of 0 or below leaves nothing to
 * spend: it stops the run with `DelegationBudgetExceededError` before any round, so a ceiling meant
 * to forbid spend is not charged one round. `Infinity`, like `null` and an absent `budget`, means
 * no ceiling (docs/adr/0023).
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import { MainLoopCapability } from '../../src/capability/agent-capabilities.js'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import {
  AgentRunner,
  type BudgetOptions,
  DelegationBudgetExceededError,
  DelegationError,
} from '../../src/index.js'

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

function rounds() {
  let calls = 0
  const factory = (): AsyncIterable<StreamEvent> => {
    calls += 1
    const round = calls
    return (async function* () {
      yield { type: 'tool_result', toolName: `t${String(round)}`, input: {}, output: 'r' }
      yield { type: 'done', cost: 0.01 }
    })()
  }
  return { factory, calls: () => calls }
}

/** Run with `budget` and return what the call threw, plus how many rounds were opened. */
async function refusal(budget: BudgetOptions): Promise<{ threw: unknown; calls: number }> {
  const { factory, calls } = rounds()
  try {
    await buildRunner().run('go', { apiKey: 'k', budget, streamFactory: factory })
  } catch (err) {
    return { threw: err, calls: calls() }
  }
  return { threw: undefined, calls: calls() }
}

async function expectRefusedNaming(budget: BudgetOptions, field: string): Promise<void> {
  const { threw, calls } = await refusal(budget)
  expect(calls).toBe(0)
  expect(threw).toBeInstanceOf(DelegationError)
  expect((threw as Error).message).toContain(field)
}

describe('a BudgetOptions the run cannot enforce', () => {
  it('test_a_budget_window_is_refused_before_any_round', async () => {
    await expectRefusedNaming({ maxCostUsd: 1, window: 'daily' }, 'window')
  })

  it.each([Number.NaN, undefined, '0.5'])(
    'test_a_max_cost_usd_of_%s_is_refused_before_any_round',
    async (maxCostUsd) => {
      await expectRefusedNaming({ maxCostUsd } as unknown as BudgetOptions, 'budget.maxCostUsd')
    },
  )

  it.each([0, -1, Number.NEGATIVE_INFINITY])(
    'test_a_max_cost_usd_of_%s_stops_as_budget_exceeded_before_any_round',
    async (maxCostUsd) => {
      const { threw, calls } = await refusal({ maxCostUsd })
      expect(calls).toBe(0)
      expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
      const error = threw as InstanceType<typeof DelegationBudgetExceededError>
      expect(error.actualCost).toBe(0)
      expect(error.budgetLimit).toBe(maxCostUsd)
      expect(error.message).toContain('before its first round')
    },
  )

  it('test_an_infinite_max_cost_usd_means_no_ceiling', async () => {
    const { threw, calls } = await refusal({ maxCostUsd: Number.POSITIVE_INFINITY })
    expect(threw).toBeUndefined()
    expect(calls).toBeGreaterThan(1)
  })

  it('test_a_budget_window_throws_at_the_stream_call', () => {
    const { factory, calls } = rounds()
    expect(() =>
      buildRunner().stream('go', {
        apiKey: 'k',
        budget: { maxCostUsd: 1, window: 'daily' },
        streamFactory: factory,
      }),
    ).toThrow(DelegationError)
    expect(calls()).toBe(0)
  })

  it('test_a_positive_ceiling_below_one_round_runs_one_round_then_stops_overspent', async () => {
    const { threw, calls } = await refusal({ maxCostUsd: 0.005 })
    expect(calls).toBe(1)
    expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
    const error = threw as InstanceType<typeof DelegationBudgetExceededError>
    expect(error.budgetLimit).toBe(0.005)
    expect(error.actualCost).toBe(0.01)
    expect(error.projectedRoundCost).toBeUndefined()
  })

  it('test_a_null_budget_is_treated_as_no_ceiling', async () => {
    const { factory, calls } = rounds()
    await buildRunner().run('go', {
      apiKey: 'k',
      budget: null as unknown as BudgetOptions,
      maxIterations: 2,
      streamFactory: factory,
    })
    expect(calls()).toBe(2)
  })
})
