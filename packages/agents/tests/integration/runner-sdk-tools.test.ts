/**
 * V4-Q — `AgentRunner.stream()` forwards pre-built SDK `CustomTool[]` (`run-options.sdkTools`) RAW to
 * `Agent.create.tools`, bypassing `defineTool` (which requires a Zod schema). Lets an app whose tools
 * come from imperative SDK factories (`@theokit/sdk-tools` → `CustomTool[]`) adopt the loop.
 */
import 'reflect-metadata'
import { describe, expect, it, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({ captured: null as { tools?: unknown[] } | null }))

vi.mock('@theokit/sdk', () => ({
  InMemoryConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  Agent: {
    getOrCreate: vi.fn(async (_id: string, opts: { tools?: unknown[] }) => {
      h.captured = opts
      return {
        send: async () => ({
          stream: async function* () {},
          wait: async () => ({}),
        }),
        dispose: async () => {},
      }
    }),
  },
  // defineTool MARKS its result so the test can prove sdkTools are NOT re-defined.
  defineTool: (s: object) => ({ __defined: true, ...s }),
}))

const { AgentRunner } = await import('../../src/index.js')
const { Agent } = await import('../../src/decorators/agent.js')
const { MainLoop } = await import('../../src/decorators/main-loop.js')

@Agent({ name: 'st', route: '/st', model: 'm' })
class STAgent {
  @MainLoop({ strategy: 'simple-chat' })
  async run() {}
}

describe('V4-Q AgentRunner forwards pre-built sdkTools', () => {
  beforeEach(() => {
    h.captured = null
  })

  it('test_sdktools_forwarded_raw_to_agent_create', async () => {
    const fakeTool = { name: 'x', description: 'd', inputSchema: {}, handler: () => 'ok' }
    await AgentRunner.builder(STAgent)
      .build()
      .run('hi', { apiKey: 'k', sdkTools: [fakeTool] as never })
    // Forwarded BY REFERENCE (not wrapped by the mock defineTool → no `__defined` marker).
    expect(h.captured?.tools).toContain(fakeTool)
    expect((fakeTool as { __defined?: boolean }).__defined).toBeUndefined()
  })

  it('test_absent_sdktools_is_compiled_only', async () => {
    await AgentRunner.builder(STAgent).build().run('hi', { apiKey: 'k' })
    // STAgent has no @Tool → compiled tools empty → no sdkTools appended → empty tools array.
    expect(h.captured?.tools).toEqual([])
  })
})
