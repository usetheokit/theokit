/**
 * theokit#58 — `recoverLeakedToolCalls` wiring: when opted in, `createSdkAgentStream` clones the
 * per-run `providers.routes` with the SDK's `extractToolCallsFromContent` enabled, so a leaked Hermes
 * `<function=…></tool_call>` dialect is RECOVERED and EXECUTED by the loop (unlike `stripToolDialect`,
 * which only hides it from the visible text). Off by default ⇒ routes pass through untouched.
 *
 * Asserts the wiring at the boundary: the `providers` object handed to `Agent.getOrCreate`.
 */
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'

import type { ProviderRoutingSettings } from '@theokit/sdk'

const getOrCreateMock = vi.hoisted(() => vi.fn())

vi.mock('@theokit/sdk', () => ({
  InMemoryConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  Agent: {
    getOrCreate: getOrCreateMock.mockImplementation(async () => ({
      send: async (_msg: string, opts?: { onDelta?: (d: { update: unknown }) => void }) => {
        opts?.onDelta?.({ update: { type: 'text-delta', text: 'ok' } })
        return {
          stream: async function* () {
            yield { type: 'status', status: 'FINISHED' }
          },
          wait: async () => ({}),
        }
      },
      dispose: async () => {},
    })),
  },
  Tool: { create: (s: unknown) => s },
}))

const { AgentRunner } = await import('../../src/index.js')
const { compileAgent } = await import('../../src/bridge/agent-compiler.js')
const { walkAgentMetadata } = await import('../../src/bridge/walk-agent-metadata.js')
const { Agent } = await import('../../src/decorators/agent.js')
const { MainLoop } = await import('../../src/decorators/main-loop.js')

@Agent({ name: 'rec-on', route: '/rec-on', model: 'm', recoverLeakedToolCalls: true })
class RecoverAgent {
  @MainLoop({ strategy: 'simple-chat' })
  async run() {}
}

@Agent({ name: 'rec-off', route: '/rec-off', model: 'm' })
class PlainAgent {
  @MainLoop({ strategy: 'simple-chat' })
  async run() {}
}

const PROVIDERS = {
  routes: [{ capability: 'chat', provider: 'openrouter' }],
} as unknown as ProviderRoutingSettings

async function createOptsFor(
  AgentClass: Parameters<typeof AgentRunner.builder>[0],
  opts: Record<string, unknown> = {},
): Promise<{ providers?: { routes: Array<{ extractToolCallsFromContent?: boolean }> } }> {
  getOrCreateMock.mockClear()
  const gen = AgentRunner.builder(AgentClass)
    .build()
    .stream('hi', { apiKey: 'k', providers: PROVIDERS, ...opts })
  for await (const _e of gen) {
    /* drain */
  }
  return getOrCreateMock.mock.calls[0]?.[1]
}

describe('theokit#58 recoverLeakedToolCalls wiring', () => {
  it('test_agent_config_recoverLeakedToolCalls_compiles', () => {
    expect(compileAgent(walkAgentMetadata(RecoverAgent)).recoverLeakedToolCalls).toBe(true)
    expect(compileAgent(walkAgentMetadata(PlainAgent)).recoverLeakedToolCalls).toBeUndefined()
  })

  it('test_enables_extractToolCallsFromContent_on_route_when_opted_in', async () => {
    const createOpts = await createOptsFor(RecoverAgent)
    expect(createOpts.providers?.routes[0]?.extractToolCallsFromContent).toBe(true)
  })

  it('test_routes_untouched_when_disabled_default', async () => {
    const createOpts = await createOptsFor(PlainAgent)
    // backward-compat: the route is forwarded unchanged (no recovery flag injected).
    expect(createOpts.providers?.routes[0]?.extractToolCallsFromContent).toBeUndefined()
  })

  it('test_run_override_recoverLeakedToolCalls_beats_compiled', async () => {
    // compiled false (PlainAgent) + per-run override true ⇒ the route gets the recovery flag.
    const createOpts = await createOptsFor(PlainAgent, { recoverLeakedToolCalls: true })
    expect(createOpts.providers?.routes[0]?.extractToolCallsFromContent).toBe(true)
  })
})
