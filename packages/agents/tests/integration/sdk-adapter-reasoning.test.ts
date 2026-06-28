/**
 * M1 (reasoning-visibility) — T2.1: `reasoningEffort` reaches the SDK as `ModelSelection.params`.
 *
 * `reasoningEffort` is an Axis-A SWAP override (parallel to V4-L.2 `model`/`cwd`): merge-over-compiled
 * (`opts.reasoningEffort ?? compiled.reasoningEffort`), resolved at the single `getOrCreate` site in
 * `sdk-adapter.ts`, mapped via `buildModelSelection`. This file reuses the `@theokit/sdk` capture-mock
 * harness from `runtime-overrides.test.ts` (the streaming test's mock is fixed and does not capture
 * `getOrCreate` opts, so a capture mock is the right harness for asserting the wire shape).
 */
import 'reflect-metadata'
import { describe, expect, it, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  captured: null as Record<string, unknown> | null,
  round: 0,
}))

vi.mock('@theokit/sdk', () => ({
  InMemoryConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  Agent: {
    getOrCreate: vi.fn(async (_id: string, opts: Record<string, unknown>) => {
      h.captured = opts
      return {
        send: async () => ({
          stream: async function* () {
            const i = h.round++
            yield {
              type: 'assistant',
              message: { content: [{ type: 'text', text: `round-${i}` }] },
            }
            yield { type: 'status', status: 'FINISHED' }
          },
          wait: async () => ({}),
        }),
        dispose: async () => {},
      }
    }),
  },
  defineTool: (s: unknown) => s,
}))

const { AgentRunner } = await import('../../src/index.js')
const { Agent } = await import('../../src/decorators/agent.js')
const { MainLoop } = await import('../../src/decorators/main-loop.js')

@Agent({ name: 'thinker', route: '/thinker', model: 'compiled-model', reasoningEffort: 'high' })
class ThinkerAgent {
  @MainLoop({ strategy: 'simple-chat' })
  async run() {}
}

@Agent({ name: 'plain', route: '/plain', model: 'compiled-model' })
class PlainAgent {
  @MainLoop({ strategy: 'simple-chat' })
  async run() {}
}

describe('M1 reasoningEffort → Agent.getOrCreate model params', () => {
  beforeEach(() => {
    h.captured = null
    h.round = 0
  })

  it('test_createSdkAgentStream_forwards_reasoningEffort_to_getOrCreate', async () => {
    // compiled @Agent({ reasoningEffort: 'high' }) ⇒ getOrCreate opts.model carries the thinking param.
    await AgentRunner.builder(ThinkerAgent).build().run('hi', { apiKey: 'k' })
    expect(h.captured?.model).toEqual({
      id: 'compiled-model',
      params: [{ id: 'thinking', value: 'high' }],
    })
  })

  it('test_run_override_reasoningEffort_beats_compiled', async () => {
    // overrides.reasoningEffort ('low') wins over the compiled 'high' (merge-over-compiled).
    await AgentRunner.builder(ThinkerAgent)
      .build()
      .run('hi', { apiKey: 'k', reasoningEffort: 'low' })
    expect(h.captured?.model).toEqual({
      id: 'compiled-model',
      params: [{ id: 'thinking', value: 'low' }],
    })
  })

  it('test_no_reasoningEffort_passes_bare_model_id', async () => {
    // No compiled effort, no override ⇒ bare { id } (backward-compat, no params key).
    await AgentRunner.builder(PlainAgent).build().run('hi', { apiKey: 'k' })
    expect(h.captured?.model).toEqual({ id: 'compiled-model' })
  })

  it('test_run_override_reasoningEffort_on_plain_agent', async () => {
    // EC: a per-run override enables reasoning even when the agent declared none at compile time.
    await AgentRunner.builder(PlainAgent)
      .build()
      .run('hi', { apiKey: 'k', reasoningEffort: 'medium' })
    expect(h.captured?.model).toEqual({
      id: 'compiled-model',
      params: [{ id: 'thinking', value: 'medium' }],
    })
  })
})
