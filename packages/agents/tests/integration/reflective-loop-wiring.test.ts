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
