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
}

function createRecorder() {
  const spans: RecordedSpan[] = []
  const adapter: ObservabilityAdapter = {
    name: 'recorder',
    startSpan(name, attrs) {
      const span: RecordedSpan = {
        name,
        attrs: { ...attrs } as Record<string, unknown>,
        ended: false,
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
  })

  it('test_token_usage_from_the_finish_chunk_lands_on_the_run_span', async () => {
    const { adapter, byName } = createRecorder()

    await drain(
      observeAgentRun(
        chunks(
          { type: 'start' },
          {
            type: 'finish',
            messageMetadata: { inputTokens: 12, outputTokens: 34, totalTokens: 46 },
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
