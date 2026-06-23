/**
 * T4.1 — End-to-end reflective-loop wiring (Phase 4, Integration Validation).
 *
 * Proves the Goal metric: ZERO `@MainLoop` strategies remain metadata-only. A
 * real decorated `@Agent`/`@MainLoop({strategy:'plan-act-reflect'})` runs a
 * multi-round reflective loop through BOTH public on-ramps — `delegate()` and
 * `AgentRunner.builder().build().run()` (imported from the ROOT barrel, proving
 * the public surface) — against a stateful mock SDK stream (no LLM, per
 * sdk-runtime.md). Covers the runtime metric, feedback injection, the
 * simple-chat regression, the maxIterations ceiling, and cancellation — both
 * on-ramps observing identical behavior (ADR D4 parity at runtime).
 */
import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface StreamEvent {
  type: string
  [key: string]: unknown
}

const h = vi.hoisted(() => ({
  rounds: [] as StreamEvent[][],
  prompts: [] as string[],
  calls: 0,
  abortCtrl: undefined as AbortController | undefined,
}))

vi.mock('../../src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream:
    () =>
    (message: string, _sessionId: string): AsyncIterable<StreamEvent> => {
      h.prompts.push(message)
      const events = h.rounds[Math.min(h.calls, h.rounds.length - 1)] ?? []
      h.calls += 1
      const abortAfter = h.abortCtrl
      return (async function* () {
        for (const e of events) yield e
        // Cancellation scenario: abort AFTER round 1 completes (before re-entry).
        if (abortAfter) abortAfter.abort()
      })()
    },
}))

// Import from the ROOT barrel — proves the public surface + INVARIANT #3.
const { delegate, AgentRunner } = await import('../../src/index.js')
const { Agent } = await import('../../src/decorators/agent.js')
const { MainLoop } = await import('../../src/decorators/main-loop.js')

@Agent({ model: 'test-model' })
class PlanActReflectAgent {
  @MainLoop({ strategy: 'plan-act-reflect', maxIterations: 3 })
  async run() {}
}

@Agent({ model: 'test-model' })
class SimpleChatAgent {
  @MainLoop({ strategy: 'simple-chat' })
  async run() {}
}

@Agent({ model: 'test-model' })
class CeilingAgent {
  @MainLoop({ strategy: 'react', maxIterations: 4 })
  async run() {}
}

const toolResult: StreamEvent = { type: 'tool_result', toolName: 'x', input: {}, output: 'r' }
const done: StreamEvent = { type: 'done', cost: 0.01 }

function script(rounds: StreamEvent[][]): void {
  h.rounds = rounds
  h.prompts = []
  h.calls = 0
  h.abortCtrl = undefined
}

afterEach(() => vi.restoreAllMocks())

describe('reflective loop wiring — end-to-end (T4.1)', () => {
  it('test_plan_act_reflect_loops_twice_via_delegate — 2 rounds', async () => {
    script([[toolResult], [done]])
    await delegate(PlanActReflectAgent, 'task', { apiKey: 'test' })
    expect(h.calls).toBe(2)
    expect(h.prompts[1]).toContain('reflection')
  })

  it('test_plan_act_reflect_real_adapter_shape_loops_twice — H1/B1: round emits tool_result AND a terminal done WITHOUT finishReason (the shape createSdkAgentStream actually produces); a tool-using turn must still continue', async () => {
    // The REAL adapter (sdk-adapter.ts + event-translator.ts) ALWAYS appends a terminal
    // `done` (no finishReason) after a turn — even one that used tools. The H1 finding was
    // that every prior test scripted continuing rounds as [toolResult] with NO done, a shape
    // the adapter never emits, masking B1. This test uses the production shape:
    //   round1 = [tool_result, done(no finishReason)]  → tool-using turn ⇒ continue
    //   round2 = [done(no finishReason)]               → pure answer       ⇒ stop
    script([[toolResult, done], [done]])
    await delegate(PlanActReflectAgent, 'task', { apiKey: 'test' })
    expect(h.calls).toBe(2) // pre-B1-fix this collapsed to 1 (the bare done short-circuited to stop)
    expect(h.prompts[1]).toContain('reflection')

    // D4 parity: the AgentRunner on-ramp loops identically on the same production shape.
    script([[toolResult, done], [done]])
    await AgentRunner.builder(PlanActReflectAgent).build().run('task', { apiKey: 'test' })
    expect(h.calls).toBe(2)
  })

  it('test_plan_act_reflect_loops_twice_via_agentrunner — 2 rounds (D4 parity)', async () => {
    script([[toolResult], [done]])
    await AgentRunner.builder(PlanActReflectAgent).build().run('task', { apiKey: 'test' })
    expect(h.calls).toBe(2)
    expect(h.prompts[1]).toContain('reflection')
  })

  it('test_reflective_loop_emits_runtime_metric_rounds_2 — observable proof', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    script([[toolResult], [done]])
    await delegate(PlanActReflectAgent, 'task', { apiKey: 'test' })
    expect(spy).toHaveBeenCalledWith(
      '[THEO_AGENT_MAINLOOP_RUNTIME_APPLIED]',
      expect.objectContaining({ strategy: 'plan-act-reflect', rounds: 2 }),
    )
  })

  it('test_simple_chat_single_round_regression — 1 round through both on-ramps', async () => {
    script([[toolResult]])
    await delegate(SimpleChatAgent, 'task', { apiKey: 'test' })
    expect(h.calls).toBe(1)

    script([[toolResult]])
    await AgentRunner.builder(SimpleChatAgent).build().run('task', { apiKey: 'test' })
    expect(h.calls).toBe(1)
  })

  it('test_reflective_loop_no_unbounded_rounds_integration — ceiling at 4 (no hang)', async () => {
    script([[toolResult]]) // never emits done → would loop forever without the ceiling
    await delegate(CeilingAgent, 'task', { apiKey: 'test' })
    expect(h.calls).toBe(4)

    script([[toolResult]])
    await AgentRunner.builder(CeilingAgent).build().run('task', { apiKey: 'test' })
    expect(h.calls).toBe(4)
  })

  it('test_delegate_missing_apikey_throws_typed_error — L4: no apiKey ⇒ DelegationError, before any round', async () => {
    const { DelegationError } = await import('../../src/index.js')
    script([[toolResult], [done]])
    await expect(delegate(PlanActReflectAgent, 'task', {})).rejects.toBeInstanceOf(DelegationError)
    expect(h.calls).toBe(0) // failed fast at the boundary — never opened a stream
  })

  it('test_delegate_clamps_parent_budget — D4/L4: parentBudgetRemaining < budget ⇒ min wins, throws when crossed', async () => {
    const { BudgetExceededError } = await import('../../src/index.js')
    // each round costs 0.5 and continues; budget 10 but parentBudgetRemaining 0.4 ⇒ clamp to 0.4 ⇒ throws round 1
    const costlyContinue: StreamEvent = { type: 'done', cost: 0.5, finishReason: 'tool-calls' }
    script([[costlyContinue]])
    await expect(
      delegate(PlanActReflectAgent, 'task', {
        apiKey: 'test',
        budget: 10,
        parentBudgetRemaining: 0.4,
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError)
  })

  it('test_reflective_loop_cancellation_integration — abort stops re-entry (both on-ramps)', async () => {
    const ctrl1 = new AbortController()
    script([[toolResult]])
    h.abortCtrl = ctrl1
    await delegate(PlanActReflectAgent, 'task', { apiKey: 'test', signal: ctrl1.signal })
    expect(h.calls).toBe(1) // ran round 1, did not re-enter after abort

    const ctrl2 = new AbortController()
    script([[toolResult]])
    h.abortCtrl = ctrl2
    await AgentRunner.builder(PlanActReflectAgent)
      .build()
      .run('task', { apiKey: 'test', signal: ctrl2.signal })
    expect(h.calls).toBe(1)
  })
})
