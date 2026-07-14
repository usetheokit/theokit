/**
 * Conversation storage / agent memory — `defineAgent({ conversationStorage })` + `.conversationStorage()`.
 *
 * BDD: Given an agent definition that declares a conversation-storage adapter, When the agent runs,
 * Then that adapter is the one handed to the SDK (`Agent.getOrCreate({ conversationStorage })`) — so an
 * app controls WHERE the agent's memory lives (swap in-memory ⇄ filesystem ⇄ custom) without touching
 * the runtime. A per-run override still wins over the agent-level default; absent ⇒ the SDK default is
 * chosen lazily (byte-identical to the pre-feature behaviour).
 *
 * Exercises the REAL `createSdkAgentStream` wiring; only `@theokit/sdk` is mocked so the mock's
 * `getOrCreate` can capture the `conversationStorage` opt it receives.
 */
import 'reflect-metadata'
import { describe, expect, it, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** The `conversationStorage` adapter `Agent.getOrCreate` was called with. */
  storage: undefined as unknown,
}))

vi.mock('@theokit/sdk', () => ({
  InMemoryConversationStorage: class InMemoryConversationStorage {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  FileSystemConversationStorage: class FileSystemConversationStorage {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: vi.fn(async (_id: string, opts: { conversationStorage?: unknown }) => {
      h.storage = opts.conversationStorage
      return {
        send: async () => ({
          stream: async function* () {
            yield { type: 'status', status: 'FINISHED' }
          },
          wait: async () => ({}),
        }),
        dispose: async () => {},
      }
    }),
  },
}))

const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')
const { defineAgent, compileAgentDefinition } = await import('../../src/bridge/define-agent.js')
const { agent } = await import('../../src/bridge/agent-builder.js')

/** A minimal conversation-storage adapter — identity by reference is all the assertions need. */
function makeStore(tag: string) {
  return {
    tag,
    getMessages: async () => [],
    appendMessage: async () => {},
    deleteConversation: async () => {},
  }
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of stream) {
    // consume
  }
}

describe('conversation storage flows from the agent definition to the SDK', () => {
  beforeEach(() => {
    h.storage = undefined
  })

  it('test_defineAgent_conversationStorage_reaches_getOrCreate', async () => {
    const store = makeStore('app-store')
    const def = defineAgent({ model: 'openai/gpt-4o-mini', conversationStorage: store })
    const compiled = compileAgentDefinition(def)

    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
    await drain(factory('go', 'sess-1'))

    expect(h.storage).toBe(store)
  })

  it('test_builder_conversationStorage_reaches_getOrCreate', async () => {
    const store = makeStore('builder-store')
    const def = agent().model('openai/gpt-4o-mini').conversationStorage(store).build()
    const compiled = compileAgentDefinition(def)

    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
    await drain(factory('go', 'sess-2'))

    expect(h.storage).toBe(store)
  })

  it('test_per_run_override_wins_over_agent_level_storage', async () => {
    const agentStore = makeStore('agent-level')
    const runStore = makeStore('per-run')
    const def = defineAgent({ model: 'openai/gpt-4o-mini', conversationStorage: agentStore })
    const compiled = compileAgentDefinition(def)

    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key', {
      conversationStorage: runStore,
    })
    await drain(factory('go', 'sess-3'))

    expect(h.storage).toBe(runStore)
  })

  it('test_absent_storage_falls_back_to_sdk_default', async () => {
    // Regression guard: no declared storage ⇒ the adapter picks the SDK's default lazily
    // (an InMemoryConversationStorage instance), never undefined.
    const def = defineAgent({ model: 'openai/gpt-4o-mini' })
    const compiled = compileAgentDefinition(def)

    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
    await drain(factory('go', 'sess-4'))

    expect(h.storage).toBeDefined()
    expect((h.storage as { constructor: { name: string } }).constructor.name).toBe(
      'InMemoryConversationStorage',
    )
  })
})
