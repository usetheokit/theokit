/**
 * V4-N.1 — `createSdkAgentStream` emits the SDK Run's REAL token usage on the `done` event
 * (read via `run.wait()`), suppressing the stream's zero-usage `done`. An error round skips
 * the `wait()` re-emit; a `wait()` rejection surfaces as an `error` (fail-loud).
 */
import 'reflect-metadata'
import { describe, expect, it, beforeEach, vi } from 'vitest'

import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'

const h = vi.hoisted(() => ({
  usage: { inputTokens: 12, outputTokens: 7 } as { inputTokens?: number; outputTokens?: number },
  streamMsgs: [] as { type: string; [k: string]: unknown }[],
  waitCalls: 0,
  waitReject: false,
  disposeCalls: 0,
}))

vi.mock('@theokit/sdk', () => ({
  InMemoryConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  Agent: {
    getOrCreate: vi.fn(async () => ({
      send: async () => ({
        stream: async function* () {
          for (const m of h.streamMsgs) yield m
        },
        wait: async () => {
          h.waitCalls++
          if (h.waitReject) throw new Error('wait-boom')
          return { usage: h.usage, result: '' }
        },
      }),
      dispose: async () => {
        h.disposeCalls++
      },
    })),
  },
  defineTool: (s: unknown) => s,
}))

const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')
const { AgentRunner } = await import('../../src/index.js')
const { Agent } = await import('../../src/decorators/agent.js')
const { MainLoop } = await import('../../src/decorators/main-loop.js')

@Agent({ name: 'usage', route: '/usage', model: 'm' })
class UsageAgent {
  @MainLoop({ strategy: 'simple-chat' })
  async run() {}
}

async function drain(): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of createSdkAgentStream(
    { tools: [], agents: {}, stream: true } as never,
    [],
    'k',
  )('hi', 's')) {
    out.push(e)
  }
  return out
}

describe('V4-N.1 adapter emits real SDK usage', () => {
  beforeEach(() => {
    h.usage = { inputTokens: 12, outputTokens: 7 }
    h.streamMsgs = []
    h.waitCalls = 0
    h.waitReject = false
    h.disposeCalls = 0
  })

  it('test_done_carries_real_usage_from_wait', async () => {
    const events = await drain()
    const done = events.find((e) => e.type === 'done')
    expect(done?.usage).toEqual({ inputTokens: 12, outputTokens: 7, totalTokens: 19 })
  })

  it('test_delegationresult_reports_real_split_usage', async () => {
    const result = await AgentRunner.builder(UsageAgent).build().run('hi', { apiKey: 'k' })
    expect(result.tokensInput).toBe(12)
    expect(result.tokensOutput).toBe(7)
    expect(result.tokens).toBe(19)
  })

  it('test_error_round_skips_wait_and_done', async () => {
    // EC-1: a stream error is the terminal — the adapter must NOT call run.wait() or emit a done.
    h.streamMsgs = [{ type: 'status', status: 'ERROR', message: 'boom' }]
    const events = await drain()
    expect(events.some((e) => e.type === 'error')).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(false)
    expect(h.waitCalls).toBe(0)
  })

  it('test_wait_rejection_surfaces_error', async () => {
    // EC-2: run.wait() rejecting is caught and surfaced as an error event (fail-loud).
    h.waitReject = true
    const events = await drain()
    expect(events.some((e) => e.type === 'error')).toBe(true)
    expect(h.disposeCalls).toBe(1) // LOW-1: dispose runs in finally even on a wait() reject
  })
})
