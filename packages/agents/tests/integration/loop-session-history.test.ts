/**
 * V4-M — the reflective loop's rounds share a persisted SDK session so round N+1 sees
 * rounds 1..N. createSdkAgentStream calls `Agent.getOrCreate(sessionId, { conversationStorage })`
 * each round with ONE shared store (default InMemoryConversationStorage, overridable), and
 * buildPrompt sends the original message on round 1 / a continuation on rounds 2+.
 *
 * The mock yields SDK-native messages (a unique assistant text per round so no_progress never
 * masks the maxIterations ceiling) + a completed tool_call (⇒ continue) + a FINISHED status.
 */
import 'reflect-metadata'
import { describe, expect, it, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as { id: string; storage: unknown }[],
  sends: [] as string[],
  round: 0,
  inMemCount: 0,
}))

vi.mock('@theokit/sdk', () => {
  class InMemoryConversationStorage {
    getMessages = async () => []
    appendMessage = async () => {}
    constructor() {
      h.inMemCount += 1
    }
  }
  return {
    InMemoryConversationStorage,
    Agent: {
      getOrCreate: vi.fn(async (id: string, opts: Record<string, unknown>) => {
        h.calls.push({ id, storage: opts.conversationStorage })
        return {
          send: async (msg: string) => {
            h.sends.push(msg)
            return {
              stream: async function* () {
                const i = h.round++
                yield {
                  type: 'assistant',
                  message: { content: [{ type: 'text', text: `r-${i}` }] },
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
            }
          },
          dispose: async () => {},
        }
      }),
    },
    defineTool: (s: unknown) => s,
  }
})

const { AgentRunner } = await import('../../src/index.js')
const { Agent } = await import('../../src/decorators/agent.js')
const { MainLoop } = await import('../../src/decorators/main-loop.js')

@Agent({ name: 'sess', route: '/sess', model: 'compiled-model' })
class SessAgent {
  @MainLoop({ strategy: 'react', maxIterations: 8 })
  async run() {}
}

describe('V4-M reflective-loop session history', () => {
  beforeEach(() => {
    h.calls = []
    h.sends = []
    h.round = 0
    h.inMemCount = 0
  })

  it('test_each_round_getOrCreate_same_session_and_shared_storage', async () => {
    const result = await AgentRunner.builder(SessAgent)
      .build()
      .run('the-task', { apiKey: 'k', maxIterations: 2 })
    expect(result.rounds).toBe(2)
    expect(h.calls).toHaveLength(2)
    // same agentId (sessionId) every round
    expect(h.calls[0].id).toBe(h.calls[1].id)
    // SAME shared conversationStorage reference across rounds (survives per-round dispose)
    expect(h.calls[0].storage).toBe(h.calls[1].storage)
    expect(h.calls[0].storage).toBeDefined()
  })

  it('test_round1_sends_original_round2_sends_continuation', async () => {
    await AgentRunner.builder(SessAgent).build().run('the-task', { apiKey: 'k', maxIterations: 2 })
    expect(h.sends).toHaveLength(2)
    expect(h.sends[0]).toContain('the-task') // round 1 = original message
    expect(h.sends[1]).not.toContain('the-task') // round 2 = continuation, NOT the original
  })

  it('test_default_storage_is_in_memory_created_once', async () => {
    await AgentRunner.builder(SessAgent).build().run('the-task', { apiKey: 'k', maxIterations: 2 })
    expect(h.inMemCount).toBe(1) // ONE shared store created per run (not per round)
  })

  it('test_conversationStorage_override_is_used', async () => {
    const sentinel = { getMessages: async () => [], appendMessage: async () => {} }
    await AgentRunner.builder(SessAgent)
      .build()
      .run('the-task', { apiKey: 'k', maxIterations: 2, conversationStorage: sentinel as never })
    expect(h.calls[0].storage).toBe(sentinel) // override honored verbatim
    expect(h.calls[1].storage).toBe(sentinel)
    expect(h.inMemCount).toBe(0) // default never allocated when overridden
  })
})
