/**
 * #1960 — the plumbing a durable approval needs from this package: `hitl.onDefer` reaches the HITL
 * plugin the SDK is given, and `toolDecisions` reaches `agent.send` on the real adapter path.
 * Only `@theokit/sdk` is mocked.
 */
import 'reflect-metadata'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  send: undefined as Record<string, unknown> | undefined,
  create: undefined as Record<string, unknown> | undefined,
}))

vi.mock('@theokit/sdk', () => ({
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: vi.fn(async (_id: string, opts: Record<string, unknown>) => {
      h.create = opts
      return {
        agentId: _id,
        send: async (_msg: unknown, sendOpts?: Record<string, unknown>) => {
          h.send = sendOpts
          return {
            events: async function* () {
              yield { kind: 'message', message: { type: 'status', status: 'FINISHED' } }
            },
            wait: async () => ({}),
          }
        },
        dispose: async () => {},
      }
    }),
  },
}))

const { streamAgentUIMessages } = await import('../../src/bridge/agent-endpoint.js')
const { defineAgent, compileAgentDefinition } = await import('../../src/bridge/define-agent.js')

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of stream) {
    // consume
  }
}

describe('#1960 deferral plumbing reaches the SDK', () => {
  beforeEach(() => {
    h.send = undefined
    h.create = undefined
  })

  it('tool_decisions_reach_agent_send', async () => {
    const compiled = compileAgentDefinition(defineAgent({ model: 'm' }))
    const toolDecisions = [{ toolUseId: 'tu-1', behavior: 'deny' as const, message: 'no' }]
    await drain(
      streamAgentUIMessages(compiled, 'k', { message: '', sessionId: 's1', toolDecisions }),
    )
    expect(h.send).toMatchObject({ toolDecisions })
  })

  it('no_tool_decisions_means_none_on_send', async () => {
    const compiled = compileAgentDefinition(defineAgent({ model: 'm' }))
    await drain(streamAgentUIMessages(compiled, 'k', { message: 'hi', sessionId: 's2' }))
    expect(h.send).not.toHaveProperty('toolDecisions')
  })

  it('on_defer_reaches_the_hitl_plugin_the_sdk_is_given', async () => {
    const compiled = compileAgentDefinition(
      defineAgent({
        model: 'm',
        tools: [
          { name: 'deploy', description: 'd', inputSchema: {}, execute: async () => '' },
        ] as never,
        approvals: { deploy: { question: 'Deploy?' } },
      }),
    )
    const onDefer = vi.fn(async () => {})
    await drain(
      streamAgentUIMessages(compiled, 'k', {
        message: 'go',
        sessionId: 's3',
        hitl: { gated: compiled.hitl!, awaitApproval: vi.fn(), onDefer },
      }),
    )
    const plugin = (h.create?.plugins as { register: (c: unknown) => void }[]).find(
      (p) => (p as { name?: string }).name === 'theokit-hitl',
    )
    let handler: ((c: unknown) => Promise<unknown>) | undefined
    plugin?.register({ on: (_n: string, fn: typeof handler) => (handler = fn) })
    const out = await handler?.({
      name: 'deploy',
      args: {},
      agentId: 'a',
      runId: 'r',
      toolUseId: 'tu',
    })
    expect(out).toEqual({ defer: true })
    expect(onDefer).toHaveBeenCalledOnce()
  })
})
