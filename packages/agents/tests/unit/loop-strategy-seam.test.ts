import { describe, expect, it } from 'vitest'

import { applyCapabilities } from '../../src/capability/capability.js'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { AgentRunner } from '../../src/loop/agent-runner.js'
import type { LoopStrategy } from '../../src/loop/loop-strategy.js'
import type { RoundStreamFactory } from '../../src/loop/run-reflective-loop.js'

/**
 * M54 — `.loopStrategy(custom)` opens the fourth OCP axis of the runner (stop criterion), by
 * composition (Strategy), never by subclassing (ADR-0001). These tests assert the SEAM: precedence
 * over the spec, a free-form name, and — the point of the milestone — that a per-run `maxIterations`
 * override applies to a custom without crashing the by-name resolver the built-ins use.
 */
const agent = applyCapabilities([new ModelCapability('test-model')])

/** A custom strategy the resolver could never produce (name outside the `z.enum`). */
function neverStop(maxIterations: number): LoopStrategy {
  return { name: 'never-stop', maxIterations, shouldContinue: () => true }
}

/** A stream factory that hands back one tool-call per round, so a naive loop re-enters forever. */
function everToolCalling(): RoundStreamFactory {
  let n = 0
  return (_message, _sessionId) => {
    n += 1
    return (async function* () {
      yield { type: 'tool_result', toolName: 'read', input: { n }, output: 'ok' } as never
    })()
  }
}

describe('M54 — AgentRunnerBuilder.loopStrategy() seam', () => {
  it('a custom loopStrategy WINS over the strategy the spec name would resolve to', () => {
    const custom = neverStop(5)
    const runner = AgentRunner.fromSpec({
      compiled: agent,
      name: 'agent',
      strategy: 'react', // spec asks for react…
      maxIterations: 3,
    })
      .loopStrategy(custom) // …but the injected strategy wins
      .build()
    expect(runner.loopStrategy).toBe(custom)
    expect(runner.loopStrategy.name).toBe('never-stop')
  })

  it('without `.loopStrategy()`, the spec-derived built-in is used (zero-behavior)', () => {
    const runner = AgentRunner.fromSpec({
      compiled: agent,
      name: 'agent',
      strategy: 'react',
      maxIterations: 3,
    }).build()
    expect(runner.loopStrategy.name).toBe('react')
    expect(runner.loopStrategy.maxIterations).toBe(3)
  })

  it('accepts a free-form `name` (string), not just the three built-in names', () => {
    const runner = AgentRunner.fromSpec({ compiled: agent, name: 'agent' })
      .loopStrategy(neverStop(2))
      .build()
    expect(runner.loopStrategy.name).toBe('never-stop')
  })

  describe('per-run maxIterations override (D4)', () => {
    it('does NOT crash for a custom strategy, and applies as the runner ceiling', async () => {
      const runner = AgentRunner.fromSpec({ compiled: agent, name: 'agent' })
        .loopStrategy(neverStop(8))
        .build()

      // `neverStop` returns true forever; without the runner ceiling this never returns. The per-run
      // override of 2 must bound it — and must NOT be sent through `resolveLoopStrategy(name)` (the
      // name 'never-stop' is outside the z.enum → that would throw).
      const result = await runner.run('go', {
        apiKey: 'sk-fake-unused-streamFactory-drives-the-loop',
        maxIterations: 2,
        streamFactory: everToolCalling(),
      })
      // Did not throw, and the per-run override of 2 (not the custom's own 8) bounded it.
      expect(result.rounds).toBe(2)
      expect(result.finishReason).toBe('step_limit')
    }, 5000)

    it('leaves a built-in strategy re-resolved by name (zero-behavior)', () => {
      const runner = AgentRunner.fromSpec({
        compiled: agent,
        name: 'agent',
        strategy: 'react',
        maxIterations: 3,
      }).build()
      // Built-in path unchanged: the runner still holds the react strategy resolved from the spec.
      expect(runner.loopStrategy.name).toBe('react')
    })
  })
})
