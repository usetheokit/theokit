/**
 * Step-cap force-close: on the ceiling round (`round === maxIterations`) the loop calls the factory
 * with `disableTools: true`, which the SDK adapter maps to `tool_choice:"none"` at send-time —
 * forcing the model to emit the closing summary the STEP_LIMIT_HINT requests instead of spinning on
 * more tool calls. Below the ceiling, tools stay enabled. Mirrors opencode's MAX_STEPS_PROMPT +
 * toolChoice:"none". A cached agent's tools can't be un-registered, so the gate is per-send.
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import { resolveLoopStrategy } from '../../src/loop/loop-strategy.js'
import { ladderReflectionStrategy } from '../../src/loop/reflection-strategy.js'
import { runReflectiveLoop, type RoundStreamFactory } from '../../src/loop/run-reflective-loop.js'

/** Records `disableTools` per round; yields tool-calls normally, a text-only summary when gated. */
function gatedFactory(seen: boolean[]): RoundStreamFactory {
  return (_m, _s, opts) => ({
    async *[Symbol.asyncIterator]() {
      seen.push(opts?.disableTools === true)
      if (opts?.disableTools === true) {
        yield { type: 'text_delta', content: 'Final summary: work done.' }
        yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
        return
      }
      yield { type: 'tool_call', callId: 'c1', toolName: 'read', input: {} }
      yield { type: 'tool_result', callId: 'c1', toolName: 'read', output: 'ok' }
      yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    },
  })
}

describe('step-cap force-close', () => {
  it('test_ceiling_round_gates_tools_off_and_closes_on_text', async () => {
    const seen: boolean[] = []
    const loop = resolveLoopStrategy('plan-act-reflect', 2)
    const result = await runReflectiveLoop(gatedFactory(seen), 'task', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(seen).toEqual([false, true]) // round 1 normal; round 2 (ceiling) tools gated off
    expect(result.finishReason).toBe('stop') // forced text close — NOT step_limit dangling on a tool
    expect(result.response).toContain('Final summary')
    expect(result.rounds).toBe(2)
  })

  it('test_below_ceiling_rounds_keep_tools', async () => {
    const seen: boolean[] = []
    const loop = resolveLoopStrategy('plan-act-reflect', 3)
    // A model that closes on its own at round 1 → never reaches the ceiling → never gated.
    const factory: RoundStreamFactory = (_m, _s, opts) => ({
      async *[Symbol.asyncIterator]() {
        seen.push(opts?.disableTools === true)
        yield { type: 'text_delta', content: 'done at round 1' }
        yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      },
    })
    const result = await runReflectiveLoop(factory, 'task', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(seen).toEqual([false]) // only round 1 ran, and it was NOT the ceiling (3) → tools kept
    expect(result.finishReason).toBe('stop')
  })
})
