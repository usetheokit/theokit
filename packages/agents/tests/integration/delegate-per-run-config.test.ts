/**
 * V4-T — `delegate()` forwards the per-run config surface (parity with `AgentRunner.stream()`):
 * `model`/`cwd`/`plugins`/`providers`/`agents`/`budgetTracker`/`conversationStorage`/`sdkTools` reach
 * `createSdkAgentStream`'s overrides, and `retry`/`reflection` reach the reflective loop config.
 * Absent fields ⇒ today's behavior (decorator model only; strategy-derived reflection; no retry).
 */
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeOverrides } from '../../src/bridge/sdk-adapter.js'

const h = vi.hoisted(() => ({
  overrides: undefined as RuntimeOverrides | undefined,
  loopConfig: undefined as Record<string, unknown> | undefined,
}))

vi.mock('../../src/bridge/sdk-adapter.js', () => ({
  // capture the 4th arg (the per-run overrides V4-T forwards); return a terminal stream factory
  createSdkAgentStream: (
    _compiled: unknown,
    _tools: unknown,
    _key: string,
    overrides: RuntimeOverrides,
  ) => {
    h.overrides = overrides
    return () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      },
    })
  },
}))

vi.mock('../../src/loop/run-reflective-loop.js', () => ({
  // capture the loop config (proves retry + reflection forwarding); return a fake result
  runReflectiveLoop: async (
    _factory: unknown,
    _msg: string,
    _sid: string,
    config: Record<string, unknown>,
  ) => {
    h.loopConfig = config
    return { response: '', toolCalls: [], cost: 0, tokens: 0 }
  },
}))

const { delegate } = await import('../../src/bridge/agent-orchestrator.js')
const { Agent } = await import('../../src/decorators/agent.js')
const { MainLoop } = await import('../../src/decorators/main-loop.js')

@Agent({ name: 'sub', route: '/sub', model: 'decorator-model' })
class SubAgent {
  @MainLoop({ strategy: 'plan-act-reflect', maxIterations: 4 })
  async run() {}
}

const customReflection = { name: 'custom', reflect: () => ({ continue: false }) }

describe('V4-T delegate() forwards per-run config', () => {
  beforeEach(() => {
    h.overrides = undefined
    h.loopConfig = undefined
  })
  afterEach(() => vi.clearAllMocks())

  it('test_forwards_runtime_overrides_to_createSdkAgentStream', async () => {
    const fakeTool = { name: 'x', description: 'd', inputSchema: {}, handler: () => 'ok' }
    await delegate(SubAgent, 'hi', {
      apiKey: 'k',
      model: 'override-model',
      cwd: '/repo',
      plugins: { enabled: true } as never,
      providers: { routes: [] } as never,
      agents: { helper: {} as never },
      budgetTracker: { onStep: () => {} } as never,
      conversationStorage: { getMessages: async () => [], appendMessage: async () => {} } as never,
      sdkTools: [fakeTool] as never,
    })
    expect(h.overrides?.model).toBe('override-model') // opts.model wins over the decorator
    expect(h.overrides?.cwd).toBe('/repo')
    expect(h.overrides?.plugins).toEqual({ enabled: true })
    expect(h.overrides?.providers).toEqual({ routes: [] })
    expect(h.overrides?.agents).toHaveProperty('helper')
    expect(h.overrides?.budgetTracker).toBeDefined()
    expect(h.overrides?.conversationStorage).toBeDefined()
    expect(h.overrides?.sdkTools).toContain(fakeTool)
  })

  it('test_model_defaults_to_decorator_when_opts_absent', async () => {
    await delegate(SubAgent, 'hi', { apiKey: 'k' })
    expect(h.overrides?.model).toBe('decorator-model')
    expect(h.overrides?.cwd).toBeUndefined()
    expect(h.overrides?.plugins).toBeUndefined()
    expect(h.overrides?.sdkTools).toBeUndefined()
  })

  it('test_forwards_retry_and_custom_reflection_to_loop', async () => {
    const retry = { retries: 2, initialDelayMs: 0 }
    await delegate(SubAgent, 'hi', { apiKey: 'k', retry, reflection: customReflection })
    expect(h.loopConfig?.retry).toEqual(retry)
    expect(h.loopConfig?.reflection).toBe(customReflection)
  })

  it('test_reflection_defaults_to_ladder_for_plan_act_reflect', async () => {
    await delegate(SubAgent, 'hi', { apiKey: 'k' })
    expect((h.loopConfig?.reflection as { name: string }).name).toBe('ladder')
    expect(h.loopConfig?.retry).toBeUndefined()
  })
})
