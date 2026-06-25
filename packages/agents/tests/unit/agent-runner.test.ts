/**
 * T3.1 — AgentRunner.builder() imperative twin.
 *
 * Proves builder + decorator are two on-ramps to ONE compiled runtime (ADR D4):
 * `build()` resolves the same `{ loopStrategy }` `delegate()` does; `run()`
 * delegates to the same `runReflectiveLoop`. SDK boundary mocked per-file.
 */
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'

interface StreamEvent {
  type: string
  [key: string]: unknown
}

const h = vi.hoisted(() => ({ rounds: [] as StreamEvent[][], calls: 0 }))

vi.mock('../../src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream:
    () =>
    (_message: string, _sessionId: string): AsyncIterable<StreamEvent> => {
      const events = h.rounds[Math.min(h.calls, h.rounds.length - 1)] ?? []
      h.calls += 1
      return (async function* () {
        for (const e of events) yield e
      })()
    },
}))

const { Agent } = await import('../../src/decorators/agent.js')
const { MainLoop } = await import('../../src/decorators/main-loop.js')
const { AgentRunner } = await import('../../src/loop/agent-runner.js')
const { resolveLoopStrategy } = await import('../../src/loop/loop-strategy.js')

@Agent({ model: 'test-model' })
class ReflectAgent {
  @MainLoop({ strategy: 'plan-act-reflect', maxIterations: 3 })
  async run() {}
}

@Agent({ model: 'test-model' })
class ZeroAgent {
  @MainLoop({ strategy: 'react', maxIterations: 0 })
  async run() {}
}

function script(rounds: StreamEvent[][]): void {
  h.rounds = rounds
  h.calls = 0
}

describe('AgentRunner (T3.1)', () => {
  it('test_agentrunner_builder_fluent_chain_returns_runner', () => {
    const runner = AgentRunner.builder(ReflectAgent).reflection().stream().build()
    expect(runner).toBeInstanceOf(AgentRunner)
  })

  it('test_agentrunner_build_parity_with_delegate — same loopStrategy as delegate resolves (D4)', () => {
    const runner = AgentRunner.builder(ReflectAgent).build()
    const expected = resolveLoopStrategy('plan-act-reflect', 3)
    expect(runner.loopStrategy.name).toBe(expected.name)
    expect(runner.loopStrategy.maxIterations).toBe(expected.maxIterations)
  })

  it('test_agentrunner_run_multi_round_for_plan_act_reflect — 2 rounds', async () => {
    script([[{ type: 'tool_result', toolName: 'x', input: {}, output: 'r' }], [{ type: 'done' }]])
    const runner = AgentRunner.builder(ReflectAgent).build()
    await runner.run('task', { apiKey: 'test' })
    expect(h.calls).toBe(2)
  })

  it('test_agentrunner_reflection_override — custom strategy used, not ladder', async () => {
    let used = false
    const custom = {
      name: 'custom',
      reflect: () => {
        used = true
        return { continue: false }
      },
    }
    script([[{ type: 'tool_result', toolName: 'x', input: {}, output: 'r' }]])
    const runner = AgentRunner.builder(ReflectAgent).reflection(custom).build()
    expect(runner.reflectionStrategy).toBe(custom)
    await runner.run('task', { apiKey: 'test' })
    expect(used).toBe(true)
  })

  it('test_agentrunner_build_validates_maxiterations — maxIterations 0 throws (Zod)', () => {
    expect(() => AgentRunner.builder(ZeroAgent).build()).toThrow()
  })
})
