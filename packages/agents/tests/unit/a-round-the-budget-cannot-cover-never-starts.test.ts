/**
 * B-409 — a USD ceiling must stop a run BEFORE the call that would exceed it, not after.
 *
 * Today the reflective loop compares cumulative cost to the ceiling only after a round has
 * finished (`run-reflective-loop.ts`), so the round that crosses the ceiling is always paid
 * for. Each scripted round below costs 0.01 and asks to continue; the ceiling is 0.015. The
 * first round leaves 0.005 of headroom, which cannot cover a second 0.01 round.
 *
 * Expected: the second round never starts, and the typed error names the limit and the
 * spend so far. Projection rule assumed by this test: the next round costs what the last
 * one did (an open design question recorded in the opportunity).
 */
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'

interface StreamEvent {
  type: string
  [key: string]: unknown
}

const h = vi.hoisted(() => ({ calls: 0 }))

vi.mock('../../src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream:
    () =>
    (_message: string, _sessionId: string): AsyncIterable<StreamEvent> => {
      h.calls += 1
      const round = h.calls
      return (async function* () {
        yield { type: 'text_delta', content: `round ${String(round)} ` }
        yield { type: 'tool_result', toolName: `t${String(round)}`, input: {}, output: 'r' }
        yield { type: 'done', cost: 0.01 }
      })()
    },
}))

const { AgentRunner, DelegationBudgetExceededError } = await import('../../src/index.js')
const { applyCapabilities } = await import('../../src/capability/capability.js')
const { ModelCapability } = await import('../../src/capability/capabilities.js')
const { MainLoopCapability } = await import('../../src/capability/agent-capabilities.js')

const agent = applyCapabilities([
  new ModelCapability('test-model'),
  new MainLoopCapability({ maxIterations: 5 }),
])

describe('a USD ceiling stops the run before the round that would exceed it', () => {
  it('test_a_round_the_budget_cannot_cover_never_starts', async () => {
    h.calls = 0
    const runner = AgentRunner.fromSpec({
      compiled: agent,
      name: 'budgetAgent',
      strategy: 'plan-act-reflect',
    }).build()

    let threw: unknown
    try {
      await runner.run('go', { apiKey: 'k', budget: 0.015 })
    } catch (err) {
      threw = err
    }

    expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
    const error = threw as InstanceType<typeof DelegationBudgetExceededError>
    expect(error.budgetLimit).toBe(0.015)
    // The spend never passes the ceiling: only the first round was paid for.
    expect(error.actualCost).toBeLessThanOrEqual(error.budgetLimit)
    expect(h.calls).toBe(1)
  })
})
