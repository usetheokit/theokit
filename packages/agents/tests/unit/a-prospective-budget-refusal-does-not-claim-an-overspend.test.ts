/**
 * B-409 (FR-003) — a refusal before a round and an overspend after one are different facts, and
 * the error message must not state the second when the first happened.
 *
 * The overspend wording `$actual > $limit` is true only after the spend passed the limit. When the
 * loop stops BEFORE a round because the projected next round would pass the limit, the spend so far
 * is still under it, so printing `$0.0100 > $0.0150` would state something false.
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import { MainLoopCapability } from '../../src/capability/agent-capabilities.js'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { AgentRunner, DelegationBudgetExceededError } from '../../src/index.js'

/**
 * Each call is one round: a distinct tool result (so the loop continues) and a done with `cost`.
 * Given several costs, round N costs the Nth and every later round the last one.
 */
function roundsCosting(...costs: number[]): {
  factory: () => AsyncIterable<StreamEvent>
  calls: () => number
} {
  let calls = 0
  const factory = (): AsyncIterable<StreamEvent> => {
    calls += 1
    const round = calls
    const cost = costs[Math.min(round, costs.length) - 1]
    return (async function* () {
      yield { type: 'tool_result', toolName: `t${String(round)}`, input: {}, output: 'r' }
      yield { type: 'done', cost }
    })()
  }
  return { factory, calls: () => calls }
}

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

async function runAndCatch(budget: number, cost: number): Promise<unknown> {
  return (await runCounting(budget, cost)).threw
}

async function runCounting(
  budget: number,
  ...costs: number[]
): Promise<{ threw: unknown; calls: number }> {
  const { factory, calls } = roundsCosting(...costs)
  try {
    await buildRunner().run('go', { apiKey: 'k', budget, streamFactory: factory })
  } catch (err) {
    return { threw: err, calls: calls() }
  }
  return { threw: undefined, calls: calls() }
}

describe('the budget refusal and the overspend are worded as what they are', () => {
  it('test_a_prospective_budget_refusal_does_not_claim_an_overspend', async () => {
    const threw = await runAndCatch(0.015, 0.01)

    expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
    const message = (threw as Error).message
    expect(message).toContain('0.0150')
    expect(message).toContain('0.0100')
    expect(message).toContain('projected')
    expect(message).not.toContain('$0.0100 > $0.0150')
  })

  it('test_a_prospective_refusal_reports_the_projected_round_cost', async () => {
    const threw = await runAndCatch(0.015, 0.01)

    expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
    const error = threw as InstanceType<typeof DelegationBudgetExceededError>
    expect(error.projectedRoundCost).toBe(0.01)
  })

  it('test_an_overspend_reports_no_projected_round_cost', async () => {
    const threw = await runAndCatch(0.005, 0.01)

    expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
    const error = threw as InstanceType<typeof DelegationBudgetExceededError>
    expect(error.projectedRoundCost).toBeUndefined()
  })

  it('test_a_round_costlier_than_the_last_is_still_caught_after_it_runs', async () => {
    // Round 1 costs $0.01, so round 2 is projected at $0.01 and $0.02 fits under $0.03. Round 2
    // then costs $0.05, which only the post-round check can see.
    const { threw, calls } = await runCounting(0.03, 0.01, 0.05)

    expect(calls).toBe(2)
    expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
    const error = threw as InstanceType<typeof DelegationBudgetExceededError>
    expect(error.message).toContain('$0.0600 > $0.0300')
    expect(error.projectedRoundCost).toBeUndefined()
  })

  it('test_an_overspend_after_a_round_keeps_its_overspend_wording', async () => {
    const threw = await runAndCatch(0.005, 0.01)

    expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
    const error = threw as InstanceType<typeof DelegationBudgetExceededError>
    expect(error.message).toContain('$0.0100 > $0.0050')
    expect(error.code).toBe('DELEGATION_BUDGET_EXCEEDED')
  })
})
