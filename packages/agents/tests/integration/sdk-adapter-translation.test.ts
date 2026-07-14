/**
 * NF-1 end-to-end — createSdkAgentStream drives the REAL translateSdkEvent over a
 * mocked @theokit/sdk `Run.stream()` that yields genuine `SDKMessage` shapes
 * (verified against theokit-sdk/packages/sdk/src/types/messages.ts).
 *
 * Closes the H1 residual gap the re-review flagged: every other test mocks
 * createSdkAgentStream wholesale, so the translator↔adapter seam was never
 * exercised against the real message union. This test scripts the exact shapes
 * `Run.stream()` emits and asserts the translated AgentStreamEvent output — so a
 * future SDK shape drift (e.g. content moving off `msg.message.content`) FAILS here
 * instead of silently returning empty responses against a live SDK.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

interface SdkMsg {
  type: string
  [k: string]: unknown
}

const h = vi.hoisted(() => ({ messages: [] as SdkMsg[] }))

vi.mock('@theokit/sdk', () => ({
  InMemoryConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  Agent: {
    getOrCreate: () =>
      Promise.resolve({
        send: () =>
          Promise.resolve({
            stream: async function* () {
              for (const m of h.messages) yield m
            },
            wait: async () => ({}),
          }),
        dispose: () => Promise.resolve(),
      }),
  },
  Tool: { create: (spec: unknown) => spec },
}))

const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')
const { compileAgent } = await import('../../src/bridge/agent-compiler.js')
const { walkAgentMetadata } = await import('../../src/bridge/walk-agent-metadata.js')
await import('reflect-metadata')
const { Agent } = await import('../../src/decorators/agent.js')
const { MainLoop } = await import('../../src/decorators/main-loop.js')

@Agent({ name: 'tr', route: '/tr' })
class TrAgent {
  @MainLoop()
  async run() {}
}

async function drain(messages: SdkMsg[]) {
  h.messages = messages
  const compiled = compileAgent(walkAgentMetadata(TrAgent))
  const factory = createSdkAgentStream(compiled, [], 'test-key', { model: 'openai/gpt-4o-mini' })
  const out: { type: string; [k: string]: unknown }[] = []
  for await (const ev of factory('hi', 's1')) out.push(ev)
  return out
}

afterEach(() => {
  h.messages = []
})

describe('createSdkAgentStream × real SDKMessage shapes (NF-1 end-to-end)', () => {
  it('test_assistant_answer_text_surfaces — msg.message.content reaches text_delta (was empty pre-NF-1)', async () => {
    const out = await drain([
      {
        type: 'assistant',
        agent_id: 'a',
        run_id: 'r',
        message: { role: 'assistant', content: [{ type: 'text', text: 'the answer' }] },
      },
      { type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' },
    ])
    expect(out.filter((e) => e.type === 'text_delta')).toEqual([
      { type: 'text_delta', content: 'the answer' },
    ])
  })

  it('test_tool_using_turn_emits_tool_result_then_single_done — B1 shape over the real translator', async () => {
    const out = await drain([
      {
        type: 'tool_call',
        agent_id: 'a',
        run_id: 'r',
        call_id: 'c1',
        name: 'read',
        status: 'completed',
        result: 'ok',
      },
      {
        type: 'assistant',
        agent_id: 'a',
        run_id: 'r',
        message: { role: 'assistant', content: [{ type: 'text', text: 'done reading' }] },
      },
      { type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' },
    ])
    const toolResults = out.filter((e) => e.type === 'tool_result')
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0]).toMatchObject({ callId: 'c1', output: 'ok', isError: false })
    // exactly ONE terminal — the adapter fallback must not double-emit after FINISHED→done
    expect(out.filter((e) => e.type === 'done' || e.type === 'error')).toHaveLength(1)
    expect(out.at(-1)).toMatchObject({ type: 'done' })
  })

  it('test_status_ERROR_surfaces_as_error_terminal — fail-loud, not swallowed', async () => {
    const out = await drain([
      { type: 'status', agent_id: 'a', run_id: 'r', status: 'ERROR', message: 'boom' },
    ])
    const terminals = out.filter((e) => e.type === 'done' || e.type === 'error')
    expect(terminals).toHaveLength(1)
    expect(terminals[0]).toMatchObject({ type: 'error', message: 'boom' })
  })

  it('test_no_terminal_in_stream_gets_fallback_done — B1 guarantee preserved', async () => {
    // Stream with no status message at all → adapter appends exactly one fallback done.
    const out = await drain([
      {
        type: 'tool_call',
        agent_id: 'a',
        run_id: 'r',
        call_id: 'c9',
        name: 'x',
        status: 'completed',
        result: 'r',
      },
    ])
    expect(out.filter((e) => e.type === 'done')).toHaveLength(1)
    expect(out.at(-1)).toMatchObject({ type: 'done' })
  })
})
