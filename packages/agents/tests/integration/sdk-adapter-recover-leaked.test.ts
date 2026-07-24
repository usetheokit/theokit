/**
 * theokit#58 — `recoverLeakedToolCalls` wiring: when opted in, `createSdkAgentStream` clones the
 * per-run `providers.routes` with the SDK's `extractToolCallsFromContent` enabled, so a leaked Hermes
 * `<function=…></tool_call>` dialect is RECOVERED and EXECUTED by the loop (unlike `stripToolDialect`,
 * which only hides it from the visible text). Off by default ⇒ routes pass through untouched.
 *
 * Asserts the wiring at the boundary: the `providers` object handed to `Agent.getOrCreate`.
 */
import 'reflect-metadata'
import type { CompiledAgentOptions } from '../../src/bridge/agent-compiler.js'
import { describe, expect, it, vi } from 'vitest'

import type { ProviderRoutingSettings } from '@theokit/sdk'

const getOrCreateMock = vi.hoisted(() => vi.fn())

vi.mock('@theokit/sdk', () => ({
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
const { applyCapabilities } = await import('../../src/capability/capability.js')
const { ModelCapability } = await import('../../src/capability/capabilities.js')
const { AgentConfigCapability } = await import('../../src/capability/agent-capabilities.js')

const recoverAgent = applyCapabilities([
  new ModelCapability('m'),
  new AgentConfigCapability({ recoverLeakedToolCalls: true }),
])

const plainAgent = applyCapabilities([new ModelCapability('m')])

const PROVIDERS = {
  routes: [{ capability: 'chat', provider: 'openrouter' }],
} as unknown as ProviderRoutingSettings

async function createOptsFor(
  compiled: CompiledAgentOptions,
  opts: Record<string, unknown> = {},
): Promise<{ providers?: { routes: Array<{ extractToolCallsFromContent?: boolean }> } }> {
  getOrCreateMock.mockClear()
  const gen = AgentRunner.fromSpec({ compiled, name: 'a', strategy: 'simple-chat' })
    .build()
    .stream('hi', { apiKey: 'k', providers: PROVIDERS, ...opts })
  for await (const _e of gen) {
    /* drain */
  }
  return getOrCreateMock.mock.calls[0]?.[1]
}

describe('theokit#58 recoverLeakedToolCalls wiring', () => {
  it('test_agent_config_recoverLeakedToolCalls_compiles', () => {
    expect(recoverAgent.recoverLeakedToolCalls).toBe(true)
    expect(plainAgent.recoverLeakedToolCalls).toBeUndefined()
  })

  it('test_enables_extractToolCallsFromContent_on_route_when_opted_in', async () => {
    const createOpts = await createOptsFor(recoverAgent)
    expect(createOpts.providers?.routes[0]?.extractToolCallsFromContent).toBe(true)
  })

  it('test_routes_untouched_when_disabled_default', async () => {
    const createOpts = await createOptsFor(plainAgent)
    // backward-compat: the route is forwarded unchanged (no recovery flag injected).
    expect(createOpts.providers?.routes[0]?.extractToolCallsFromContent).toBeUndefined()
  })

  it('test_run_override_recoverLeakedToolCalls_beats_compiled', async () => {
    // compiled false (plainAgent) + per-run override true ⇒ the route gets the recovery flag.
    const createOpts = await createOptsFor(plainAgent, { recoverLeakedToolCalls: true })
    expect(createOpts.providers?.routes[0]?.extractToolCallsFromContent).toBe(true)
  })
})
