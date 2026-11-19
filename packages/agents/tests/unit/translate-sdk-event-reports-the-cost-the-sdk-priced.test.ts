/**
 * B-424, code review #73: `DoneEvent.cost` absent means the price is not known, and 0 means the
 * SDK priced the run at zero. The public `translateSdkEvent` built its FINISHED / CANCELLED `done`
 * with a hard-coded `cost: 0`, so a consumer of `@theokit/agents/bridge` was told every run was
 * free, and a reflective loop over such a stream folded an unpriced round as a known $0 round,
 * skipping the fail-closed `DelegationBudgetCostUnknownError`. It now follows the adapter's
 * `knownCost` rule: a finite `amountUsd` on the message's `result.cost` is the cost, and anything
 * else leaves the key out.
 *
 * The priced cases build a status message whose `result` carries a `cost`. The SDK's status message
 * carries no cost today, so those cases guard a shape the SDK may send rather than one it does; the
 * case that matches today's SDK is `no_result`, which must leave the key out.
 */
import { describe, expect, it } from 'vitest'

import { translateSdkEvent } from '../../src/bridge/event-translator.js'

const RUN = 'run-1'

function doneOf(status: string, result?: unknown) {
  const events = translateSdkEvent(
    { type: 'status', agent_id: 'a', run_id: RUN, status, ...(result ? { result } : {}) },
    RUN,
  )
  if (events.length !== 1) throw new Error(`expected one event for ${status}, got ${events.length}`)
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
    ['no_result', undefined],
    ['no_cost', { result: 'text' }],
    ['an_undefined_amount', { cost: { amountUsd: undefined } }],
    ['a_nan_amount', { cost: { amountUsd: Number.NaN } }],
    ['an_infinite_amount', { cost: { amountUsd: Number.POSITIVE_INFINITY } }],
    ['a_string_amount', { cost: { amountUsd: '0.02' } }],
  ])('test_a_finished_run_with_%s_has_no_cost_key', (_label, result) => {
    const done = doneOf('FINISHED', result)

    expect(done.type).toBe('done')
    expect('cost' in done).toBe(false)
  })
})
