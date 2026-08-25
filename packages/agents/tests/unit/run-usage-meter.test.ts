/**
 * theokit#475 — "not known yet" and "zero tokens" are different facts.
 *
 * The meter is the write half of the usage seam: the SDK agent loop calls its `track()` after each
 * LLM completion with the provider's own counts, and a tool handler reads what it has accumulated.
 * Everything that could make that reading a LIE is decided here, in a pure unit:
 *
 *  - a run with no provider report yet must answer `undefined`, never `0`. A model asking "how much
 *    room is left?" in the first round would otherwise be handed a number derived from nothing.
 *  - the context window must be absent unless one was DECLARED, and `remainingTokens` must be absent
 *    with it — "remaining" is a subtraction, and a subtraction against an invented window is an
 *    invented answer.
 *  - wrapping a caller's own `budgetTracker` must not disarm it: `check()` is a spend gate.
 */
import type { BudgetTracker } from '@theokit/sdk'
import { describe, expect, it, vi } from 'vitest'

import { createRunUsageMeter, readRunUsage } from '../../src/usage/run-usage.js'

describe('theokit#475 — the run usage meter', () => {
  it('test_reports_unknown_rather_than_zero_before_any_provider_report', () => {
    // Arrange
    const meter = createRunUsageMeter({ contextWindowTokens: 200_000 })

    // Act
    const snapshot = meter.snapshot()

    // Assert — the whole point of the seam. `{ totalTokens: 0 }` would be a measurement nobody made.
    expect(
      snapshot,
      'a run with no completed LLM call reported a token total, which is a number invented by this ' +
        'layer rather than one a provider stated',
    ).toBeUndefined()
  })

  it('test_a_provider_report_of_zero_output_tokens_is_still_a_report', () => {
    // Counterproof for the test above: the switch is "did a provider speak?", not "is the total
    // above zero?". A completion that produced no output tokens is a fact, and rounding it back
    // into silence would make the seam unable to say so.
    const meter = createRunUsageMeter()

    meter.tracker.track({ tokens: 42, model: 'test/model', type: 'input' })

    expect(meter.snapshot()).toEqual({ inputTokens: 42, outputTokens: 0, totalTokens: 42 })
  })

  it('test_accumulates_the_real_input_and_output_counts_across_completions', () => {
    const meter = createRunUsageMeter()

    meter.tracker.track({ tokens: 100, model: 'test/model', type: 'input' })
    meter.tracker.track({ tokens: 20, model: 'test/model', type: 'output' })
    meter.tracker.track({ tokens: 130, model: 'test/model', type: 'input' })
    meter.tracker.track({ tokens: 15, model: 'test/model', type: 'output' })

    expect(meter.snapshot()).toEqual({ inputTokens: 230, outputTokens: 35, totalTokens: 265 })
  })

  it('test_a_declared_context_window_yields_remaining_and_an_undeclared_one_yields_neither', () => {
    const declared = createRunUsageMeter({ contextWindowTokens: 1_000 })
    const undeclared = createRunUsageMeter()
    declared.tracker.track({ tokens: 300, model: 'm', type: 'input' })
    undeclared.tracker.track({ tokens: 300, model: 'm', type: 'input' })

    expect(declared.snapshot()).toEqual({
      inputTokens: 300,
      outputTokens: 0,
      totalTokens: 300,
      contextWindowTokens: 1_000,
      remainingTokens: 700,
    })
    // No window ⇒ no remaining. Filling it from the model catalog was considered and refused:
    // `resolveModelCapabilities` answers an unknown model with conservative defaults and says
    // nothing about which branch answered, so a miss is indistinguishable from a hit.
    const guess = undeclared.snapshot()
    expect(guess?.contextWindowTokens).toBeUndefined()
    expect(guess?.remainingTokens).toBeUndefined()
  })

  it('test_remaining_never_goes_negative', () => {
    const meter = createRunUsageMeter({ contextWindowTokens: 100 })
    meter.tracker.track({ tokens: 250, model: 'm', type: 'input' })

    // A provider reporting past the declared window has contradicted the declaration;
    // "-150 remaining" is not a fact about anything.
    expect(meter.snapshot()?.remainingTokens).toBe(0)
  })

  it('test_wrapping_a_callers_budget_tracker_leaves_its_gate_and_its_totals_in_charge', () => {
    // Arrange: `Agent.create` takes ONE tracker. If installing the meter silently replaced the
    // caller's, an observability feature would have disarmed a spend gate.
    const track = vi.fn()
    const delegate: BudgetTracker = {
      track,
      check: () => ({ allowed: false, reason: 'token_limit' }),
      getTotal: () => ({ tokens: 999, costUsd: 1.5 }),
      nextIteration: vi.fn(),
    }
    const meter = createRunUsageMeter({ delegate })

    // Act
    meter.tracker.track({ tokens: 10, model: 'm', type: 'input' })

    // Assert
    expect(
      track,
      'the caller stopped receiving the usage events its budget is computed from',
    ).toHaveBeenCalledWith({ tokens: 10, model: 'm', type: 'input' })
    expect(meter.tracker.check(), 'the caller-declared gate stopped answering').toEqual({
      allowed: false,
      reason: 'token_limit',
    })
    expect(meter.tracker.getTotal()).toEqual({ tokens: 999, costUsd: 1.5 })
    // And the meter still reports its OWN reading — the two are different questions.
    expect(meter.snapshot()?.totalTokens).toBe(10)
  })

  it('test_next_iteration_is_forwarded_only_when_the_delegate_declares_it', () => {
    // The SDK calls `budgetTracker?.nextIteration?.()`. Inventing the method for a delegate that
    // omits it would change which trackers halt on `maxIterations`, which is a behaviour change
    // dressed as plumbing.
    const withIt: BudgetTracker = {
      track: vi.fn(),
      check: () => ({ allowed: true }),
      getTotal: () => ({ tokens: 0 }),
      nextIteration: vi.fn(),
    }
    const withoutIt: BudgetTracker = {
      track: vi.fn(),
      check: () => ({ allowed: true }),
      getTotal: () => ({ tokens: 0 }),
    }

    expect(createRunUsageMeter({ delegate: withIt }).tracker.nextIteration).toBeTypeOf('function')
    expect(createRunUsageMeter({ delegate: withoutIt }).tracker.nextIteration).toBeUndefined()
    expect(createRunUsageMeter().tracker.nextIteration).toBeUndefined()

    createRunUsageMeter({ delegate: withIt }).tracker.nextIteration?.()
    expect(withIt.nextIteration).toHaveBeenCalledTimes(1)
  })

  it('test_a_tracker_with_no_delegate_allows_the_loop_to_proceed', () => {
    // Installing the meter must not gate a run that declared no budget: `check()` is consulted
    // before every iteration, and an `allowed: false` here would halt turns nobody capped.
    expect(createRunUsageMeter().tracker.check()).toEqual({ allowed: true })
  })
})

describe('theokit#475 — readRunUsage', () => {
  it('test_reads_the_snapshot_the_adapter_injected', () => {
    const snapshot = { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
    expect(readRunUsage({ signal: undefined, usage: snapshot })).toBe(snapshot)
  })

  it('test_returns_undefined_for_every_honest_form_of_not_known', () => {
    // A ctx from a run that did not opt in, a ctx that is not a tool ctx, and the "not yet"
    // snapshot all mean the same thing to a tool asking how much room is left.
    expect(readRunUsage({ signal: undefined })).toBeUndefined()
    expect(readRunUsage({ usage: undefined })).toBeUndefined()
    expect(readRunUsage(undefined)).toBeUndefined()
    expect(readRunUsage('not a ctx')).toBeUndefined()
  })

  it('test_refuses_a_usage_field_this_layer_did_not_produce', () => {
    // Anti-vacuity: the reader validates the shape rather than trusting the key. A consumer that
    // parks something else on `ctx.usage` gets `undefined`, not a value typed as a measurement.
    expect(readRunUsage({ usage: { totalTokens: 'lots' } })).toBeUndefined()
    expect(readRunUsage({ usage: {} })).toBeUndefined()
  })
})
