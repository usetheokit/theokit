/**
 * Both served paths, through the bridge's public boundary (`bridge/index`), with only `@theokit/sdk`
 * mocked: `toAgentFactory` keeps the SDK message vocabulary the ACP server dispatches on, and
 * `toTypedAgentFactory` yields `AgentStreamEvent`s from the same run.
 */
import 'reflect-metadata'

import { describe, expect, it, vi } from 'vitest'

import type { ApprovalPosture } from '../../src/bridge/approval-posture.js'

const RUN_MESSAGES = [
  {
    type: 'assistant',
    agent_id: 'a',
    run_id: 'r1',
    message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
  },
  { type: 'status', agent_id: 'a', run_id: 'r1', status: 'FINISHED' },
]

vi.mock('@theokit/sdk', () => ({
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: vi.fn((id: string) =>
      Promise.resolve({
        agentId: id,
        send: () =>
          Promise.resolve({
            wait: () => Promise.resolve({ result: 'hello', status: 'finished' }),
            stream: async function* () {
              await Promise.resolve()
              yield* RUN_MESSAGES
            },
          }),
        dispose: () => Promise.resolve(),
      }),
    ),
  },
}))

const { toAgentFactory, toTypedAgentFactory } = await import('../../src/bridge/index.js')
const { defineAgent } = await import('../../src/bridge/define-agent.js')

const POSTURE: ApprovalPosture = { kind: 'auto-reject', reason: 'no tools run here' }
const OPTS = { apiKey: 'k', approvals: POSTURE }

describe('a served agent handle', () => {
  it('toAgentFactory streams SDK messages untouched (what ACP reads)', async () => {
    const handle = await toAgentFactory(defineAgent({ model: 'm' }), OPTS)('s1')
    const turn = await handle.send('hi')
    const seen: unknown[] = []
    for await (const m of turn.stream?.() ?? []) seen.push(m)
    expect(seen).toEqual(RUN_MESSAGES)
  })

  it('toTypedAgentFactory streams AgentStreamEvents from the same run', async () => {
    const handle = await toTypedAgentFactory(defineAgent({ model: 'm' }), OPTS)('s2')
    const turn = await handle.send('hi')
    const seen: unknown[] = []
    for await (const e of turn.stream?.() ?? []) seen.push(e)
    expect(seen).toEqual([
      { type: 'text_delta', content: 'hello' },
      {
        type: 'done',
        result: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: 0,
      },
    ])
    expect(await turn.wait()).toEqual({ result: 'hello', status: 'finished' })
  })
})
