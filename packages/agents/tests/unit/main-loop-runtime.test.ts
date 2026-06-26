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
  noopReflectionStrategy,
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
    // react gates on tool-calls (the reflection is noop), so it terminates on stop/error/length.
    const s = resolveLoopStrategy('react', 8)
    expect(s.shouldContinue(outcome({ finishReason: 'stop', round: 1 }))).toBe(false)
    expect(s.shouldContinue(outcome({ finishReason: 'error', round: 1 }))).toBe(false)
    expect(s.shouldContinue(outcome({ finishReason: 'length', round: 1 }))).toBe(false)
  })

  it('test_plan_act_reflect_defers_to_reflection (V4-S)', () => {
    // V4-S: plan-act-reflect's shouldContinue is `round < max` — it defers the stop/continue decision
    // to the ReflectionStrategy (the loop ANDs reflect.continue with this), so it returns true even on
    // a `stop` round within the ceiling, and false only at/after the ceiling.
    const s = resolveLoopStrategy('plan-act-reflect', 8)
    expect(s.shouldContinue(outcome({ finishReason: 'stop', round: 1 }))).toBe(true)
    expect(s.shouldContinue(outcome({ finishReason: 'error', round: 1 }))).toBe(true)
    expect(s.shouldContinue(outcome({ finishReason: 'tool-calls', round: 8 }))).toBe(false) // ceiling
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

describe('noopReflectionStrategy (L4 — react path)', () => {
  it('test_noop_returns_continue_true_no_feedback — defers the decision to LoopStrategy.shouldContinue', () => {
    // react uses noop so the round-continuation decision is delegated entirely to the
    // LoopStrategy (loop while finishReason==='tool-calls' under the ceiling). It must
    // NOT short-circuit react to single-shot by returning continue:false.
    const onToolCalls = noopReflectionStrategy.reflect(outcome({ finishReason: 'tool-calls' }))
    expect(onToolCalls.continue).toBe(true)
    expect(onToolCalls.feedback).toBeUndefined()
    const onStop = noopReflectionStrategy.reflect(outcome({ finishReason: 'stop' }))
    expect(onStop.continue).toBe(true) // noop is indifferent; the LoopStrategy stops on 'stop'
    expect(onStop.feedback).toBeUndefined()
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

  it('test_mainloop_real_sdk_shape_loops — B1: tool_result+done(no finishReason) continues, pure-answer stops', async () => {
    // REAL adapter shape (event-translator + sdk-adapter): a tool-using turn emits
    // tool_result events AND a terminal `done` WITHOUT finishReason; a pure-answer turn
    // emits `done` with no tool_result. round1 = tool-using (continue), round2 = answer (stop).
    const realDone: StreamEvent = { type: 'done', cost: 0.01 }
    const { factory, prompts } = mockFactory([[toolResult, realDone], [realDone]])
    const loop = resolveLoopStrategy('plan-act-reflect', 3)
    await runReflectiveLoop(factory, 'msg', 's', { loop, reflection: ladderReflectionStrategy })
    expect(prompts).toHaveLength(2) // pre-B1-fix this was 1 (done short-circuited to 'stop')
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
    // V4-M: round 2 no longer re-sends the original task — the persisted SDK session carries
    // it (rounds share state via getOrCreate); the round-2 prompt is the reflection block only.
    expect(prompts[1]).not.toContain('original-task')
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
    // Distinct tool input per round (progress) so the CEILING — not no_progress — is what
    // stops it (an identical stream would now trip no_progress at round 3, EC-4).
    const prompts: string[] = []
    let n = 0
    const factory = (message: string, _s: string): AsyncIterable<StreamEvent> => {
      prompts.push(message)
      n += 1
      const ev: StreamEvent = { type: 'tool_result', toolName: 'read', input: { n }, output: 'ok' }
      return (async function* () {
        yield ev
      })()
    }
    const loop = resolveLoopStrategy('react', 4)
    const result = await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(prompts).toHaveLength(4) // exactly maxIterations
    expect(result.finishReason).toBe('step_limit') // ceiling-bound stop is observable (V4-D)
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
    const result = await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
      signal: ctrl.signal,
    })
    expect(call).toBe(1) // did not re-enter after abort
    expect(result.rounds).toBe(1) // L1: abort-exit still records the round that ran (metric not lost)
  })

  it('test_loop_accumulates_text_delta — EC: text_delta content concatenated into response', async () => {
    const { factory } = mockFactory([
      [
        { type: 'text_delta', content: 'Hello, ' },
        { type: 'text_delta', content: 'world' },
        doneStop,
      ],
    ])
    const loop = resolveLoopStrategy('react', 3)
    const result = await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(result.response).toBe('Hello, world')
  })

  it('test_loop_budget_boundary_equal_does_not_throw — cost == budget passes (check is strictly >)', async () => {
    // round costs exactly 0.5 then stops; budget 0.5 ⇒ acc.cost (0.5) is NOT > budget (0.5) ⇒ OK
    const costlyStop: StreamEvent = { type: 'done', cost: 0.5 }
    const { factory } = mockFactory([[costlyStop]])
    const loop = resolveLoopStrategy('react', 3)
    const result = await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
      budget: 0.5,
    })
    expect(result.cost).toBe(0.5)
  })

  it('test_loop_budget_zero_throws_on_any_cost — budget 0 + positive cost ⇒ BudgetExceededError', async () => {
    const { factory } = mockFactory([[{ type: 'done', cost: 0.01, finishReason: 'tool-calls' }]])
    const loop = resolveLoopStrategy('react', 8)
    await expect(
      runReflectiveLoop(factory, 'msg', 's', {
        loop,
        reflection: ladderReflectionStrategy,
        budget: 0,
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError)
  })

  it('test_loop_aborts_mid_stream — signal during event iteration stops accumulating (vs between-rounds)', async () => {
    const ctrl = new AbortController()
    const factory = (_message: string, _s: string): AsyncIterable<StreamEvent> =>
      (async function* () {
        yield { type: 'text_delta', content: 'a' }
        ctrl.abort() // abort mid-stream, before the next event is consumed
        yield { type: 'text_delta', content: 'b' }
      })()
    const loop = resolveLoopStrategy('react', 8)
    const result = await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
      signal: ctrl.signal,
    })
    expect(result.response).toBe('a') // 'b' arrived after abort ⇒ loop broke before accumulating it
  })

  // ── V4-D terminals: step_limit + no_progress ──────────────────────────────

  it('test_loop_step_limit_finish_reason — ceiling-bound stop ⇒ finishReason step_limit (T1.2)', async () => {
    const { factory, prompts } = mockFactory([[toolResult]]) // never stops; maxIterations=2 → ceiling
    const loop = resolveLoopStrategy('react', 2)
    const result = await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(result.finishReason).toBe('step_limit')
    expect(prompts).toHaveLength(2)
  })

  it('test_loop_natural_stop_is_not_step_limit — round-1 pure done ⇒ finishReason stop (T1.2)', async () => {
    const { factory } = mockFactory([[doneStop]])
    const loop = resolveLoopStrategy('react', 8)
    const result = await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(result.finishReason).toBe('stop')
  })

  it('test_loop_final_round_prompt_carries_summary_hint — graceful degradation on the final round (T1.2)', async () => {
    const { factory, prompts } = mockFactory([[toolResult]])
    const loop = resolveLoopStrategy('react', 2)
    await runReflectiveLoop(factory, 'task', 's', { loop, reflection: ladderReflectionStrategy })
    // round 2 is the final allowed round (round === maxIterations) → carries the summary hint
    expect(prompts[1].toLowerCase()).toMatch(/final round|summariz/)
    expect(prompts[0].toLowerCase()).not.toMatch(/final round/)
  })

  it('test_loop_terminates_on_no_progress — identical tool-calls rounds ⇒ no_progress at round 3, K=2 (T2.1)', async () => {
    const { factory } = mockFactory([[toolResult]]) // SAME signature every round, finishReason tool-calls
    const loop = resolveLoopStrategy('react', 8) // ceiling high so no_progress (round 3) wins
    const result = await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(result.finishReason).toBe('no_progress')
    expect(result.rounds).toBe(3) // round1 (stuck0) → round2 (stuck1) → round3 (stuck2 ⇒ terminate)
  })

  it('test_loop_empty_round_terminates_as_stop_not_no_progress — empty is stop, not no_progress (T2.1/EC-1)', async () => {
    const { factory, prompts } = mockFactory([[]]) // empty round
    const loop = resolveLoopStrategy('react', 8)
    const result = await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(result.finishReason).toBe('stop')
    expect(prompts).toHaveLength(1)
  })

  it('test_loop_different_tool_input_is_progress — distinct inputs reset the stuck counter (T2.1)', async () => {
    const readA: StreamEvent = {
      type: 'tool_result',
      toolName: 'read',
      input: { p: 'a' },
      output: 'ok',
    }
    const readB: StreamEvent = {
      type: 'tool_result',
      toolName: 'read',
      input: { p: 'b' },
      output: 'ok',
    }
    const { factory } = mockFactory([[readA], [readB], [doneStop]])
    const loop = resolveLoopStrategy('react', 8)
    const result = await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(result.finishReason).toBe('stop') // ran to natural stop — different inputs = progress
    expect(result.rounds).toBe(3)
  })

  it('test_loop_no_progress_counter_resets_then_reaccumulates — A,A,B,A,A ⇒ no_progress at round 5 (T2.1)', async () => {
    // A progress step (B) in the middle MUST reset the stuck counter to 0, so no_progress
    // only fires after 2 fresh consecutive repeats — guards against a "reset to 1" mutation.
    const a: StreamEvent = {
      type: 'tool_result',
      toolName: 'read',
      input: { p: 'a' },
      output: 'ok',
    }
    const b: StreamEvent = {
      type: 'tool_result',
      toolName: 'read',
      input: { p: 'b' },
      output: 'ok',
    }
    // mockFactory repeats the last round ([a]) past the script, so R6 = a too.
    const { factory } = mockFactory([[a], [a], [b], [a], [a]])
    const loop = resolveLoopStrategy('react', 8)
    const result = await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(result.finishReason).toBe('no_progress')
    // R1 a(stuck0) R2 a(1) R3 b(RESET→0) R4 a(0) R5 a(1) R6 a(2⇒terminate). A buggy "reset→1"
    // would instead fire at round 5 — so this exact count pins the reset-to-ZERO semantics.
    expect(result.rounds).toBe(6)
  })

  it('test_loop_signature_key_order_independent — same input, different key order = no progress (T2.1 robustness)', async () => {
    // stableStringify canonicalizes input keys: {a,b} and {b,a} are the same call → no progress.
    const k1: StreamEvent = {
      type: 'tool_result',
      toolName: 'x',
      input: { a: 1, b: 2 },
      output: 'r',
    }
    const k2: StreamEvent = {
      type: 'tool_result',
      toolName: 'x',
      input: { b: 2, a: 1 },
      output: 'r',
    }
    const { factory } = mockFactory([[k1], [k2], [k1]])
    const loop = resolveLoopStrategy('react', 8)
    const result = await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(result.finishReason).toBe('no_progress')
    expect(result.rounds).toBe(3)
  })

  it('test_loop_signature_is_tool_order_independent — re-ordered same calls = no progress (T2.1/EC-3)', async () => {
    const readA: StreamEvent = {
      type: 'tool_result',
      toolName: 'read',
      input: { p: 'a' },
      output: 'ok',
    }
    const writeB: StreamEvent = {
      type: 'tool_result',
      toolName: 'write',
      input: { p: 'b' },
      output: 'ok',
    }
    const { factory } = mockFactory([
      [readA, writeB],
      [writeB, readA], // same calls, different order → equal signature
      [readA, writeB],
    ])
    const loop = resolveLoopStrategy('react', 8)
    const result = await runReflectiveLoop(factory, 'msg', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(result.finishReason).toBe('no_progress')
    expect(result.rounds).toBe(3)
  })
})
