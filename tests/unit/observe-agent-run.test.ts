import { describe, it, expect } from 'vitest'

import { observeAgentRun } from '../../packages/theo/src/server/agent/observe-agent-run.js'
import type {
  ObservabilityAdapter,
  SpanHandle,
} from '../../packages/theo/src/server/observability/adapters/types.js'

/**
 * M8 / usetheokit/theokit#353 — the four spans the milestone names (run start
 * and end, every tool call, every HITL pause and resume, token usage) measured
 * 0 of 4: no production file created an agent span at all.
 *
 * They are emitted here rather than inside the agent loop because `packages/agents`
 * cannot reach the adapter: its dependencies are `@theokit/presenter`,
 * `@theokit/sdk`, `@theokit/sdk-pty` and `@theokit/sdk-tools`, and
 * `ObservabilityAdapter` lives under `packages/theo/src/server/`. Instrumenting the
 * loop would mean inverting the package graph.
 *
 * It does not need to. The agent already emits a canonical, target-agnostic wire
 * chunk stream, and every signal the milestone asks for is a chunk in it. The agent
 * emits; the framework observes. Tauri and TUI get the same spans over the same
 * events, with no second instrumenter per target — which is what
 * `three-target-parity.md` requires and what instrumenting the loop would have
 * quietly broken.
 */

interface RecordedSpan {
  name: string
  attrs: Record<string, unknown>
  status?: string
  message?: string
  ended: boolean
  /**
   * The third argument of `startSpan`. Recorded because the recorder used to
   * drop it, and a recorder that drops an argument cannot disagree with code
   * that never passes it — which is how a run emitted spans belonging to no
   * common trace while nine tests stayed green (usetheokit/theokit#368).
   */
  context?: { traceId: string; spanId?: string; parentSpanId?: string }
}

function createRecorder() {
  const spans: RecordedSpan[] = []
  const adapter: ObservabilityAdapter = {
    name: 'recorder',
    startSpan(name, attrs, context) {
      const span: RecordedSpan = {
        name,
        attrs: { ...attrs } as Record<string, unknown>,
        ended: false,
        context,
      }
      spans.push(span)
      const handle: SpanHandle = {
        setAttribute(k, v) {
          span.attrs[k] = v
        },
        setStatus(s, message) {
          span.status = s
          span.message = message
        },
        end() {
          span.ended = true
        },
      }
      return handle
    },
    counter() {},
    histogram() {},
    log() {},
    flush: async () => {},
    shutdown: async () => {},
  }
  return { adapter, spans, byName: (n: string) => spans.filter((s) => s.name === n) }
}

async function* chunks(...items: unknown[]) {
  for (const item of items) yield item as never
}

async function drain(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

describe('agent run observability (M8)', () => {
  it('test_every_chunk_is_forwarded_unchanged', async () => {
    const { adapter } = createRecorder()
    const input = [
      { type: 'start' },
      { type: 'text-delta', id: 't', delta: 'hi' },
      { type: 'finish' },
    ]

    const out = await drain(observeAgentRun(chunks(...input), adapter, { agent: 'chat' }))

    // Observing a stream must never change it. A translator that drops or
    // reshapes a chunk breaks the client to instrument the server.
    expect(out).toEqual(input)
  })

  it('test_a_run_produces_one_span_that_starts_and_ends', async () => {
    const { adapter, byName } = createRecorder()

    await drain(
      observeAgentRun(chunks({ type: 'start' }, { type: 'finish' }), adapter, { agent: 'chat' }),
    )

    const run = byName('agent.run')
    expect(run).toHaveLength(1)
    expect(run[0].attrs.agent).toBe('chat')
    expect(run[0].status).toBe('ok')
    expect(run[0].ended).toBe(true)
  })

  it('test_each_tool_call_gets_its_own_span_closed_by_its_output', async () => {
    const { adapter, byName } = createRecorder()

    await drain(
      observeAgentRun(
        chunks(
          { type: 'start' },
          { type: 'tool-input-available', toolCallId: 'c1', toolName: 'search', input: {} },
          { type: 'tool-input-available', toolCallId: 'c2', toolName: 'write', input: {} },
          { type: 'tool-output-available', toolCallId: 'c1', output: {} },
          { type: 'tool-output-error', toolCallId: 'c2', errorText: 'denied' },
          { type: 'finish' },
        ),
        adapter,
        { agent: 'chat' },
      ),
    )

    const tools = byName('agent.tool')
    expect(tools).toHaveLength(2)
    expect(tools[0].attrs.tool).toBe('search')
    expect(tools[0].status).toBe('ok')
    expect(tools[1].attrs.tool).toBe('write')
    expect(tools[1].status).toBe('error')
    expect(tools[1].message).toBe('denied')
    expect(tools.every((s) => s.ended)).toBe(true)
  })

  it('test_a_pause_never_observed_to_resume_says_so_instead_of_reporting_a_duration', async () => {
    const { adapter, byName } = createRecorder()

    // The stream ends with the pause still open and no output for the gated call:
    // the client disconnected while a human was deciding, or the run failed
    // mid-pause. Nothing on the wire says how long the human took, so the sweep
    // must not report a duration as if it did.
    //
    // This fixture used to send the resume under a DIFFERENT id than the approval,
    // because that is what the wire did for every gated call (#361). It was the
    // normal path then; it is not a path at all now that the two ids correlate
    // (`packages/agents/src/bridge/hitl-call-correlation.ts`), so the test would
    // have gone on describing a shape the producer can no longer emit.
    await drain(
      observeAgentRun(
        chunks(
          { type: 'start' },
          {
            type: 'tool-input-available',
            toolCallId: 'call-1',
            toolName: 'deploy',
            input: {},
          },
          { type: 'tool-approval-request', approvalId: 'approval-uuid', toolCallId: 'call-1' },
          { type: 'finish' },
        ),
        adapter,
        { agent: 'chat' },
      ),
    )

    const pause = byName('agent.hitl')[0]
    expect(pause.attrs['hitl.resume_observed']).toBe(false)
    expect(pause.status).toBe('error')
    expect(pause.ended).toBe(true)
  })

  it('test_a_hitl_pause_opens_a_span_that_the_resume_closes', async () => {
    const { adapter, byName } = createRecorder()

    await drain(
      observeAgentRun(
        chunks(
          { type: 'start' },
          { type: 'tool-input-available', toolCallId: 'c1', toolName: 'deploy', input: {} },
          { type: 'tool-approval-request', approvalId: 'a1', toolCallId: 'c1' },
          // The resume is the tool producing output — that is what "the human
          // answered and the run continued" looks like on the wire.
          { type: 'tool-output-available', toolCallId: 'c1', output: {} },
          { type: 'finish' },
        ),
        adapter,
        { agent: 'chat' },
      ),
    )

    const pauses = byName('agent.hitl')
    expect(pauses).toHaveLength(1)
    expect(pauses[0].attrs.approvalId).toBe('a1')
    expect(pauses[0].attrs.tool).toBe('deploy')
    expect(pauses[0].ended).toBe(true)
    // Stated positively, so the duration is self-describing. An operator filtering
    // on the negative case only learns which spans are useless; this is what says
    // the rest of them are the human's wait.
    expect(pauses[0].attrs['hitl.resume_observed']).toBe(true)
    expect(pauses[0].status).toBe('ok')
  })

  it('test_token_usage_from_the_finish_chunk_lands_on_the_run_span', async () => {
    const { adapter, byName } = createRecorder()

    // The fixture is the PRODUCER's shape, read from `AgentTurnMetadata`
    // (`packages/agents/src/bridge/agent-stream-events.ts:141-146`) rather than
    // assumed: tokens are nested under `usage`. The first version of this test
    // invented a flat shape, the code read it flat, and the two agreed with each
    // other while the span carried no tokens at all.
    await drain(
      observeAgentRun(
        chunks(
          { type: 'start' },
          {
            type: 'finish',
            messageMetadata: {
              usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46, reasoningTokens: 5 },
              cost: 0.0021,
              durationMs: 900,
            },
          },
        ),
        adapter,
        { agent: 'chat' },
      ),
    )

    const run = byName('agent.run')[0]
    expect(run.attrs['tokens.input']).toBe(12)
    expect(run.attrs['tokens.output']).toBe(34)
    expect(run.attrs['tokens.total']).toBe(46)
    expect(run.attrs['tokens.reasoning']).toBe(5)
    expect(run.attrs['cost.usd']).toBe(0.0021)
  })

  it('test_the_stop_reason_from_the_finish_chunk_lands_on_the_run_span', async () => {
    // usetheokit/theokit#379 — a run the SDK cut still ends on `finish`, so without this attribute
    // the trace of a truncated run is identical to the trace of a finished one. The fixture is the
    // producer's shape (`AgentTurnMetadata.stopReason`), not an invented one.
    const { adapter, byName } = createRecorder()

    await drain(
      observeAgentRun(
        chunks(
          { type: 'start' },
          {
            type: 'finish',
            messageMetadata: {
              usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
              durationMs: 900,
              stopReason: 'step_limit',
            },
          },
        ),
        adapter,
        { agent: 'chat' },
      ),
    )

    const run = byName('agent.run')[0]
    expect(run.attrs['stop.reason']).toBe('step_limit')
    // A reached ceiling is a declared outcome, not a failure. Marking it an error would put every
    // capped run in an operator's error budget.
    expect(run.status).toBe('ok')
  })

  it('test_a_clean_finish_leaves_the_run_span_without_a_stop_reason', async () => {
    // Absence is the finished case, on the span exactly as on the wire: an operator filtering on
    // `stop.reason` must see only the runs that were actually cut.
    const { adapter, byName } = createRecorder()

    await drain(
      observeAgentRun(
        chunks(
          { type: 'start' },
          { type: 'finish', messageMetadata: { usage: { inputTokens: 1 }, durationMs: 9 } },
        ),
        adapter,
        { agent: 'chat' },
      ),
    )

    expect(byName('agent.run')[0].attrs['stop.reason']).toBeUndefined()
  })

  it('test_an_unknown_stop_reason_is_not_passed_through', async () => {
    // The attribute is what a dashboard groups by. Forwarding an arbitrary string would let a value
    // this framework never produces create a bucket nobody can explain.
    const { adapter, byName } = createRecorder()

    await drain(
      observeAgentRun(
        chunks({ type: 'start' }, { type: 'finish', messageMetadata: { stopReason: 'whatever' } }),
        adapter,
        { agent: 'chat' },
      ),
    )

    expect(byName('agent.run')[0].attrs['stop.reason']).toBeUndefined()
  })

  it('test_a_flat_metadata_shape_is_NOT_read_as_usage', async () => {
    // The guard against the defect returning. If someone reintroduces the flat
    // read, this passes silently unless the flat shape is explicitly refused.
    const { adapter, byName } = createRecorder()

    await drain(
      observeAgentRun(
        chunks({ type: 'start' }, { type: 'finish', messageMetadata: { inputTokens: 99 } }),
        adapter,
        { agent: 'chat' },
      ),
    )

    expect(byName('agent.run')[0].attrs['tokens.input']).toBeUndefined()
  })

  it('test_a_stream_that_errors_still_closes_every_open_span', async () => {
    const { adapter, byName } = createRecorder()

    async function* failing() {
      yield { type: 'start' } as never
      yield { type: 'tool-input-available', toolCallId: 'c1', toolName: 'x', input: {} } as never
      throw new Error('provider exploded')
    }

    await expect(drain(observeAgentRun(failing(), adapter, { agent: 'chat' }))).rejects.toThrow(
      'provider exploded',
    )

    // A run that dies mid-stream is the case where a leaked span costs most:
    // it is also the case an operator most wants to see.
    expect(byName('agent.run')[0].status).toBe('error')
    expect(byName('agent.run')[0].ended).toBe(true)
    expect(byName('agent.tool')[0].ended).toBe(true)
  })

  it('test_a_stream_abandoned_by_its_consumer_still_closes_its_spans', async () => {
    const { adapter, byName } = createRecorder()

    const stream = observeAgentRun(
      chunks({ type: 'start' }, { type: 'text-delta', id: 't', delta: 'a' }, { type: 'finish' }),
      adapter,
      { agent: 'chat' },
    )

    // A client disconnect mid-run: the consumer stops reading. Without a
    // `finally`, the run span stays open for the life of the process.
    for await (const _ of stream) break

    expect(byName('agent.run')[0].ended).toBe(true)
  })
})

describe('a run is one trace (usetheokit/theokit#368)', () => {
  const HEX32 = /^[0-9a-f]{32}$/
  const HEX16 = /^[0-9a-f]{16}$/

  const toolRun = () =>
    chunks(
      { type: 'start' },
      { type: 'tool-input-available', toolCallId: 'c1', toolName: 'lookup' },
      { type: 'tool-approval-request', toolCallId: 'c1', approvalId: 'a1' },
      { type: 'tool-output-available', toolCallId: 'c1' },
      { type: 'finish' },
    )

  it('test_every_span_of_a_run_shares_one_trace_id', async () => {
    const { adapter, spans } = createRecorder()

    await drain(observeAgentRun(toolRun(), adapter, { agent: 'chat' }))

    expect(spans.length).toBeGreaterThan(1)
    const traces = new Set(spans.map((s) => s.context?.traceId))
    expect(traces.size).toBe(1)
    expect([...traces][0]).toMatch(HEX32)
  })

  it('test_tool_and_hitl_spans_hang_under_the_run_span', async () => {
    const { adapter, spans, byName } = createRecorder()

    await drain(observeAgentRun(toolRun(), adapter, { agent: 'chat' }))

    const runSpanId = byName('agent.run')[0].context?.spanId
    expect(runSpanId).toMatch(HEX16)

    // The run is the root; everything else names it. A flat list of siblings
    // renders at a collector as a run with no tool calls in it.
    for (const span of spans.filter((s) => s.name !== 'agent.run')) {
      expect(span.context?.parentSpanId).toBe(runSpanId)
    }
    expect(byName('agent.run')[0].context?.parentSpanId).toBeUndefined()
  })

  it('test_two_runs_do_not_share_a_trace', async () => {
    const first = createRecorder()
    const second = createRecorder()

    await drain(observeAgentRun(toolRun(), first.adapter, { agent: 'chat' }))
    await drain(observeAgentRun(toolRun(), second.adapter, { agent: 'chat' }))

    expect(first.spans[0].context?.traceId).not.toBe(second.spans[0].context?.traceId)
  })

  it('test_a_caller_with_a_trace_keeps_it_so_the_request_and_the_run_are_one_thing', async () => {
    const { adapter, spans } = createRecorder()
    const incoming = 'abcdefabcdefabcdefabcdefabcdefab'

    await drain(observeAgentRun(toolRun(), adapter, { agent: 'chat', traceId: incoming }))

    // An agent invoked from an HTTP request belongs to that request's trace.
    // Minting a new one here would file the cause and the effect as two
    // unrelated things that happened at the same time.
    expect(new Set(spans.map((s) => s.context?.traceId))).toEqual(new Set([incoming]))
  })
})
