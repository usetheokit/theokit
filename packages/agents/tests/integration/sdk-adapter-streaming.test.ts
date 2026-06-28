/**
 * #40 end-to-end — createSdkAgentStream must token-stream incrementally via the SDK
 * `agent.send(message, { onDelta })` callback, merge those deltas with the complete
 * messages from `run.stream()`, and dedup the complete-assistant text so it is not
 * re-emitted after the deltas already streamed it.
 *
 * The fake SDK Agent drives BOTH sources: `send` invokes `opts.onDelta` with token
 * chunks, then returns a `run` whose `stream()` yields the complete assistant message
 * + tool messages + FINISHED status. This exercises the merge + dedup deterministically
 * without a real LLM. The no-delta variant proves the fallback (translateAssistantEvent
 * still emits the full text when onDelta never fires).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

interface SdkMsg {
  type: string
  [k: string]: unknown
}

const h = vi.hoisted(() => ({
  messages: [] as SdkMsg[],
  deltas: [] as string[],
}))

vi.mock('@theokit/sdk', () => ({
  InMemoryConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  Agent: {
    getOrCreate: () =>
      Promise.resolve({
        send: (
          _msg: string,
          opts?: { onDelta?: (d: { update: { type: string; text: string } }) => void },
        ) => {
          // Fire incremental token deltas synchronously (as the real SDK does during send),
          // using the real TextDeltaUpdate shape ({ type: 'text-delta', text }), then return a
          // run whose stream() yields the complete messages.
          for (const text of h.deltas) opts?.onDelta?.({ update: { type: 'text-delta', text } })
          return Promise.resolve({
            stream: async function* () {
              for (const m of h.messages) yield m
            },
            wait: async () => ({
              result: 'final',
              usage: { inputTokens: 5, outputTokens: 3 },
              cost: { amount: 0.001 },
            }),
          })
        },
        dispose: () => Promise.resolve(),
      }),
  },
  defineTool: (spec: unknown) => spec,
}))

const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')
const { compileAgent } = await import('../../src/bridge/agent-compiler.js')
const { walkAgentMetadata } = await import('../../src/bridge/walk-agent-metadata.js')
await import('reflect-metadata')
const { Agent } = await import('../../src/decorators/agent.js')
const { MainLoop } = await import('../../src/decorators/main-loop.js')

@Agent({ name: 'st', route: '/st' })
class StAgent {
  @MainLoop()
  async run() {}
}

async function drain(deltas: string[], messages: SdkMsg[]) {
  h.deltas = deltas
  h.messages = messages
  const compiled = compileAgent(walkAgentMetadata(StAgent))
  const factory = createSdkAgentStream(compiled, [], 'test-key', { model: 'openai/gpt-4o-mini' })
  const out: { type: string; [k: string]: unknown }[] = []
  for await (const ev of factory('hi', 's1')) out.push(ev)
  return out
}

afterEach(() => {
  h.deltas = []
  h.messages = []
})

describe('createSdkAgentStream × onDelta token streaming (#40)', () => {
  it('test_streams_incremental_deltas — onDelta deltas stream, complete-assistant text deduped', async () => {
    const out = await drain(
      ['Hel', 'lo'],
      [
        {
          type: 'tool_call',
          agent_id: 'a',
          run_id: 'r',
          call_id: 'c1',
          name: 'glob',
          status: 'running',
          input: { p: '*' },
        },
        {
          type: 'tool_call',
          agent_id: 'a',
          run_id: 'r',
          call_id: 'c1',
          name: 'glob',
          status: 'completed',
          result: { ok: true, files: ['a'] },
        },
        {
          type: 'assistant',
          agent_id: 'a',
          run_id: 'r',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
        },
        { type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' },
      ],
    )

    // Exactly 2 incremental deltas — the complete-assistant 'Hello' is NOT re-emitted (deduped).
    const textDeltas = out.filter((e) => e.type === 'text_delta')
    expect(textDeltas).toEqual([
      { type: 'text_delta', content: 'Hel' },
      { type: 'text_delta', content: 'lo' },
    ])

    // The running tool_call card surfaces (#42).
    const toolCalls = out.filter((e) => e.type === 'tool_call')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]).toMatchObject({ callId: 'c1', toolName: 'glob', input: { p: '*' } })

    // The completed tool_result carries the serialized object output (#41).
    const toolResults = out.filter((e) => e.type === 'tool_result')
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0]).toMatchObject({ callId: 'c1', output: '{"ok":true,"files":["a"]}' })

    // Exactly one terminal, and it is the real-usage done.
    expect(out.filter((e) => e.type === 'done' || e.type === 'error')).toHaveLength(1)
    expect(out.at(-1)).toMatchObject({ type: 'done', result: 'final' })
  })

  it('test_no_delta_fallback_emits_full_text — no onDelta → complete-assistant text emitted once', async () => {
    const out = await drain(
      [], // onDelta never fires
      [
        {
          type: 'assistant',
          agent_id: 'a',
          run_id: 'r',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
        },
        { type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' },
      ],
    )

    const textDeltas = out.filter((e) => e.type === 'text_delta')
    expect(textDeltas).toEqual([{ type: 'text_delta', content: 'Hello' }])
    expect(out.at(-1)).toMatchObject({ type: 'done' })
  })
})
