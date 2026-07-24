/**
 * V4-M — the reflective loop's rounds share ONE persisted SDK session so round N+1 sees rounds 1..N.
 * `createSdkAgentStream` calls `Agent.getOrCreate(sessionId)` each round with the SAME `sessionId`
 * (the SDK persists history natively — SDK 4.0/SE40 — no theokit-side store), and `buildPrompt` sends
 * the original message on round 1 / a continuation on rounds 2+.
 *
 * The mock yields SDK-native messages (a unique assistant text per round so no_progress never masks the
 * maxIterations ceiling) + a completed tool_call (⇒ continue) + a FINISHED status.
 */
import 'reflect-metadata'
import { describe, expect, it, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as { id: string }[],
  sends: [] as string[],
  round: 0,
}))

vi.mock('@theokit/sdk', () => {
  return {
    Agent: {
      getOrCreate: vi.fn(async (id: string) => {
        h.calls.push({ id })
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
              wait: async () => ({}),
            }
          },
          dispose: async () => {},
        }
      }),
    },
    Tool: { create: (s: unknown) => s },
  }
})

const { AgentRunner } = await import('../../src/index.js')
const { applyCapabilities } = await import('../../src/capability/capability.js')
const { ModelCapability } = await import('../../src/capability/capabilities.js')
const { MainLoopCapability } = await import('../../src/capability/agent-capabilities.js')

const sessAgent = applyCapabilities([
  new ModelCapability('compiled-model'),
  new MainLoopCapability({ maxIterations: 8 }),
])

describe('V4-M reflective-loop session history', () => {
  beforeEach(() => {
    h.calls = []
    h.sends = []
    h.round = 0
  })

  it('test_each_round_getOrCreate_uses_the_same_session', async () => {
    const result = await AgentRunner.fromSpec({
      compiled: sessAgent,
      agentName: 'sessAgent',
      strategy: 'react',
    })
      .build()
      .run('the-task', { apiKey: 'k', maxIterations: 2 })
    expect(result.rounds).toBe(2)
    expect(h.calls).toHaveLength(2)
    // SAME agentId (sessionId) every round → the SDK's native transcript accumulates across rounds.
    expect(h.calls[0].id).toBe(h.calls[1].id)
  })

  it('test_round1_sends_original_round2_sends_continuation', async () => {
    await AgentRunner.fromSpec({ compiled: sessAgent, agentName: 'sessAgent', strategy: 'react' })
      .build()
      .run('the-task', { apiKey: 'k', maxIterations: 2 })
    expect(h.sends).toHaveLength(2)
    expect(h.sends[0]).toContain('the-task') // round 1 = original message
    expect(h.sends[1]).not.toContain('the-task') // round 2 = continuation, NOT the original
  })
})
