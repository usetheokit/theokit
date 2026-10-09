/**
 * B-424, code review #73: `DoneEvent.cost` absent means the price is not known, and 0 means the
 * SDK priced the run at zero. The public `translateSdkEvent` built its FINISHED / CANCELLED `done`
 * with a hard-coded `cost: 0`, so a consumer of `@theokit/agents/bridge` was told every run was
 * free, and a reflective loop over such a stream folded an unpriced round as a known $0 round,
 * skipping the fail-closed `DelegationBudgetCostUnknownError`. It now follows the adapter's
 * `knownCost` rule: a finite `amountUsd` on the message's `result.cost` is the cost, and anything
 * else leaves the key out.
 */
import { describe, expect, it } from 'vitest'

import { translateSdkEvent } from '../../src/bridge/event-translator.js'

const RUN = 'run-1'

function doneOf(status: string, result?: unknown) {
  const events = translateSdkEvent(
    { type: 'status', agent_id: 'a', run_id: RUN, status, ...(result ? { result } : {}) },
    RUN,
  )
  expect(events).toHaveLength(1)
  return events[0] as Record<string, unknown>
}

describe('translateSdkEvent cost on a terminal status', () => {
  it('test_a_finished_run_the_sdk_priced_reports_that_cost', () => {
    expect(doneOf('FINISHED', { cost: { amountUsd: 0.02 } })).toMatchObject({
      type: 'done',
      cost: 0.02,
    })
  })

  it('test_a_run_priced_at_zero_reports_cost_zero', () => {
    expect(doneOf('CANCELLED', { cost: { amountUsd: 0 } })).toMatchObject({ cost: 0 })
  })

  it.each([
    ['no result', undefined],
    ['no cost', { result: 'text' }],
    ['an undefined amount', { cost: { amountUsd: undefined } }],
    ['a NaN amount', { cost: { amountUsd: Number.NaN } }],
    ['an infinite amount', { cost: { amountUsd: Number.POSITIVE_INFINITY } }],
    ['a string amount', { cost: { amountUsd: '0.02' } }],
  ])('test_a_finished_run_with_%s_has_no_cost_key', (_label, result) => {
    const done = doneOf('FINISHED', result)

    expect(done.type).toBe('done')
    expect('cost' in done).toBe(false)
  })
})
