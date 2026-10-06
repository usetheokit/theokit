/**
 * B-409 — guards around the pre-round budget refusal: cancellation wins over it, a projection equal
 * to the ceiling is still affordable, and a run that would stop anyway is never refused.
 *
 * All three hold today, before the refusal exists. They are here so the refusal cannot be placed
 * where it ignores the abort signal, compares with `>=`, or runs before the termination checks.
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import { MainLoopCapability } from '../../src/capability/agent-capabilities.js'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { AgentRunner } from '../../src/index.js'

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

/** Rounds of `cost` that ask to continue; `afterDone` runs once the round's done was handed out. */
function rounds(cost: number, afterDone: () => void = () => undefined) {
  let calls = 0
  const factory = (): AsyncIterable<StreamEvent> => {
    calls += 1
    const round = calls
    return (async function* () {
      yield { type: 'tool_result', toolName: `t${String(round)}`, input: {}, output: 'r' }
      yield { type: 'done', cost }
      afterDone()
    })()
  }
  return { factory, calls: () => calls }
}

describe('the pre-round budget refusal', () => {
  it('test_a_cancelled_run_returns_instead_of_raising_a_budget_refusal', async () => {
    const ctrl = new AbortController()
    const { factory, calls } = rounds(0.01, () => {
      ctrl.abort()
    })

    const result = await buildRunner().run('go', {
      apiKey: 'k',
      budget: 0.015,
      signal: ctrl.signal,
      streamFactory: factory,
    })

    expect(calls()).toBe(1)
    expect(result.cost).toBe(0.01)
  })

  it('test_a_projection_equal_to_the_ceiling_still_runs_the_next_round', async () => {
    const { factory, calls } = rounds(0.01)

    const result = await buildRunner().run('go', {
      apiKey: 'k',
      budget: 0.02,
      maxIterations: 2,
      streamFactory: factory,
    })

    expect(calls()).toBe(2)
    expect(result.cost).toBe(0.02)
  })

  it('test_the_last_allowed_round_is_not_refused', async () => {
    const { factory, calls } = rounds(0.01)

    const result = await buildRunner().run('go', {
      apiKey: 'k',
      budget: 0.015,
      maxIterations: 1,
      streamFactory: factory,
    })

    expect(calls()).toBe(1)
    expect(result.cost).toBe(0.01)
  })
})
