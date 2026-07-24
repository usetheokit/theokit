/**
 * V4-F T3.1 — AgentRunner exposes the resolved compaction strategy as a public,
 * callable `runner.compaction` (ADR D1: the app calls it; the loop does not).
 *
 * BDD: Given @Compaction / .compaction() declarations, When the agent is built,
 * Then runner.compaction carries the resolved strategy (builder overrides decorator;
 * undefined when neither is set), and compact() delegates to the SDK compactTranscript.
 */
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ lastArgs: null as unknown, returnValue: [] as unknown[] }))

vi.mock('@theokit/sdk/compaction', () => ({
  compactTranscript: vi.fn(async (messages: unknown[], options: unknown) => {
    h.lastArgs = { messages, options }
    return h.returnValue
  }),
}))

const { AgentRunner } = await import('../../src/index.js')
const { applyCapabilities } = await import('../../src/capability/capability.js')
const { ModelCapability } = await import('../../src/capability/capabilities.js')
const { MainLoopCapability } = await import('../../src/capability/agent-capabilities.js')

const bareAgent = applyCapabilities([
  new ModelCapability('test-model'),
  new MainLoopCapability({ maxIterations: 3 }),
])

const decoratedAgent = {
  name: 'DecoratedAgent',
  compiled: applyCapabilities([new ModelCapability('test-model')]),
  strategy: 'plan-act-reflect' as const,
  maxIterations: 3,
  // `@Compaction` is a runner concern, not a waist field (ADR 0002 § Group B).
  compaction: { name: 'token-budget', keepTokens: 8000 },
}

describe('V4-F AgentRunner.compaction — callable strategy on the runner (T3.1)', () => {
  it('test_builder_compaction_resolves_token_budget', () => {
    const runner = AgentRunner.fromSpec({
      compiled: bareAgent,
      agentName: 'bareAgent',
      strategy: 'plan-act-reflect',
    })
      .compaction('token-budget', { keepTokens: 8000 })
      .build()
    expect(runner.compaction?.name).toBe('token-budget')
    expect(runner.compaction?.keepTokens).toBe(8000)
  })

  it('test_Compaction_decorator_flows_to_runner', () => {
    const runner = AgentRunner.fromSpec(decoratedAgent).build()
    expect(runner.compaction?.name).toBe('token-budget')
    expect(runner.compaction?.keepTokens).toBe(8000)
  })

  it('test_builder_compaction_overrides_decorator', () => {
    // EC-1 (MUST FIX) — builder .compaction() WINS over @Compaction decorator
    const runner = AgentRunner.fromSpec(decoratedAgent)
      .compaction('token-budget', { keepTokens: 2000 })
      .build()
    expect(runner.compaction?.keepTokens).toBe(2000)
  })

  it('test_runner_compaction_undefined_when_unset', () => {
    // EC-4 — neither decorator nor builder ⇒ undefined (opt-in); app must null-check
    const runner = AgentRunner.fromSpec({
      compiled: bareAgent,
      agentName: 'bareAgent',
      strategy: 'plan-act-reflect',
    }).build()
    expect(runner.compaction).toBeUndefined()
  })

  it('test_runner_compaction_compact_delegates_end_to_end', async () => {
    h.lastArgs = null
    h.returnValue = [{ role: 'user', content: 'kept' }]
    const summarize = async () => ({ role: 'system', content: 's' })
    const runner = AgentRunner.fromSpec(decoratedAgent).build()
    const out = await runner.compaction!.compact([{ role: 'user', content: 'a' }] as never, {
      summarize: summarize as never,
    })
    // builder → resolver → strategy → SDK compactTranscript, with the configured keepTokens
    expect((h.lastArgs as { options: { keepTokens: number } }).options.keepTokens).toBe(8000)
    expect(out).toEqual([{ role: 'user', content: 'kept' }])
  })
})
