/**
 * V4-L.2 — per-request Axis-A (SWAP) overrides on AgentRunnerRunOptions:
 *  - model       → Agent.create({ model: { id } })  (merge: opts.model ?? compiled.model ?? default)
 *  - cwd         → Agent.create({ local: { cwd } }) (so the SDK populates SystemPromptContext.cwd)
 *  - maxIterations → per-call loop ceiling (re-resolved strategy), terminal 'step_limit'
 * All merge-over-compiled; absent ⇒ build-time defaults (parallel to V4-J `tools`).
 *
 * Mocks @theokit/sdk: Agent.create captures its options (model/cwd/tools) and returns
 * a stream of SDK-native messages per round — an assistant text plus a completed
 * tool_call with a UNIQUE tool name per round (so the round signature differs and no_progress
 * never masks the maxIterations ceiling; post theokit#53 the signature keys on tool
 * name+input only), a tool_result (⇒ finishReason 'tool-calls'), and a FINISHED status (⇒ done).
 */
import 'reflect-metadata'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type {
  PluginsSettings,
  ProviderRoutingSettings,
  AgentDefinition,
  BudgetTracker,
} from '@theokit/sdk'

const h = vi.hoisted(() => ({
  captured: null as Record<string, unknown> | null,
  round: 0,
}))

// The mock yields SDK-NATIVE messages (createSdkAgentStream runs them through
// translateSdkEvent): an assistant text + a completed tool_call with a UNIQUE tool name per
// round (so the round signature differs and the no_progress detector never masks the
// maxIterations ceiling; post theokit#53 the signature keys on tool name+input only),
// ⇒ finishReason 'tool-calls' (the "still working" signal), and a FINISHED status (⇒ done).
vi.mock('@theokit/sdk', () => ({
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
            yield {
              type: 'tool_call',
              status: 'completed',
              call_id: `c-${i}`,
              // UNIQUE tool name per round so the no_progress signature differs (genuine progress —
              // a different action each round) → the loop legitimately reaches the maxIterations
              // ceiling (step_limit). Post theokit#53 the round signature keys on tool name+input
              // ONLY (not narration), so varying the assistant text is no longer enough to simulate
              // progress. (A completed SDKToolUseMessage maps to a tool_result whose toolName feeds
              // the signature; input is correlated only from a preceding running tool_call.)
              name: `t-${i}`,
              result: 'r',
            }
            yield { type: 'status', status: 'FINISHED' }
          },
          wait: async () => ({}),
        }),
        dispose: async () => {},
      }
    }),
  },
  Tool: { create: (s: unknown) => s },
}))

const { AgentRunner } = await import('../../src/index.js')
const { Agent } = await import('../../src/decorators/agent.js')
const { MainLoop } = await import('../../src/decorators/main-loop.js')
const { Skills } = await import('../../src/decorators/skills.js')

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

@Agent({ name: 'skilled', route: '/skilled', model: 'compiled-model' })
@Skills(['code-review'])
class SkilledAgent {
  @MainLoop({ strategy: 'simple-chat' })
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

  it('test_baseDir_override_reaches_agent_create_local', async () => {
    // SDK 4.0 (SE40): the per-run root of the native `.jsonl` session transcript is threaded into
    // `Agent.create({ local: { baseDir } })`, so the SDK persists (and resumes) sessions under it.
    const runner = AgentRunner.builder(SimpleAgent).build()
    await runner.run('hi', { apiKey: 'k', baseDir: '/app/.data/agent-sessions' })
    expect((h.captured?.local as { baseDir: string }).baseDir).toBe('/app/.data/agent-sessions')
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

  it('test_cwd_override_preserves_skills_settingSources_in_local', async () => {
    // Review M1: a skills agent sets local.settingSources; a cwd override must MERGE
    // (both present), never clobber. Guards `m8.local = { ...m8.local, cwd }`.
    const runner = AgentRunner.builder(SkilledAgent).build()
    await runner.run('hi', { apiKey: 'k', cwd: '/proj' })
    const local = h.captured?.local as { settingSources?: string[]; cwd?: string }
    expect(local.cwd).toBe('/proj')
    expect(local.settingSources).toEqual(['project'])
  })
})

// V4-L.3 — the remaining per-request Agent.create surface: plugins / providers / agents /
// budgetTracker. Each is a flat AgentRunnerRunOptions field forwarded (when present) to
// Agent.create; absent ⇒ no key. Reuses the same @theokit/sdk capture mock above.
const PLUGINS = [{ name: 'perm' }] as unknown as PluginsSettings
const PROVIDERS = {
  routes: [{ capability: 'chat', provider: 'openrouter' }],
} as unknown as ProviderRoutingSettings
const AGENTS = { helper: { description: 'd', prompt: 'p' } } as unknown as Record<
  string,
  AgentDefinition
>
const TRACKER = { onStep: () => {} } as unknown as BudgetTracker

describe('V4-L.3 per-request Agent.create surface on AgentRunner', () => {
  beforeEach(() => {
    h.captured = null
    h.round = 0
  })

  it('test_plugins_override_reaches_agent_create', async () => {
    await AgentRunner.builder(SimpleAgent).build().run('hi', { apiKey: 'k', plugins: PLUGINS })
    expect(h.captured?.plugins).toBe(PLUGINS)
  })

  it('test_providers_override_reaches_agent_create', async () => {
    await AgentRunner.builder(SimpleAgent).build().run('hi', { apiKey: 'k', providers: PROVIDERS })
    expect(h.captured?.providers).toBe(PROVIDERS)
  })

  it('test_agents_override_reaches_agent_create', async () => {
    await AgentRunner.builder(SimpleAgent).build().run('hi', { apiKey: 'k', agents: AGENTS })
    expect(h.captured?.agents).toBe(AGENTS)
  })

  it('test_budgetTracker_override_reaches_agent_create', async () => {
    await AgentRunner.builder(SimpleAgent)
      .build()
      .run('hi', { apiKey: 'k', budgetTracker: TRACKER })
    expect(h.captured?.budgetTracker).toBe(TRACKER)
  })

  it('test_v4l3_compose_all_reach_agent_create', async () => {
    await AgentRunner.builder(SimpleAgent).build().run('hi', {
      apiKey: 'k',
      model: 'anthropic/claude-x',
      cwd: '/proj',
      plugins: PLUGINS,
      providers: PROVIDERS,
      agents: AGENTS,
      budgetTracker: TRACKER,
    })
    expect((h.captured?.model as { id: string }).id).toBe('anthropic/claude-x')
    expect((h.captured?.local as { cwd: string }).cwd).toBe('/proj')
    expect(h.captured?.plugins).toBe(PLUGINS)
    expect(h.captured?.providers).toBe(PROVIDERS)
    expect(h.captured?.agents).toBe(AGENTS)
    expect(h.captured?.budgetTracker).toBe(TRACKER)
  })

  it('test_no_v4l3_overrides_omits_keys', async () => {
    await AgentRunner.builder(SimpleAgent).build().run('hi', { apiKey: 'k' })
    expect(h.captured?.plugins).toBeUndefined()
    expect(h.captured?.providers).toBeUndefined()
    expect(h.captured?.agents).toBeUndefined()
    expect(h.captured?.budgetTracker).toBeUndefined()
  })

  it('test_budget_and_budgetTracker_coexist', async () => {
    // EC-1: outer-loop `budget` (USD) and inner-SDK `budgetTracker` are different layers.
    const result = await AgentRunner.builder(SimpleAgent)
      .build()
      .run('hi', { apiKey: 'k', budget: 10, budgetTracker: TRACKER })
    expect(h.captured?.budgetTracker).toBe(TRACKER) // inner cap reaches Agent.create
    expect(result.rounds).toBe(1) // outer budget (10 USD) not exceeded at zero cost
  })

  it('test_empty_plugins_array_is_forwarded', async () => {
    // EC-2: `plugins: []` is a deliberate "no plugins" — guarded by `!== undefined`, not truthiness.
    const empty = [] as unknown as PluginsSettings
    await AgentRunner.builder(SimpleAgent).build().run('hi', { apiKey: 'k', plugins: empty })
    expect(h.captured?.plugins).toEqual([])
  })
})
