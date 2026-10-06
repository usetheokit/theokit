/**
 * B-409 (FR-006) — with a USD ceiling set, a round whose cost is not known stops the run.
 *
 * The loop used to read a missing `done.cost` as $0, so an unpriced round looked free and the run
 * went on spending against a ceiling it could no longer enforce. The SDK leaves an unknown price
 * `undefined` rather than 0, and a ceiling that cannot be checked is refused (fail closed). Without
 * a ceiling nothing is being enforced, so the same rounds run as before.
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import { MainLoopCapability } from '../../src/capability/agent-capabilities.js'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import {
  AgentRunner,
  DelegationBudgetCostUnknownError,
  DelegationBudgetExceededError,
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

/** Rounds that ask to continue; `done` is the round's done event, or `undefined` for none at all. */
function rounds(done: StreamEvent | undefined) {
  let calls = 0
  const factory = (): AsyncIterable<StreamEvent> => {
    calls += 1
    const round = calls
    return (async function* () {
      yield { type: 'tool_result', toolName: `t${String(round)}`, input: {}, output: 'r' }
      if (done) yield done
    })()
  }
  return { factory, calls: () => calls }
}

async function runAndCatch(
  done: StreamEvent | undefined,
  budget: number,
): Promise<{ threw: unknown; calls: number }> {
  const { factory, calls } = rounds(done)
  try {
    await buildRunner().run('go', { apiKey: 'k', budget, streamFactory: factory })
  } catch (err) {
    return { threw: err, calls: calls() }
  }
  return { threw: undefined, calls: calls() }
}

async function runWithoutCeiling(done: StreamEvent | undefined): Promise<number> {
  const { factory, calls } = rounds(done)
  await buildRunner().run('go', { apiKey: 'k', maxIterations: 2, streamFactory: factory })
  return calls()
}

describe('a round whose cost is not known, against a USD ceiling', () => {
  it('test_a_round_with_no_price_stops_a_run_with_a_cost_ceiling', async () => {
    const { threw, calls } = await runAndCatch({ type: 'done' }, 0.015)

    // The round after an unpriced one never starts.
    expect(calls).toBe(1)
    expect(threw).toBeInstanceOf(DelegationBudgetCostUnknownError)
    expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
    const message = (threw as Error).message
    expect(message).toContain('0.0150')
    expect(message).toContain('is not known')
  })

  it('test_an_unpriced_refusal_reports_no_projected_round_cost', async () => {
    const { threw } = await runAndCatch({ type: 'done' }, 0.015)

    expect(threw).toBeInstanceOf(DelegationBudgetCostUnknownError)
    const error = threw as InstanceType<typeof DelegationBudgetExceededError>
    expect(error.projectedRoundCost).toBeUndefined()
  })

  it('test_an_unpriced_refusal_keeps_the_budget_exceeded_code_and_name', async () => {
    const { threw } = await runAndCatch({ type: 'done' }, 0.015)

    expect(threw).toBeInstanceOf(DelegationBudgetCostUnknownError)
    const error = threw as InstanceType<typeof DelegationBudgetExceededError>
    expect(error.code).toBe('DELEGATION_BUDGET_EXCEEDED')
    expect(error.name).toBe('DelegationBudgetExceededError')
  })

  it('test_a_round_with_no_price_continues_when_no_ceiling_is_set', async () => {
    expect(await runWithoutCeiling({ type: 'done' })).toBe(2)
  })

  it('test_a_round_that_never_emits_done_stops_a_run_with_a_cost_ceiling', async () => {
    const { threw, calls } = await runAndCatch(undefined, 0.015)

    // The round after an unpriced one never starts.
    expect(calls).toBe(1)
    expect(threw).toBeInstanceOf(DelegationBudgetCostUnknownError)
  })

  it('test_a_round_that_never_emits_done_continues_when_no_ceiling_is_set', async () => {
    expect(await runWithoutCeiling(undefined)).toBe(2)
  })

  it('test_a_non_finite_round_cost_is_refused_with_a_finite_spend', async () => {
    const { threw, calls } = await runAndCatch({ type: 'done', cost: Number.NaN }, 0.015)

    // The round after an unpriced one never starts.
    expect(calls).toBe(1)
    expect(threw).toBeInstanceOf(DelegationBudgetCostUnknownError)
    const error = threw as InstanceType<typeof DelegationBudgetExceededError>
    expect(Number.isFinite(error.actualCost)).toBe(true)
    expect(error.message).not.toContain('NaN')
  })
})
