/**
 * T2.2 — delegate() routes @MainLoop strategy to the reflective loop.
 *
 * Proves the wiring: a non-`simple-chat` strategy drives multi-round behavior
 * (closing V4-A's metadata-only gap), `simple-chat` stays single-shot (EC-2),
 * and the cumulative budget clamp survives across rounds (EC-4). The SDK
 * boundary (`createSdkAgentStream`) is mocked per-file so no LLM is called —
 * the model call still belongs to the SDK in production (ADR 0031).
 */
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'

interface StreamEvent {
  type: string
  [key: string]: unknown
}

const h = vi.hoisted(() => ({
  rounds: [] as StreamEvent[][],
  prompts: [] as string[],
  calls: 0,
}))

vi.mock('../../src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream:
    () =>
    (message: string, _sessionId: string): AsyncIterable<StreamEvent> => {
      h.prompts.push(message)
      const events = h.rounds[Math.min(h.calls, h.rounds.length - 1)] ?? []
      h.calls += 1
      return (async function* () {
        for (const e of events) yield e
      })()
    },
}))

const {
  delegate,
  DelegationBudgetCostUnknownError,
  DelegationBudgetExceededError,
  DelegationError,
} = await import('../../src/bridge/agent-orchestrator.js')
const { createDelegateTool } = await import('../../src/tools/delegate-tool.js')
const { applyCapabilities } = await import('../../src/capability/capability.js')
const { ModelCapability } = await import('../../src/capability/capabilities.js')

const reflectAgent = {
  name: 'ReflectAgent',
  compiled: applyCapabilities([new ModelCapability('test-model')]),
  strategy: 'plan-act-reflect' as const,
  maxIterations: 3,
}

const chatAgent = {
  name: 'ChatAgent',
  compiled: applyCapabilities([new ModelCapability('test-model')]),
  strategy: 'simple-chat' as const,
}

function script(rounds: StreamEvent[][]): void {
  h.rounds = rounds
  h.prompts = []
  h.calls = 0
}

describe('delegate() @MainLoop routing (T2.2)', () => {
  it('test_delegate_plan_act_reflect_multi_rounds — 2 rounds + feedback injected', async () => {
    script([[{ type: 'tool_result', toolName: 'x', input: {}, output: 'r' }], [{ type: 'done' }]])
    await delegate(reflectAgent, 'task', { apiKey: 'test' })
    expect(h.calls).toBe(2)
    expect(h.prompts[1]).toContain('reflection')
  })

  it('test_delegate_simple_chat_single_round — single-shot preserved (EC-2)', async () => {
    script([[{ type: 'tool_result', toolName: 'x', input: {}, output: 'r' }]])
    await delegate(chatAgent, 'task', { apiKey: 'test' })
    expect(h.calls).toBe(1)
  })

  it('test_delegate_budget_clamp_across_rounds — cumulative cost throws (EC-4)', async () => {
    script([[{ type: 'done', cost: 0.5, finishReason: 'tool-calls' }]])
    const threw = await delegateAndCatch(1.2)

    expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
    // B-409: $1.00 spent plus a projected $0.50 passes $1.20, so the refusal comes BEFORE round 3,
    // not after it as it did when only the post-round check existed.
    expect(h.calls).toBe(2)
    const error = threw as InstanceType<typeof DelegationBudgetExceededError>
    expect(error.projectedRoundCost).toBe(0.5)
    expect(error.message).toContain('projected')
  })

  it('test_delegate_catches_a_round_costlier_than_the_last_after_it_runs', async () => {
    // Round 1 costs $0.10, so round 2 is projected at $0.10 and admitted under $0.50. It then costs
    // $1.00, which only the post-round backstop can see.
    script([
      [{ type: 'done', cost: 0.1, finishReason: 'tool-calls' }],
      [{ type: 'done', cost: 1, finishReason: 'tool-calls' }],
    ])
    const threw = await delegateAndCatch(0.5)

    expect(h.calls).toBe(2)
    expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
    const error = threw as InstanceType<typeof DelegationBudgetExceededError>
    expect(error.message).toContain('$1.1000 > $0.5000')
    expect(error.projectedRoundCost).toBeUndefined()
  })

  it('test_delegate_stops_after_an_unpriced_round_when_a_budget_is_set', async () => {
    script([[{ type: 'done', finishReason: 'tool-calls' }]])
    const threw = await delegateAndCatch(1)

    expect(h.calls).toBe(1)
    expect(threw).toBeInstanceOf(DelegationBudgetCostUnknownError)
  })
})

async function delegateAndCatch(budget: number): Promise<unknown> {
  try {
    await delegate(reflectAgent, 'task', { apiKey: 'test', budget })
  } catch (err) {
    return err
  }
  return undefined
}

describe('the delegate tool over a budgeted delegate() (B-409)', () => {
  const tool = () =>
    createDelegateTool({
      roster: [{ name: 'worker', target: reflectAgent }],
      defaults: { apiKey: 'test', budget: 1 },
    })

  it('test_the_delegate_tool_reports_a_projected_refusal_as_budget_exceeded', async () => {
    script([[{ type: 'done', cost: 0.6, finishReason: 'tool-calls' }]])
    const payload = JSON.parse((await tool().handler({ agent: 'worker', task: 't' })) as string)

    expect(h.calls).toBe(1)
    expect(payload).toMatchObject({ ok: false, error: 'delegation_budget_exceeded' })
    expect(payload.message).toContain('projected')
  })

  it('test_the_delegate_tool_tells_the_model_an_unpriced_round_stopped_the_run', async () => {
    // The tool keeps one code for both refusals: the cost-unknown error IS a budget refusal (a
    // subclass), and its message crosses, so the model reads that the cost was not known rather
    // than that the spend passed the limit.
    script([[{ type: 'done', finishReason: 'tool-calls' }]])
    const payload = JSON.parse((await tool().handler({ agent: 'worker', task: 't' })) as string)

    expect(h.calls).toBe(1)
    expect(payload).toMatchObject({ ok: false, error: 'delegation_budget_exceeded' })
    expect(payload.message).toContain('is not known')
  })
})

/**
 * Code review #67 / #81, review 2026-10-09: `delegate()` clamped `budget` and
 * `parentBudgetRemaining` with `Math.min` and validated neither, so `NaN` disabled both ceilings.
 * A value that is not a number is refused with `DelegationError`, naming the field. A ceiling of 0
 * or below is a budget with nothing left, which a parent that has spent its ceiling passes as its
 * remainder: it stops the run before any round with `DelegationBudgetExceededError`, the class it
 * ended in before, and the delegate tool reports it as `delegation_budget_exceeded`. `Infinity`
 * keeps meaning no ceiling, which a remainder computed from an unbounded parent evaluates to.
 */
describe('delegate() refuses a ceiling it cannot enforce', () => {
  async function refusalOf(opts: { budget?: number; parentBudgetRemaining?: number }) {
    script([[{ type: 'done', cost: 0.01 }]])
    try {
      await delegate(reflectAgent, 'task', { apiKey: 'test', ...opts })
    } catch (err) {
      return err
    }
    return undefined
  }

  it.each(['budget', 'parentBudgetRemaining'] as const)(
    'test_a_nan_%s_is_refused_before_any_round',
    async (field) => {
      const threw = await refusalOf({ budget: 1, [field]: Number.NaN })

      expect(h.calls).toBe(0)
      expect(threw).toBeInstanceOf(DelegationError)
      expect((threw as InstanceType<typeof DelegationError>).cause).toMatchObject({
        message: `${field} must be a number, got NaN`,
      })
    },
  )

  it.each([0, -0.5, Number.NEGATIVE_INFINITY])(
    'test_a_parent_budget_remaining_of_%s_stops_the_run_as_budget_exceeded_before_any_round',
    async (remaining) => {
      const threw = await refusalOf({ budget: 1, parentBudgetRemaining: remaining })

      expect(h.calls).toBe(0)
      expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
      const error = threw as InstanceType<typeof DelegationBudgetExceededError>
      expect(error.actualCost).toBe(0)
      expect(error.budgetLimit).toBe(remaining)
      expect(error.message).toContain('before its first round')
    },
  )

  it.each([0, -1])('test_a_delegate_budget_of_%s_stops_before_any_round', async (budget) => {
    const threw = await refusalOf({ budget })

    expect(h.calls).toBe(0)
    expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
  })

  it('test_an_infinite_parent_budget_remaining_means_no_ceiling', async () => {
    const threw = await refusalOf({ parentBudgetRemaining: Number.POSITIVE_INFINITY })

    expect(threw).toBeUndefined()
    expect(h.calls).toBe(1)
  })

  it('test_the_delegate_tool_reports_a_spent_parent_budget_as_budget_exceeded', async () => {
    script([[{ type: 'done', cost: 0.01 }]])
    const tool = createDelegateTool({
      roster: [{ name: 'worker', target: reflectAgent }],
      defaults: { apiKey: 'test', parentBudgetRemaining: 0 },
    })
    const payload = JSON.parse((await tool.handler({ agent: 'worker', task: 't' })) as string)

    expect(h.calls).toBe(0)
    expect(payload).toMatchObject({ ok: false, error: 'delegation_budget_exceeded' })
  })
})
