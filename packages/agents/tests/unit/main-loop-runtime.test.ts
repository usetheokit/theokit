/**
 * T1.1 — LoopStrategy / LoopOutcome / resolveLoopStrategy contract (Phase 1).
 *
 * RED-first tests for the terminal-decision contract that gives runtime to
 * `@MainLoop({ strategy })` (V4-A: the strategy field was metadata-only).
 * Pure + table-driven; no SDK / LLM. Models Mastra's `stopWhen` (inverted) +
 * `maxSteps` ceiling per plan ADR D1. Zod config (ADR D3).
 */
import { describe, expect, it } from 'vitest'
import { BudgetExceededError, DelegationError } from '../../src/bridge/agent-orchestrator.js'
import * as loopBarrel from '../../src/loop/index.js'
import { type LoopOutcome, resolveLoopStrategy } from '../../src/loop/loop-strategy.js'
import {
  ladderReflectionStrategy,
  reflectionStrategyConfigSchema,
} from '../../src/loop/reflection-strategy.js'
import { runReflectiveLoop } from '../../src/loop/run-reflective-loop.js'

interface StreamEvent {
  type: string
  [key: string]: unknown
}

/**
 * Scripted mock stream factory: `rounds[i]` is the event list yielded on the
 * (i+1)-th call. Captures the prompt passed each round. The last round repeats
 * if more calls happen than scripted rounds (for ceiling tests).
 */
function mockFactory(rounds: StreamEvent[][]) {
  const prompts: string[] = []
  let call = 0
  const factory = (message: string, _sessionId: string): AsyncIterable<StreamEvent> => {
    prompts.push(message)
    const events = rounds[Math.min(call, rounds.length - 1)] ?? []
    call += 1
    return (async function* () {
      for (const e of events) yield e
    })()
  }
  return { factory, prompts }
}

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

describe('ladderReflectionStrategy', () => {
  it('test_ladder_reflects_continue_on_toolcalls — feedback + continue on tool-calls', () => {
    const r = ladderReflectionStrategy.reflect(outcome({ finishReason: 'tool-calls', round: 1 }))
    expect(r.continue).toBe(true)
    expect(r.feedback).toBeTruthy()
    expect(typeof r.feedback).toBe('string')
    expect((r.feedback ?? '').length).toBeGreaterThan(0)
  })

  it('test_ladder_stops_on_stop — terminate, no continue', () => {
    const r = ladderReflectionStrategy.reflect(outcome({ finishReason: 'stop', round: 2 }))
    expect(r.continue).toBe(false)
  })

  it('test_ladder_stops_on_error — terminate on error', () => {
    const r = ladderReflectionStrategy.reflect(outcome({ finishReason: 'error', round: 1 }))
    expect(r.continue).toBe(false)
  })

  it('test_reflection_config_rejects_empty_name — Zod min(1)', () => {
    expect(() => reflectionStrategyConfigSchema.parse({ name: '' })).toThrow()
  })
})

describe('loop barrel (T1.3)', () => {
  it('test_loop_barrel_exports_contracts — public surface re-exported from loop/index', () => {
    // The barrel re-exports the SAME references (proves the barrel chain, INVARIANT #3)
    expect(loopBarrel.resolveLoopStrategy).toBe(resolveLoopStrategy)
    expect(loopBarrel.ladderReflectionStrategy).toBe(ladderReflectionStrategy)
    expect(typeof loopBarrel.resolveLoopStrategy).toBe('function')
  })
})

describe('runReflectiveLoop (T2.1)', () => {
  const toolResult: StreamEvent = { type: 'tool_result', toolName: 'read', input: {}, output: 'ok' }
  const doneStop: StreamEvent = { type: 'done', cost: 0.01, usage: { totalTokens: 10 } }

  it('test_mainloop_plan_act_reflect_runs_until_stop — 2 rounds (tool_result then done)', async () => {
    const { factory, prompts } = mockFactory([[toolResult], [doneStop]])
    const loop = resolveLoopStrategy('plan-act-reflect', 3)
    const result = await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(prompts).toHaveLength(2)
    expect(result.toolCalls).toHaveLength(1)
  })

  it('test_mainloop_simple_chat_runs_one_round — single-shot even on tool_result (EC-2)', async () => {
    const { factory, prompts } = mockFactory([[toolResult]])
    const loop = resolveLoopStrategy('simple-chat', 8)
    await runReflectiveLoop(factory, 'msg', 's', { loop, reflection: ladderReflectionStrategy })
    expect(prompts).toHaveLength(1)
  })

  it('test_mainloop_honors_maxiterations_ceiling — stops at maxIterations, no hang/throw', async () => {
    const { factory, prompts } = mockFactory([[toolResult]]) // every round = tool_result, never done
    const loop = resolveLoopStrategy('react', 2)
    const result = await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(prompts).toHaveLength(2) // forced terminal at the ceiling
    expect(result).toBeDefined()
  })

  it('test_mainloop_surfaces_typed_error_midround — DelegationError, not hang/generic', async () => {
    const { factory } = mockFactory([[{ type: 'error', message: 'boom' }]])
    const loop = resolveLoopStrategy('react', 3)
    await expect(
      runReflectiveLoop(factory, 'msg', 's', { loop, reflection: ladderReflectionStrategy }),
    ).rejects.toBeInstanceOf(DelegationError)
  })

  it('test_mainloop_injects_reflection_feedback_next_round — round2 prompt carries feedback', async () => {
    const { factory, prompts } = mockFactory([[toolResult], [doneStop]])
    const loop = resolveLoopStrategy('plan-act-reflect', 3)
    await runReflectiveLoop(factory, 'original-task', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(prompts[1]).toContain('reflection')
    expect(prompts[1]).toContain('original-task')
  })

  it('test_mainloop_empty_round_terminates_as_stop — EC-1: degenerate round ⇒ stop, 1 round', async () => {
    const { factory, prompts } = mockFactory([[]]) // ZERO events
    const loop = resolveLoopStrategy('react', 3)
    await runReflectiveLoop(factory, 'msg', 's', { loop, reflection: ladderReflectionStrategy })
    expect(prompts).toHaveLength(1) // did NOT default to tool-calls + spin
  })

  it('test_loop_budget_enforced_across_rounds — EC-4: cumulative cost crosses budget mid-loop', async () => {
    // each round continues (done.finishReason: tool-calls) and costs 0.5; budget 1.2 ⇒ throws on round 3
    const costlyContinue: StreamEvent = { type: 'done', cost: 0.5, finishReason: 'tool-calls' }
    const { factory } = mockFactory([[costlyContinue]])
    const loop = resolveLoopStrategy('react', 8)
    await expect(
      runReflectiveLoop(factory, 'msg', 's', {
        loop,
        reflection: ladderReflectionStrategy,
        budget: 1.2,
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError)
  })

  // Concurrency tests (structural invariants — plan § Concurrency tests)
  it('test_loop_maxiterations_ceiling_invariant — never unbounded', async () => {
    const { factory, prompts } = mockFactory([[toolResult]]) // never emits done
    const loop = resolveLoopStrategy('react', 4)
    await runReflectiveLoop(factory, 'msg', 's', { loop, reflection: ladderReflectionStrategy })
    expect(prompts).toHaveLength(4) // exactly maxIterations
  })

  it('test_loop_propagates_abort_signal — aborts stop re-entry (cancellation propagation)', async () => {
    const ctrl = new AbortController()
    let call = 0
    const factory = (_message: string, _s: string): AsyncIterable<StreamEvent> => {
      call += 1
      if (call === 1) ctrl.abort() // abort after round 1 is dispatched
      return (async function* () {
        yield toolResult
      })()
    }
    const loop = resolveLoopStrategy('react', 8)
    await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
      signal: ctrl.signal,
    })
    expect(call).toBe(1) // did not re-enter after abort
  })
})
