import { describe, expect, it } from 'vitest'

import { noopReflectionStrategy } from '../../src/loop/reflection-strategy.js'
import type { LoopStrategy } from '../../src/loop/loop-strategy.js'
import { runReflectiveLoop } from '../../src/loop/run-reflective-loop.js'

interface StreamEvent {
  type: string
  [key: string]: unknown
}

/**
 * M54 — the hard ceiling is the RUNNER's, not the strategy's.
 *
 * Until M54 the three built-in strategies embedded `round < maxIterations` inside their own
 * `shouldContinue`, so the ceiling was a convention each strategy kept — never a guarantee the
 * runner enforced. The moment `.loopStrategy(custom)` opens the seam, a custom that returns `true`
 * forever would run until the budget blew (or forever, with an infinite budget). This file injects
 * exactly that custom and asserts the runner stops it at `maxIterations`. Before the fix these tests
 * do not terminate — that non-termination is the proof the gate can fail.
 */
function alwaysContinue(maxIterations: number): LoopStrategy {
  return { name: 'always', maxIterations, shouldContinue: () => true }
}

/** A factory that hands back a fresh tool-call every round, so a naive loop would re-enter forever. */
function everToolCalling() {
  let n = 0
  return (_message: string, _sessionId: string): AsyncIterable<StreamEvent> => {
    n += 1
    const ev: StreamEvent = { type: 'tool_result', toolName: 'read', input: { n }, output: 'ok' }
    return (async function* () {
      yield ev
    })()
  }
}

describe('M54 — runner-enforced hard ceiling', () => {
  it('stops a `shouldContinue: () => true` custom at exactly maxIterations', async () => {
    const result = await runReflectiveLoop(everToolCalling(), 'msg', 's', {
      loop: alwaysContinue(3),
      reflection: noopReflectionStrategy,
    })
    // Without the runner ceiling this never returns. With it: exactly 3 rounds ran.
    expect(result.rounds).toBe(3)
  }, 5000)

  it('the ceiling-bound terminal reason is `step_limit`', async () => {
    const result = await runReflectiveLoop(everToolCalling(), 'msg', 's', {
      loop: alwaysContinue(2),
      reflection: noopReflectionStrategy,
    })
    expect(result.finishReason).toBe('step_limit')
  }, 5000)

  it('a degenerate maxIterations of 1 still terminates (one round)', async () => {
    const result = await runReflectiveLoop(everToolCalling(), 'msg', 's', {
      loop: alwaysContinue(1),
      reflection: noopReflectionStrategy,
    })
    expect(result.rounds).toBe(1)
  }, 5000)
})
