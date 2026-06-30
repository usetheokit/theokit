/**
 * theokit#53 regression: the no_progress detector must fire on repeated IDENTICAL tool calls
 * regardless of the assistant's narration. Before the fix, `roundSignature` folded the assistant
 * text into the fingerprint, so a model that re-ran the same tool while rephrasing its prose
 * ("Vou criar… e executá-lo." → "… Agora vou executar…") produced a different signature each round
 * and evaded `NO_PROGRESS_THRESHOLD`. Prior art: opencode's `doom_loop` keys purely on
 * tool name + JSON.stringify(input) (knowledge-base/discoveries/blueprints/no-progress-signature-stuck-loop-blueprint.md).
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import { resolveLoopStrategy } from '../../src/loop/loop-strategy.js'
import { ladderReflectionStrategy } from '../../src/loop/reflection-strategy.js'
import { runReflectiveLoop, type RoundStreamFactory } from '../../src/loop/run-reflective-loop.js'

/** Yields the SAME tool call (read, {}) every round, but DRIFTS the assistant text per round. */
function sameToolDriftingTextFactory(): RoundStreamFactory {
  let round = 0
  return () => ({
    async *[Symbol.asyncIterator]() {
      round += 1
      yield { type: 'text_delta', content: `Working on it (attempt ${round}, rephrased ${round})` }
      yield { type: 'tool_call', callId: `c${round}`, toolName: 'read', input: {} }
      yield { type: 'tool_result', callId: `c${round}`, toolName: 'read', output: 'ok' }
      yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    },
  })
}

/** Yields a DIFFERENT tool input ({n: round}) every round → distinct signatures, real progress. */
function varyingInputFactory(): RoundStreamFactory {
  let round = 0
  return () => ({
    async *[Symbol.asyncIterator]() {
      round += 1
      yield { type: 'text_delta', content: `Reading page ${round}` }
      yield { type: 'tool_call', callId: `c${round}`, toolName: 'read', input: { n: round } }
      yield { type: 'tool_result', callId: `c${round}`, toolName: 'read', output: `page ${round}` }
      yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    },
  })
}

/** Yields a text-only round (no tool call) → the round ends naturally on 'stop'. */
function textOnlyFactory(): RoundStreamFactory {
  return () => ({
    async *[Symbol.asyncIterator]() {
      yield { type: 'text_delta', content: 'Here is the final answer.' }
      yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    },
  })
}

describe('theokit#53 — no_progress keys on tool-calls only (ignores narration drift)', () => {
  it('fires no_progress on identical tool-calls despite drifting assistant text', async () => {
    const loop = resolveLoopStrategy('plan-act-reflect', 5)
    const result = await runReflectiveLoop(sameToolDriftingTextFactory(), 'task', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    // Same tool+input every round; only the prose changes. The signature must match across rounds
    // → stuck reaches NO_PROGRESS_THRESHOLD (2) → terminates no_progress by round 3 (well before the
    // maxIterations=5 ceiling, which would otherwise yield 'step_limit').
    expect(result.finishReason).toBe('no_progress')
    expect(result.rounds).toBeLessThanOrEqual(3)
  })

  it('different tool inputs across rounds run to step_limit, not no_progress', async () => {
    const loop = resolveLoopStrategy('plan-act-reflect', 3)
    const result = await runReflectiveLoop(varyingInputFactory(), 'task', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    // Every round has a distinct signature ({n:1},{n:2},{n:3}) → no_progress must NEVER fire; the
    // loop legitimately reaches its maxIterations=3 ceiling on a tool-call round → 'step_limit'.
    expect(result.finishReason).not.toBe('no_progress')
    expect(result.finishReason).toBe('step_limit')
  })

  it('a text-only round terminates stop, never no_progress (the :511 TOOL_CALLS gate)', async () => {
    const loop = resolveLoopStrategy('plan-act-reflect', 3)
    const result = await runReflectiveLoop(textOnlyFactory(), 'task', 's', {
      loop,
      reflection: ladderReflectionStrategy,
    })
    expect(result.finishReason).toBe('stop')
  })
})
