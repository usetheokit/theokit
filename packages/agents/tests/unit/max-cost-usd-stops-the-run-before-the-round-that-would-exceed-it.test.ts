/**
 * B-409 (FR-001) — `maxCostUsd` is the run's USD ceiling when it is passed as `budget`.
 *
 * `BudgetOptions.maxCostUsd` was exported and read by nothing, so a consumer who set it got no
 * ceiling at all. The run option `budget` now accepts it, and the ceiling stops the run before the
 * round that would exceed it, exactly as a numeric `budget` does.
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import { MainLoopCapability } from '../../src/capability/agent-capabilities.js'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { AgentRunner, type BudgetOptions, DelegationBudgetExceededError } from '../../src/index.js'

describe('budget: { maxCostUsd } caps the run', () => {
  it('test_max_cost_usd_stops_the_run_before_the_round_that_would_exceed_it', async () => {
    let calls = 0
    const factory = (): AsyncIterable<StreamEvent> => {
      calls += 1
      const round = calls
      return (async function* () {
        yield { type: 'tool_result', toolName: `t${String(round)}`, input: {}, output: 'r' }
        yield { type: 'done', cost: 0.01 }
      })()
    }
    const compiled = applyCapabilities([
      new ModelCapability('test-model'),
      new MainLoopCapability({ maxIterations: 5 }),
    ])
    const runner = AgentRunner.fromSpec({
      compiled,
      name: 'budgetAgent',
      strategy: 'plan-act-reflect',
    }).build()
    const budget: BudgetOptions = { maxCostUsd: 0.015 }

    let threw: unknown
    try {
      await runner.run('go', { apiKey: 'k', budget, streamFactory: factory })
    } catch (err) {
      threw = err
    }

    expect(calls).toBe(1)
    expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
    const error = threw as InstanceType<typeof DelegationBudgetExceededError>
    expect(error.budgetLimit).toBe(0.015)
    expect(error.actualCost).toBeLessThanOrEqual(0.015)
  })
})
