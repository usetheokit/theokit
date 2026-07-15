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
  // #44 — richer onDelta driver: full InteractionUpdate objects fired in arrival order.
  updates: [] as { type: string; [k: string]: unknown }[],
  rejectSend: false,
  throwInStream: false,
  disposed: 0,
}))

vi.mock('@theokit/sdk', () => ({
  Agent: {
    getOrCreate: () =>
      Promise.resolve({
        send: (
          _msg: string,
          opts?: { onDelta?: (d: { update: { type: string; [k: string]: unknown } }) => void },
        ) => {
          // Fire onDelta synchronously (as the real SDK does during send). #44: when h.updates is
          // set, fire the full InteractionUpdate sequence in arrival order; otherwise fall back to
          // the #40 text-delta-only driver.
          if (h.updates.length > 0) {
            for (const update of h.updates) opts?.onDelta?.({ update })
          } else {
            for (const text of h.deltas) opts?.onDelta?.({ update: { type: 'text-delta', text } })
          }
          if (h.rejectSend) return Promise.reject(new Error('send failed'))
          return Promise.resolve({
            stream: async function* () {
              for (const m of h.messages) yield m
              if (h.throwInStream) throw new Error('stream failed')
            },
            wait: async () => ({
              result: 'final',
              usage: { inputTokens: 5, outputTokens: 3 },
              cost: { amount: 0.001 },
            }),
          })
        },
        dispose: () => {
          h.disposed += 1
          return Promise.resolve()
        },
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

// #44 — drive onDelta with a full InteractionUpdate sequence; run.stream yields `messages`.
async function drainUpdates(updates: { type: string; [k: string]: unknown }[], messages: SdkMsg[]) {
  h.updates = updates
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
  h.updates = []
  h.rejectSend = false
  h.throwInStream = false
  h.disposed = 0
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

// #44 — events MUST be emitted in true chronological arrival order (text/tool interleaved),
// not all-text-then-all-tools. Tool + thinking updates flow through onDelta in arrival order.
// Inner toolCall.callId is DISTINCT from the top-level callId on purpose: production reads the
// top-level `update.callId` for the event id (not `toolCall.callId`), so the assertions are load-bearing.
const tcStarted = (callId: string, name: string, args: unknown) => ({
  type: 'tool-call-started',
  callId,
  modelCallId: `m-${callId}`,
  toolCall: { callId: `inner-${callId}`, name, args },
})
const tcCompleted = (callId: string, name: string, result: unknown) => ({
  type: 'tool-call-completed',
  callId,
  modelCallId: `m-${callId}`,
  toolCall: { callId: `inner-${callId}`, name, result },
})
const td = (text: string) => ({ type: 'text-delta', text })

describe('createSdkAgentStream × chronological ordering (#44)', () => {
  it('test_stream_emits_events_in_chronological_arrival_order', async () => {
    const out = await drainUpdates(
      [
        td('Vou'),
        tcStarted('c1', 'write_file', { path: 'a.txt' }),
        tcCompleted('c1', 'write_file', { ok: true }),
        td('Pronto'),
      ],
      [{ type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' }],
    )
    const content = out.filter((e) => e.type !== 'done' && e.type !== 'run_started')
    expect(content).toEqual([
      { type: 'text_delta', content: 'Vou' },
      { type: 'tool_call', callId: 'c1', toolName: 'write_file', input: { path: 'a.txt' } },
      {
        type: 'tool_result',
        callId: 'c1',
        toolName: 'write_file',
        output: '{"ok":true}',
        durationMs: 0,
        isError: false,
      },
      { type: 'text_delta', content: 'Pronto' },
    ])
    expect(h.disposed).toBeGreaterThanOrEqual(1) // L4: clean run disposes the agent
  })

  it('test_multiple_tool_calls_interleave_in_order_no_cross_callid_contamination', async () => {
    // M2: >1 callId exercises emittedToolCallIds/emittedToolResultIds with multiple entries.
    const out = await drainUpdates(
      [
        td('A'),
        tcStarted('c1', 'write_file', { path: 'a' }),
        tcStarted('c2', 'glob', { p: '*' }),
        tcCompleted('c1', 'write_file', { ok: true }),
        tcCompleted('c2', 'glob', { files: [] }),
        td('B'),
      ],
      [{ type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' }],
    )
    const content = out.filter((e) => e.type !== 'done' && e.type !== 'run_started')
    expect(content).toEqual([
      { type: 'text_delta', content: 'A' },
      { type: 'tool_call', callId: 'c1', toolName: 'write_file', input: { path: 'a' } },
      { type: 'tool_call', callId: 'c2', toolName: 'glob', input: { p: '*' } },
      {
        type: 'tool_result',
        callId: 'c1',
        toolName: 'write_file',
        output: '{"ok":true}',
        durationMs: 0,
        isError: false,
      },
      {
        type: 'tool_result',
        callId: 'c2',
        toolName: 'glob',
        output: '{"files":[]}',
        durationMs: 0,
        isError: false,
      },
      { type: 'text_delta', content: 'B' },
    ])
  })

  it('test_run_stream_error_status_emits_error_and_suppresses_done', async () => {
    // H1: run-level ERROR via run.stream() surfaces an error event AND suppresses the real-usage done.
    const out = await drainUpdates(
      [],
      [{ type: 'status', agent_id: 'a', run_id: 'r', status: 'ERROR', message: 'run failed' }],
    )
    expect(out.filter((e) => e.type === 'done')).toHaveLength(0)
    const errs = out.filter((e) => e.type === 'error')
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ type: 'error', message: 'run failed' })
  })

  it('test_run_stream_throw_mid_iteration_emits_content_then_error', async () => {
    // M1 + HIGH-1: run.stream() yields a tool message then throws; the queued content drains BEFORE
    // the error surfaces (no lost event), the error is yielded (no unhandled rejection), dispose runs.
    h.throwInStream = true
    const out = await drainUpdates(
      [],
      [
        {
          type: 'tool_call',
          agent_id: 'a',
          run_id: 'r',
          call_id: 'c1',
          name: 'glob',
          status: 'running',
          input: {},
        },
      ],
    )
    const errIdx = out.findIndex((e) => e.type === 'error')
    expect(errIdx).toBeGreaterThanOrEqual(0)
    expect(out.slice(0, errIdx).some((e) => e.type === 'tool_call' && e.callId === 'c1')).toBe(true)
    expect(out.filter((e) => e.type === 'done')).toHaveLength(0)
    expect(h.disposed).toBeGreaterThanOrEqual(1)
  })

  it('test_thinking_delta_streams_via_onDelta_in_order', async () => {
    const out = await drainUpdates(
      [{ type: 'thinking-delta', text: 'reasoning' }, td('answer')],
      [
        { type: 'thinking', agent_id: 'a', run_id: 'r', text: 'reasoning' },
        { type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' },
      ],
    )
    const content = out.filter((e) => e.type !== 'done' && e.type !== 'run_started')
    // thinking comes from onDelta in order; the run.stream() complete thinking is deduped.
    expect(content).toEqual([
      { type: 'thinking', content: 'reasoning' },
      { type: 'text_delta', content: 'answer' },
    ])
  })

  it('test_tool_events_from_onDelta_not_duplicated_by_run_stream', async () => {
    const out = await drainUpdates(
      [tcStarted('c1', 'glob', { p: '*' }), tcCompleted('c1', 'glob', { files: ['a'] })],
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
          result: { files: ['a'] },
        },
        { type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' },
      ],
    )
    expect(out.filter((e) => e.type === 'tool_call')).toHaveLength(1)
    expect(out.filter((e) => e.type === 'tool_result')).toHaveLength(1)
  })

  it('test_text_only_onDelta_still_gets_tools_from_run_stream', async () => {
    const out = await drainUpdates(
      [td('Hi')],
      [
        {
          type: 'tool_call',
          agent_id: 'a',
          run_id: 'r',
          call_id: 'c2',
          name: 'glob',
          status: 'running',
          input: {},
        },
        {
          type: 'tool_call',
          agent_id: 'a',
          run_id: 'r',
          call_id: 'c2',
          name: 'glob',
          status: 'completed',
          result: { ok: true },
        },
        { type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' },
      ],
    )
    expect(out.filter((e) => e.type === 'text_delta')).toEqual([
      { type: 'text_delta', content: 'Hi' },
    ])
    // onDelta drove NO tool category → run.stream tools must NOT be lost (per-category dedup).
    expect(out.filter((e) => e.type === 'tool_call')).toHaveLength(1)
    expect(out.filter((e) => e.type === 'tool_result')).toHaveLength(1)
  })

  it('test_tool_error_from_run_stream_not_suppressed_when_onDelta_only_started', async () => {
    // EC-3: onDelta emits tool-call-started for c1 only; the failure is reported via run.stream.
    const out = await drainUpdates(
      [tcStarted('c1', 'shell', { cmd: 'x' })],
      [
        {
          type: 'tool_call',
          agent_id: 'a',
          run_id: 'r',
          call_id: 'c1',
          name: 'shell',
          status: 'error',
          result: 'boom',
        },
        { type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' },
      ],
    )
    expect(out.filter((e) => e.type === 'tool_call')).toHaveLength(1) // from onDelta, once
    const results = out.filter((e) => e.type === 'tool_result')
    expect(results).toHaveLength(1) // the error result is NOT suppressed
    expect(results[0]).toMatchObject({ callId: 'c1', isError: true, output: 'boom' })
  })

  it('test_send_rejection_emits_error_and_disposes', async () => {
    h.rejectSend = true
    const out = await drainUpdates([], [])
    expect(out.some((e) => e.type === 'error')).toBe(true)
    expect(h.disposed).toBeGreaterThanOrEqual(1)
  })

  it('test_send_rejection_after_partial_deltas_emits_content_then_error', async () => {
    // EC-2: onDelta streams partial content, THEN send rejects — partial content surfaces BEFORE error.
    h.rejectSend = true
    const out = await drainUpdates([td('Partial'), tcStarted('c1', 'write_file', {})], [])
    const errIdx = out.findIndex((e) => e.type === 'error')
    expect(errIdx).toBeGreaterThanOrEqual(0)
    const before = out.slice(0, errIdx)
    expect(before).toEqual([
      { type: 'text_delta', content: 'Partial' },
      { type: 'tool_call', callId: 'c1', toolName: 'write_file', input: {} },
    ])
    expect(h.disposed).toBeGreaterThanOrEqual(1)
  })

  it('test_adapter_emits_tool_call_with_populated_input — run.stream tool_call surfaces msg.args (theokit#58)', async () => {
    // theokit#58 end-to-end: a running tool_call SDKMessage carrying real `args` must reach the
    // consumer with `input` populated (was `{}` because the bridge read msg.input/arguments).
    const out = await drain(
      [],
      [
        {
          type: 'tool_call',
          agent_id: 'a',
          run_id: 'r',
          call_id: 'c1',
          name: 'shell_exec',
          status: 'running',
          args: { command: 'ls -la' },
        },
        {
          type: 'tool_call',
          agent_id: 'a',
          run_id: 'r',
          call_id: 'c1',
          name: 'shell_exec',
          status: 'completed',
          result: 'total 0',
        },
        { type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' },
      ],
    )
    const toolCalls = out.filter((e) => e.type === 'tool_call')
    // Exactly one tool_call for the call id, and it carries the assembled args (not {}).
    expect(toolCalls).toEqual([
      { type: 'tool_call', callId: 'c1', toolName: 'shell_exec', input: { command: 'ls -la' } },
    ])
    // The completed message still surfaces the tool_result (no regression).
    expect(out.some((e) => e.type === 'tool_result' && e.callId === 'c1')).toBe(true)
  })

  it('test_adapter_running_tool_call_without_args_is_empty_no_throw (theokit#58 negative)', async () => {
    const out = await drain(
      [],
      [
        {
          type: 'tool_call',
          agent_id: 'a',
          run_id: 'r',
          call_id: 'c2',
          name: 'shell_exec',
          status: 'running',
        },
        { type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' },
      ],
    )
    expect(out.filter((e) => e.type === 'tool_call')).toEqual([
      { type: 'tool_call', callId: 'c2', toolName: 'shell_exec', input: {} },
    ])
  })
})
