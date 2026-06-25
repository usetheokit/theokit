/**
 * V4-L.2 — per-request Axis-A (SWAP) overrides on AgentRunnerRunOptions:
 *  - model       → Agent.create({ model: { id } })  (merge: opts.model ?? compiled.model ?? default)
 *  - cwd         → Agent.create({ local: { cwd } }) (so the SDK populates SystemPromptContext.cwd)
 *  - maxIterations → per-call loop ceiling (re-resolved strategy), terminal 'step_limit'
 * All merge-over-compiled; absent ⇒ build-time defaults (parallel to V4-J `tools`).
 *
 * Mocks @theokit/sdk: Agent.create captures its options (model/cwd/tools) and returns
 * a stream of SDK-native messages per round — a UNIQUE assistant text (so the round
 * signature differs and no_progress never masks the maxIterations ceiling), a completed
 * tool_call (⇒ tool_result ⇒ finishReason 'tool-calls'), and a FINISHED status (⇒ done).
 */
import 'reflect-metadata'
import { describe, expect, it, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  captured: null as Record<string, unknown> | null,
  round: 0,
}))

// The mock yields SDK-NATIVE messages (createSdkAgentStream runs them through
// translateSdkEvent): a unique assistant text per round (so the round signature differs
// and the no_progress detector never masks the maxIterations ceiling), a completed
// tool_call (⇒ tool_result ⇒ finishReason 'tool-calls', the "still working" signal), and
// a FINISHED status (⇒ done).
vi.mock('@theokit/sdk', () => ({
  Agent: {
    create: vi.fn(async (opts: Record<string, unknown>) => {
      h.captured = opts
      return {
        send: async () => ({
          stream: async function* () {
            const i = h.round++
            yield {
              type: 'assistant',
              message: { content: [{ type: 'text', text: `round-${i}` }] },
            }
            yield {
              type: 'tool_call',
              status: 'completed',
              call_id: `c-${i}`,
              name: 't',
              result: 'r',
            }
            yield { type: 'status', status: 'FINISHED' }
          },
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

@Agent({ name: 'simple', route: '/simple', model: 'compiled-model' })
class SimpleAgent {
  @MainLoop({ strategy: 'simple-chat' })
  async run() {}
}

@Agent({ name: 'react', route: '/react', model: 'compiled-model' })
class ReactAgent {
  @MainLoop({ strategy: 'react', maxIterations: 8 })
  async run() {}
}

const FAKE_TOOL = {
  name: 'override_tool',
  description: 'd',
  inputSchema: {},
  handler: async () => 'r',
}

describe('V4-L.2 per-request overrides on AgentRunner', () => {
  beforeEach(() => {
    h.captured = null
    h.round = 0
  })

  it('test_model_override_reaches_agent_create', async () => {
    const runner = AgentRunner.builder(SimpleAgent).build()
    await runner.run('hi', { apiKey: 'k', model: 'anthropic/claude-x' })
    expect((h.captured?.model as { id: string }).id).toBe('anthropic/claude-x')
  })

  it('test_cwd_override_reaches_agent_create_local', async () => {
    const runner = AgentRunner.builder(SimpleAgent).build()
    await runner.run('hi', { apiKey: 'k', cwd: '/proj/root' })
    expect((h.captured?.local as { cwd: string }).cwd).toBe('/proj/root')
  })

  it('test_maxIterations_override_caps_loop_with_step_limit', async () => {
    const runner = AgentRunner.builder(ReactAgent).build()
    const result = await runner.run('go', { apiKey: 'k', maxIterations: 3 })
    expect(result.rounds).toBe(3)
    expect(result.finishReason).toBe('step_limit')
  })

  it('test_no_overrides_uses_compiled_defaults', async () => {
    const runner = AgentRunner.builder(SimpleAgent).build()
    await runner.run('hi', { apiKey: 'k' })
    expect((h.captured?.model as { id: string }).id).toBe('compiled-model') // build-time model
    expect(h.captured?.local).toBeUndefined() // no cwd ⇒ no local key
  })

  it('test_v4j_tools_and_v4l2_overrides_compose', async () => {
    // EC-1: tools (V4-J) + model + cwd + maxIterations all in one call coexist.
    const runner = AgentRunner.builder(ReactAgent).build()
    const result = await runner.run('go', {
      apiKey: 'k',
      tools: [FAKE_TOOL] as never,
      model: 'anthropic/claude-x',
      cwd: '/proj',
      maxIterations: 2,
    })
    expect((h.captured?.model as { id: string }).id).toBe('anthropic/claude-x')
    expect((h.captured?.local as { cwd: string }).cwd).toBe('/proj')
    expect((h.captured?.tools as { name: string }[])[0].name).toBe('override_tool')
    expect(result.rounds).toBe(2)
    expect(result.finishReason).toBe('step_limit')
  })

  it('test_maxIterations_override_noop_on_simple_chat', async () => {
    // EC-2: simple-chat is single-round by definition; a maxIterations override cannot make it loop.
    const runner = AgentRunner.builder(SimpleAgent).build()
    const result = await runner.run('hi', { apiKey: 'k', maxIterations: 5 })
    expect(result.rounds).toBe(1)
  })
})
