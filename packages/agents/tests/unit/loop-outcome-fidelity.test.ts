/**
 * V4-N — the reflective loop preserves per-round tool-call fidelity: `toolCalls` entries
 * carry `{id, name, input, output}` (input = the tool-call args, correlated from the
 * `tool_call` event by callId — not `{}`), and `DelegationResult` carries split
 * `tokensInput`/`tokensOutput`. Unblocks a consumer's verify ladder + usage analytics.
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import { runReflectiveLoop, type RoundStreamFactory } from '../../src/loop/run-reflective-loop.js'
import { resolveLoopStrategy } from '../../src/loop/loop-strategy.js'
import type { LoopOutcome } from '../../src/loop/loop-strategy.js'
import {
  noopReflectionStrategy,
  type ReflectionStrategy,
} from '../../src/loop/reflection-strategy.js'
import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'

function factoryFrom(rounds: StreamEvent[][]): RoundStreamFactory {
  let i = 0
  return () => ({
    async *[Symbol.asyncIterator]() {
      const evs = rounds[i++] ?? []
      for (const e of evs) yield e
    },
  })
}

const oneShot = resolveLoopStrategy('simple-chat', 1)

describe('V4-N loop outcome fidelity', () => {
  it('test_toolcall_carries_id_input_output', async () => {
    const factory = factoryFrom([
      [
        { type: 'tool_call', callId: 'c1', toolName: 'shell_exec', input: { command: 'pytest' } },
        { type: 'tool_result', callId: 'c1', toolName: 'shell_exec', output: 'ok' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ],
    ])
    const result = await runReflectiveLoop(factory, 'task', 's', {
      loop: oneShot,
      reflection: noopReflectionStrategy,
    })
    expect(result.toolCalls[0]).toMatchObject({
      id: 'c1',
      name: 'shell_exec',
      input: { command: 'pytest' },
      output: 'ok',
    })
  })

  it('test_split_usage_accumulated', async () => {
    const factory = factoryFrom([
      [
        { type: 'tool_result', callId: 'c1', toolName: 't', output: 'ok' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ],
    ])
    const result = await runReflectiveLoop(factory, 'task', 's', {
      loop: oneShot,
      reflection: noopReflectionStrategy,
    })
    expect(result.tokensInput).toBe(10)
    expect(result.tokensOutput).toBe(5)
    expect(result.tokens).toBe(15) // total preserved (backward compat)
  })

  it('test_multiple_tool_calls_correlated_by_id', async () => {
    // EC-1: two calls in one round pair input→output by callId, not by order.
    const factory = factoryFrom([
      [
        { type: 'tool_call', callId: 'c1', toolName: 'shell_exec', input: { command: 'pytest' } },
        { type: 'tool_call', callId: 'c2', toolName: 'shell_exec', input: { command: 'ls' } },
        { type: 'tool_result', callId: 'c1', toolName: 'shell_exec', output: 'p-out' },
        { type: 'tool_result', callId: 'c2', toolName: 'shell_exec', output: 'l-out' },
        { type: 'done' },
      ],
    ])
    const result = await runReflectiveLoop(factory, 'task', 's', {
      loop: oneShot,
      reflection: noopReflectionStrategy,
    })
    const byId = Object.fromEntries(result.toolCalls.map((t) => [t.id, t]))
    expect(byId.c1).toMatchObject({ input: { command: 'pytest' }, output: 'p-out' })
    expect(byId.c2).toMatchObject({ input: { command: 'ls' }, output: 'l-out' })
  })

  it('test_unmatched_tool_result_degrades_to_empty_input', async () => {
    // EC-2: a tool_result with no prior tool_call (SDK omitted the id) → input {}, no throw.
    const factory = factoryFrom([
      [{ type: 'tool_result', callId: 'cX', toolName: 't', output: 'ok' }, { type: 'done' }],
    ])
    const result = await runReflectiveLoop(factory, 'task', 's', {
      loop: oneShot,
      reflection: noopReflectionStrategy,
    })
    expect(result.toolCalls[0]).toMatchObject({ id: 'cX', name: 't', input: {}, output: 'ok' })
  })

  it('test_reasoning_cache_buckets_accumulated_across_rounds', async () => {
    // V4-O: each round's done carries reasoning/cache buckets; the loop sums them into
    // DelegationResult (mirrors the V4-N split-usage accumulation).
    const twoRounds = resolveLoopStrategy('react', 2)
    const factory = factoryFrom([
      [
        { type: 'tool_call', callId: 'c1', toolName: 't', input: { a: 1 } },
        { type: 'tool_result', callId: 'c1', toolName: 't', output: 'ok' },
        {
          type: 'done',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            reasoningTokens: 3,
            cacheReadTokens: 5,
            cacheWriteTokens: 2,
          },
        },
      ],
      [
        {
          type: 'done',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            reasoningTokens: 3,
            cacheReadTokens: 5,
            cacheWriteTokens: 2,
          },
        },
      ],
    ])
    const result = await runReflectiveLoop(factory, 'task', 's', {
      loop: twoRounds,
      reflection: noopReflectionStrategy,
    })
    expect(result.reasoningTokens).toBe(6)
    expect(result.cacheReadTokens).toBe(10)
    expect(result.cacheWriteTokens).toBe(4)
  })

  it('test_plan_act_reflect_defers_continuation_to_reflection', async () => {
    // V4-S: plan-act-reflect's shouldContinue is `round < max`, so a custom reflection can extend
    // even a terminal `stop` round (e.g. "you answered without editing — edit now").
    let calls = 0
    const factory = factoryFrom([
      [
        { type: 'text_delta', content: 'no edit' },
        { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ],
      [
        { type: 'text_delta', content: 'edited' },
        { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ],
    ])
    const once: ReflectionStrategy = {
      name: 'once',
      reflect(outcome) {
        calls += 1
        return { continue: outcome.round < 2, feedback: 'edit now' }
      },
    }
    const result = await runReflectiveLoop(factory, 'task', 's', {
      loop: resolveLoopStrategy('plan-act-reflect', 5),
      reflection: once,
    })
    expect(calls).toBe(2) // round 1 was a `stop` round, yet the reflection extended it to round 2
    expect(result.rounds).toBe(2)
    expect(result.response).toBe('no editedited')
  })

  it('test_reflection_strategy_sees_tool_input', async () => {
    let seen: LoopOutcome | undefined
    const capture: ReflectionStrategy = {
      name: 'capture',
      reflect(outcome) {
        seen = outcome
        return { continue: false }
      },
    }
    const factory = factoryFrom([
      [
        {
          type: 'tool_call',
          callId: 'c1',
          toolName: 'shell_exec',
          input: { command: 'pytest -k x' },
        },
        { type: 'tool_result', callId: 'c1', toolName: 'shell_exec', output: 'ok' },
        { type: 'done' },
      ],
    ])
    await runReflectiveLoop(factory, 'task', 's', { loop: oneShot, reflection: capture })
    const input = seen?.toolCalls[0]?.input as { command?: string } | undefined
    expect(input?.command).toBe('pytest -k x')
  })
})
