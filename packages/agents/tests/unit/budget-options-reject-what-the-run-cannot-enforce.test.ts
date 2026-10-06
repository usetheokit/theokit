/**
 * B-409 (FR-005) — a `BudgetOptions` the run cannot enforce is refused before any round.
 *
 * `window` asks for a rolling daily or monthly budget, which needs spend persisted across runs; a
 * single run has nowhere to keep it, so honouring the field silently would cap nothing. A
 * `maxCostUsd` that is missing, negative, not finite or not a number is no ceiling either. All of
 * these are refused at the call, with the round factory never invoked. A `null` budget, which an
 * untyped caller can pass, means no ceiling, the same as leaving `budget` out.
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import { MainLoopCapability } from '../../src/capability/agent-capabilities.js'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { AgentRunner, type BudgetOptions, DelegationError } from '../../src/index.js'

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

  it('test_a_negative_or_non_finite_max_cost_usd_is_refused_before_any_round', async () => {
    await expectRefusedNaming({ maxCostUsd: -1 }, 'maxCostUsd')
    await expectRefusedNaming({ maxCostUsd: Number.NaN }, 'maxCostUsd')
  })

  it('test_a_missing_or_string_max_cost_usd_is_refused_before_any_round', async () => {
    await expectRefusedNaming({} as BudgetOptions, 'maxCostUsd')
    await expectRefusedNaming({ maxCostUsd: '0.5' } as unknown as BudgetOptions, 'maxCostUsd')
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
