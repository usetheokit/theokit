/**
 * T1.1 — LoopStrategy / LoopOutcome / resolveLoopStrategy contract (Phase 1).
 *
 * RED-first tests for the terminal-decision contract that gives runtime to
 * `@MainLoop({ strategy })` (V4-A: the strategy field was metadata-only).
 * Pure + table-driven; no SDK / LLM. Models Mastra's `stopWhen` (inverted) +
 * `maxSteps` ceiling per plan ADR D1. Zod config (ADR D3).
 */
import { describe, expect, it } from 'vitest'
import { type LoopOutcome, resolveLoopStrategy } from '../../src/loop/loop-strategy.js'

/** Minimal LoopOutcome factory for table tests. */
function outcome(partial: Partial<LoopOutcome>): LoopOutcome {
  return {
    finishReason: 'tool-calls',
    round: 1,
    toolCalls: [],
    responseText: '',
    ...partial,
  }
}

describe('resolveLoopStrategy', () => {
  it('test_resolve_simple_chat_never_continues — simple-chat is always one round', () => {
    const s = resolveLoopStrategy('simple-chat', 8)
    expect(s.shouldContinue(outcome({ finishReason: 'tool-calls', round: 1 }))).toBe(false)
  })

  it('test_mainloop_plan_act_reflect_continues_on_toolcalls_under_ceiling', () => {
    const s = resolveLoopStrategy('plan-act-reflect', 3)
    expect(s.shouldContinue(outcome({ finishReason: 'tool-calls', round: 1 }))).toBe(true)
  })

  it('test_resolve_terminates_at_maxiterations_ceiling', () => {
    const s = resolveLoopStrategy('react', 3)
    // round has reached the ceiling → must terminate (no unbounded loop)
    expect(s.shouldContinue(outcome({ finishReason: 'tool-calls', round: 3 }))).toBe(false)
  })

  it('test_resolve_terminates_on_stop_and_error', () => {
    const s = resolveLoopStrategy('plan-act-reflect', 8)
    expect(s.shouldContinue(outcome({ finishReason: 'stop', round: 1 }))).toBe(false)
    expect(s.shouldContinue(outcome({ finishReason: 'error', round: 1 }))).toBe(false)
    expect(s.shouldContinue(outcome({ finishReason: 'length', round: 1 }))).toBe(false)
  })

  it('test_resolve_rejects_zero_maxiterations — Zod min(1) fail-fast', () => {
    expect(() => resolveLoopStrategy('react', 0)).toThrow()
    expect(() => resolveLoopStrategy('react', -1)).toThrow()
  })

  it('test_resolve_maxiterations_boundaries — EC-3: omitted→finite default, 1→one round', () => {
    // maxIterations omitted ⇒ a FINITE default (not Infinity): a multi-round strategy must still terminate
    const def = resolveLoopStrategy('react')
    expect(Number.isFinite(def.maxIterations)).toBe(true)
    expect(def.maxIterations).toBeGreaterThanOrEqual(1)
    // maxIterations = 1 ⇒ exactly one round (degenerates to single-shot)
    const one = resolveLoopStrategy('react', 1)
    expect(one.shouldContinue(outcome({ finishReason: 'tool-calls', round: 1 }))).toBe(false)
  })
})
