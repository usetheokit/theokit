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

const { delegate, BudgetExceededError } = await import('../../src/bridge/agent-orchestrator.js')
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
    await expect(
      delegate(reflectAgent, 'task', { apiKey: 'test', budget: 1.2 }),
    ).rejects.toBeInstanceOf(BudgetExceededError)
  })
})
