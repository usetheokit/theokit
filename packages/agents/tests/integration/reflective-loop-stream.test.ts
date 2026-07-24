/**
 * V4-D-stream — the reflective loop must STREAM events to the consumer, not only
 * return an aggregated DelegationResult. This is the prerequisite for streaming-first
 * apps (theocode SSE): the multi-round reflective loop yields each round's events live,
 * AND returns the aggregated DelegationResult as the generator's return value.
 *
 * BDD: Given a 2-round scripted SDK stream, When consumed via AgentRunner.stream(),
 * Then every per-round event is yielded live (in order) AND the final return value
 * is the same aggregated DelegationResult that .run() would produce.
 */
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'

interface StreamEvent {
  type: string
  [key: string]: unknown
}

const h = vi.hoisted(() => ({ rounds: [] as StreamEvent[][], calls: 0 }))

vi.mock('../../src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream:
    () =>
    (_message: string, _sessionId: string): AsyncIterable<StreamEvent> => {
      const events = h.rounds[Math.min(h.calls, h.rounds.length - 1)] ?? []
      h.calls += 1
      return (async function* () {
        for (const e of events) yield e
      })()
    },
}))

const { AgentRunner } = await import('../../src/index.js')
const { applyCapabilities } = await import('../../src/capability/capability.js')
const { ModelCapability } = await import('../../src/capability/capabilities.js')
const { MainLoopCapability } = await import('../../src/capability/agent-capabilities.js')

const reflectAgent = applyCapabilities([
  new ModelCapability('test-model'),
  new MainLoopCapability({ maxIterations: 3 }),
])

const td = (s: string): StreamEvent => ({ type: 'text_delta', content: s })
const toolResult: StreamEvent = { type: 'tool_result', toolName: 'x', input: {}, output: 'r' }
const done: StreamEvent = { type: 'done', cost: 0.01 }
const errorEvent: StreamEvent = { type: 'error', message: 'boom' }

describe('V4-D-stream — AgentRunner.stream() streams live + returns aggregated result', () => {
  it('test_stream_yields_events_live_and_returns_delegation_result', async () => {
    // round 1: text + tool (continue) ; round 2: text only (stop)
    h.rounds = [
      [td('hi '), toolResult, done],
      [td('final'), done],
    ]
    h.calls = 0

    const runner = AgentRunner.fromSpec({
      compiled: reflectAgent,
      name: 'reflectAgent',
      strategy: 'plan-act-reflect',
    }).build()
    const seen: StreamEvent[] = []
    const gen = runner.stream('go', { apiKey: 'k' }) as AsyncGenerator<StreamEvent, unknown>
    let res = await gen.next()
    while (!res.done) {
      seen.push(res.value as StreamEvent)
      res = await gen.next()
    }
    const result = res.value as { response: string; toolCalls: unknown[]; rounds?: number }

    // events streamed live, in order
    expect(seen.map((e) => e.type)).toEqual([
      'text_delta',
      'tool_result',
      'done',
      'text_delta',
      'done',
    ])
    // aggregated result identical to what .run() produces
    expect(result.response).toBe('hi final')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.rounds).toBe(2)
  })

  it('test_run_still_returns_aggregated_result_unchanged', async () => {
    // .run() (collect mode) must keep working — drains the stream internally.
    h.rounds = [[td('only'), done]]
    h.calls = 0
    const runner = AgentRunner.fromSpec({
      compiled: reflectAgent,
      name: 'reflectAgent',
      strategy: 'plan-act-reflect',
    }).build()
    const result = await runner.run('go', { apiKey: 'k' })
    expect(result.response).toBe('only')
    expect(result.rounds).toBe(1)
  })

  it('test_error_event_is_streamed_live_then_generator_throws_DelegationError', async () => {
    // Regression guard for the streaming rewrite's riskiest seam: a throw that fires
    // AFTER events were already yielded. The error event MUST reach the consumer live,
    // and only then the generator throws the typed DelegationError (fail-fast, B1/M2).
    h.rounds = [[td('partial'), errorEvent, done]]
    h.calls = 0
    const runner = AgentRunner.fromSpec({
      compiled: reflectAgent,
      name: 'reflectAgent',
      strategy: 'plan-act-reflect',
    }).build()
    const gen = runner.stream('go', { apiKey: 'k' }) as AsyncGenerator<StreamEvent, unknown>

    const seen: StreamEvent[] = []
    let threw: unknown
    try {
      let res = await gen.next()
      while (!res.done) {
        seen.push(res.value as StreamEvent)
        res = await gen.next()
      }
    } catch (err) {
      threw = err
    }

    // Given the error event, the consumer still saw it (and the prior text) live...
    expect(seen.map((e) => e.type)).toEqual(['text_delta', 'error', 'done'])
    // ...and only after streaming does the loop fail-fast with a typed DelegationError.
    expect(threw).toBeInstanceOf(Error)
    expect((threw as Error).constructor.name).toBe('DelegationError')
  })

  it('test_run_rejects_with_DelegationError_when_round_emits_error_event', async () => {
    // The collect-mode drain wrapper must SURFACE the same throw, not swallow it.
    h.rounds = [[td('partial'), errorEvent, done]]
    h.calls = 0
    const runner = AgentRunner.fromSpec({
      compiled: reflectAgent,
      name: 'reflectAgent',
      strategy: 'plan-act-reflect',
    }).build()
    await expect(runner.run('go', { apiKey: 'k' })).rejects.toThrow(
      /DelegationError|partial|boom|agent/i,
    )
  })

  it('test_budget_exceeded_throws_after_events_streamed', async () => {
    // budget crossed by round-1 cost (0.01 > 0.005): events stream first, then BudgetExceededError.
    h.rounds = [[td('spend'), done]]
    h.calls = 0
    const runner = AgentRunner.fromSpec({
      compiled: reflectAgent,
      name: 'reflectAgent',
      strategy: 'plan-act-reflect',
    }).build()
    const gen = runner.stream('go', { apiKey: 'k', budget: 0.005 }) as AsyncGenerator<
      StreamEvent,
      unknown
    >

    const seen: StreamEvent[] = []
    let threw: unknown
    try {
      let res = await gen.next()
      while (!res.done) {
        seen.push(res.value as StreamEvent)
        res = await gen.next()
      }
    } catch (err) {
      threw = err
    }

    expect(seen.map((e) => e.type)).toEqual(['text_delta', 'done'])
    expect((threw as Error)?.constructor.name).toBe('BudgetExceededError')
  })
})
