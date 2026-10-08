/**
 * B-409 / B-419 — a run with a round the SDK could not price says its cost is not known.
 *
 * The loop folds an unpriced round into the spend as 0, which is right for the ceiling (the known
 * spend) and wrong for the result: `DelegationResult.cost` then reports a run with an unpriced round
 * as free, or as the priced rounds only, which is the misreading `DoneEvent.cost` forbids. The result
 * carries `costUnknown: true` for such a run, and a fully priced run's result is unchanged.
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
  return AgentRunner.fromSpec({ compiled, name: 'costAgent', strategy: 'plan-act-reflect' }).build()
}

/** Two rounds that ask to continue, the first ending with `first`, the second with `second`. */
async function runTwoRounds(first: StreamEvent, second: StreamEvent) {
  const dones = [first, second]
  let calls = 0
  const streamFactory = (): AsyncIterable<StreamEvent> => {
    const done = dones[calls] ?? second
    calls += 1
    return (async function* () {
      yield { type: 'tool_result', toolName: `t${String(calls)}`, input: {}, output: 'r' }
      yield done
    })()
  }
  return buildRunner().run('go', { apiKey: 'k', maxIterations: 2, streamFactory })
}

describe('the cost a run reports when a round was not priced', () => {
  it('test_a_run_whose_rounds_were_never_priced_says_its_cost_is_unknown', async () => {
    const result = await runTwoRounds({ type: 'done' }, { type: 'done' })

    expect(result.costUnknown).toBe(true)
  })

  it('test_a_run_with_one_unpriced_round_keeps_the_known_spend_and_says_it_is_partial', async () => {
    const result = await runTwoRounds({ type: 'done', cost: 0.01 }, { type: 'done' })

    expect(result.cost).toBeCloseTo(0.01, 10)
    expect(result.costUnknown).toBe(true)
  })

  it('test_a_non_finite_round_cost_counts_as_unknown', async () => {
    const result = await runTwoRounds(
      { type: 'done', cost: 0.01 },
      { type: 'done', cost: Number.NaN },
    )

    expect(result.costUnknown).toBe(true)
  })

  it('test_a_fully_priced_run_carries_no_cost_unknown_key', async () => {
    const result = await runTwoRounds({ type: 'done', cost: 0.01 }, { type: 'done', cost: 0 })

    expect(result.cost).toBeCloseTo(0.01, 10)
    expect('costUnknown' in result).toBe(false)
  })
})
