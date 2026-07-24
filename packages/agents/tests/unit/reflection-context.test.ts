/**
 * V4-K — a per-run mutable ReflectionContext threaded to ReflectionStrategy.reflect,
 * so a stateful strategy can accumulate cumulative state (counters, one-shot flags)
 * across rounds. The framework creates ONE ctx per run and passes the SAME ref each
 * round; it writes NOTHING app-specific into it (the strategy owns the contents).
 *
 * BDD: Given a custom strategy, When the reflective loop runs multiple rounds, Then
 * reflect() receives the same ctx object every round and its accumulated state drives
 * termination; shipped ladder/noop ignore ctx (backward-compatible).
 */
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ calls: 0 }))

vi.mock('../../src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream:
    () =>
    (
      _message: string,
      _sessionId: string,
    ): AsyncIterable<{ type: string; [k: string]: unknown }> => {
      const i = h.calls++
      // A tool-using round (finishReason 'tool-calls') so the loop re-enters; unique input
      // per round so the no_progress detector never fires.
      return (async function* () {
        yield { type: 'tool_result', toolName: 't', input: { i }, output: 'r' }
        yield { type: 'done' }
      })()
    },
}))

const { AgentRunner } = await import('../../src/index.js')
const { applyCapabilities } = await import('../../src/capability/capability.js')
const { ModelCapability } = await import('../../src/capability/capabilities.js')
const { MainLoopCapability } = await import('../../src/capability/agent-capabilities.js')
const { ladderReflectionStrategy, noopReflectionStrategy } =
  await import('../../src/loop/reflection-strategy.js')

const reactAgent = applyCapabilities([
  new ModelCapability('test-model'),
  new MainLoopCapability({ maxIterations: 8 }),
])

describe('V4-K ReflectionContext threading', () => {
  it('test_reflect_receives_same_context_object_across_rounds', async () => {
    h.calls = 0
    const refs: unknown[] = []
    const custom = {
      name: 'capture',
      reflect(_outcome: unknown, ctx: Record<string, unknown>) {
        refs.push(ctx)
        ctx.n = ((ctx.n as number) ?? 0) + 1
        return { continue: (ctx.n as number) < 3 }
      },
    }
    const runner = AgentRunner.fromSpec({
      compiled: reactAgent,
      name: 'reactAgent',
      strategy: 'react',
    })
      .reflection(custom as never)
      .build()
    const result = await runner.run('go', { apiKey: 'k' })

    expect(refs.length).toBe(3) // reflect called once per round, 3 rounds
    expect(refs[0]).toBe(refs[1]) // SAME object ref every round
    expect(refs[1]).toBe(refs[2])
    expect((refs[0] as { n: number }).n).toBe(3) // cumulative state survived across rounds
    expect(result.rounds).toBe(3)
  })

  it('test_stateful_strategy_accumulates_and_terminates', async () => {
    h.calls = 0
    const custom = {
      name: 'count-to-2',
      reflect(_outcome: unknown, ctx: Record<string, unknown>) {
        ctx.count = ((ctx.count as number) ?? 0) + 1
        return { continue: (ctx.count as number) < 2 } // stop once the cumulative count hits 2
      },
    }
    const runner = AgentRunner.fromSpec({
      compiled: reactAgent,
      name: 'reactAgent',
      strategy: 'react',
    })
      .reflection(custom as never)
      .build()
    const result = await runner.run('go', { apiKey: 'k' })
    expect(result.rounds).toBe(2) // terminated by the strategy's cumulative state
  })

  it('test_each_run_gets_a_fresh_context_no_cross_run_sharing', async () => {
    // Risk #4 (review): each runReflectiveLoopStream call must get its OWN ctx — a
    // second run must NOT see the first run's accumulated state.
    const seen: Record<string, unknown>[] = []
    const custom = {
      name: 'tag-run',
      reflect(_outcome: unknown, ctx: Record<string, unknown>) {
        seen.push(ctx)
        ctx.hits = ((ctx.hits as number) ?? 0) + 1
        return { continue: false } // one round per run
      },
    }
    const runner = AgentRunner.fromSpec({
      compiled: reactAgent,
      name: 'reactAgent',
      strategy: 'react',
    })
      .reflection(custom as never)
      .build()
    h.calls = 0
    await runner.run('run-1', { apiKey: 'k' })
    await runner.run('run-2', { apiKey: 'k' })

    expect(seen).toHaveLength(2)
    expect(seen[0]).not.toBe(seen[1]) // distinct ctx objects per run
    expect((seen[1] as { hits: number }).hits).toBe(1) // run-2 did NOT inherit run-1's count
  })

  it('test_v4j_tools_and_v4k_context_compose_in_one_run', async () => {
    // V4-J (opts.tools) + V4-K (ctx) compose: a stateful strategy runs while a per-run
    // tool override is in effect — both hooks coexist without interference.
    h.calls = 0
    let ctxSeen: Record<string, unknown> | undefined
    const custom = {
      name: 'compose',
      reflect(_outcome: unknown, ctx: Record<string, unknown>) {
        ctxSeen = ctx
        ctx.k = ((ctx.k as number) ?? 0) + 1
        return { continue: (ctx.k as number) < 2 }
      },
    }
    const runner = AgentRunner.fromSpec({
      compiled: reactAgent,
      name: 'reactAgent',
      strategy: 'react',
    })
      .reflection(custom as never)
      .build()
    const tool = { name: 'x', description: 'd', inputSchema: {}, handler: async () => 'r' }
    const result = await runner.run('go', { apiKey: 'k', tools: [tool] as never })
    expect(result.rounds).toBe(2) // ctx-driven termination held with tools override active
    expect((ctxSeen as { k: number }).k).toBe(2)
  })

  it('test_shipped_ladder_and_noop_ignore_ctx', () => {
    // BC: the shipped strategies accept (outcome, ctx?) and behave identically with/without ctx.
    const outcome = {
      finishReason: 'tool-calls' as const,
      round: 1,
      toolCalls: [],
      responseText: '',
    }
    const ladderWith = ladderReflectionStrategy.reflect(outcome, {})
    const ladderWithout = ladderReflectionStrategy.reflect(outcome)
    expect(ladderWith).toEqual(ladderWithout)
    expect(ladderWith.continue).toBe(true)

    const noopWith = noopReflectionStrategy.reflect(outcome, {})
    const noopWithout = noopReflectionStrategy.reflect(outcome)
    expect(noopWith).toEqual(noopWithout)
    expect(noopWith.continue).toBe(true)
  })
})
