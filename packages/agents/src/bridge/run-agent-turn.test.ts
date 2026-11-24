import { describe, expect, it } from 'vitest'

import type { AgentStreamEvent } from './agent-stream-events.js'
import { createOpenAICompatibleRoutes } from './openai-compatible-routes.js'
import { completeFromTurn, runAgentTurn } from './run-agent-turn.js'
import type { SdkMessage } from './event-translator.js'
import type { SdkAgentHandle } from './sdk-adapter.js'

type Delta = (arg: { update: unknown }) => void

interface FakeOptions {
  messages?: unknown[]
  deltas?: string[]
  status?: string
  usage?: Record<string, number>
  cost?: { amountUsd: number }
  cancel?: () => Promise<unknown>
  stream?: () => AsyncIterable<unknown>
}

function fakeAgent(options: FakeOptions = {}): {
  agent: SdkAgentHandle<SdkMessage>
  sent: { onDelta?: Delta }
} {
  const sent: { onDelta?: Delta } = {}
  const agent = {
    agentId: 'a',
    dispose: async () => {},
    send: async (_m: string, opts?: { onDelta?: Delta }) => {
      sent.onDelta = opts?.onDelta
      for (const text of options.deltas ?? [])
        opts?.onDelta?.({ update: { type: 'text-delta', text } })
      return {
        stream:
          options.stream ??
          (() =>
            (async function* () {
              for (const m of options.messages ?? []) yield m
            })()),
        wait: async () => ({
          status: options.status ?? 'finished',
          ...(options.usage ? { usage: options.usage } : {}),
          ...(options.cost ? { cost: options.cost } : {}),
        }),
        ...(options.cancel ? { cancel: options.cancel } : {}),
      }
    },
  } as unknown as SdkAgentHandle<SdkMessage>
  return { agent, sent }
}

const macrotask = (): Promise<void> => new Promise((r) => setImmediate(r))

describe('runAgentTurn', () => {
  it('a streamed error fails the turn even when wait reports finished', async () => {
    const { agent } = fakeAgent({ messages: [{ type: 'error', code: 'x' }] })
    const events: AgentStreamEvent[] = []
    const outcome = await runAgentTurn({
      agent,
      message: 'hi',
      runId: 'r',
      emit: (e) => events.push(e),
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.code).toBe('turn_failed')
      expect(outcome.reason).toContain('x')
    }
  })

  it('a run that waits as cancelled is a cancelled outcome, not a failure', async () => {
    const { agent } = fakeAgent({ status: 'cancelled' })
    const outcome = await runAgentTurn({ agent, message: 'hi', runId: 'r', emit: () => {} })
    expect(outcome).toEqual({ ok: true, cancelled: true })
  })

  it('takes a message with images and an agent that only sends', async () => {
    const seen: unknown[] = []
    const agent = {
      send: async (message: unknown) => {
        seen.push(message)
        return { wait: async () => ({ status: 'finished' }) }
      },
    }
    const message = { text: 'look', images: [{ data: 'AAAA', mimeType: 'image/png' }] }
    const outcome = await runAgentTurn({ agent, message, runId: 'r', emit: () => {} })
    expect(outcome).toEqual({ ok: true })
    expect(seen).toEqual([message])
  })

  it('an aborted signal cancels the run and the iterator without waiting on a hung cancel', async () => {
    let returned = false
    let cancelled = false
    const stream = (): AsyncIterable<unknown> => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<unknown>>(() => {}),
        return: async () => {
          returned = true
          return { done: true, value: undefined }
        },
      }),
    })
    const { agent, sent } = fakeAgent({
      stream,
      cancel: () => {
        cancelled = true
        return new Promise(() => {})
      },
    })
    const controller = new AbortController()
    const events: AgentStreamEvent[] = []
    const pending = runAgentTurn({
      agent,
      message: 'hi',
      runId: 'r',
      emit: (e) => events.push(e),
      signal: controller.signal,
    })
    await macrotask()
    controller.abort()
    // A delta right after the abort, before the promise settles, is dropped.
    sent.onDelta?.({ update: { type: 'text-delta', text: 'late' } })
    const outcome = await Promise.race([pending, macrotask().then(() => 'timeout' as const)])
    expect(outcome).toMatchObject({ ok: false, code: 'turn_cancelled' })
    expect(cancelled).toBe(true)
    expect(returned).toBe(true)
    sent.onDelta?.({ update: { type: 'text-delta', text: 'later' } })
    await macrotask()
    expect(events).toEqual([])
  })

  it('does not emit an event when mapEvent aborts the signal', async () => {
    const { agent } = fakeAgent({ deltas: ['a'] })
    const controller = new AbortController()
    const events: AgentStreamEvent[] = []
    const outcome = await runAgentTurn({
      agent,
      message: 'hi',
      runId: 'r',
      emit: (e) => events.push(e),
      signal: controller.signal,
      mapEvent: (e) => {
        controller.abort()
        return e
      },
    })
    expect(outcome).toMatchObject({ ok: false, code: 'turn_cancelled' })
    expect(events).toEqual([])
  })

  it('final assistant text already streamed by onDelta is not emitted twice', async () => {
    const { agent } = fakeAgent({
      deltas: ['hel', 'lo'],
      messages: [{ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }],
    })
    const events: AgentStreamEvent[] = []
    const outcome = await runAgentTurn({
      agent,
      message: 'hi',
      runId: 'r',
      emit: (e) => events.push(e),
    })
    expect(outcome.ok).toBe(true)
    const text = events.flatMap((e) => (e.type === 'text_delta' ? [e.content] : [])).join('')
    expect(text).toBe('hello')
  })

  it('usage is attached to a finished turn', async () => {
    const withUsage = fakeAgent({
      usage: { inputTokens: 3, outputTokens: 4 },
      cost: { amountUsd: 0.5 },
    })
    expect(
      await runAgentTurn({ agent: withUsage.agent, message: 'm', runId: 'r', emit: () => {} }),
    ).toEqual({
      ok: true,
      usage: { inputTokens: 3, outputTokens: 4, costUsd: 0.5 },
    })
    const bare = await runAgentTurn({
      agent: fakeAgent().agent,
      message: 'm',
      runId: 'r',
      emit: () => {},
    })
    expect(bare).toEqual({ ok: true })
    expect('usage' in bare).toBe(false)
  })
})

describe('completeFromTurn', () => {
  const withFailing = <R>(work: (agent: SdkAgentHandle<SdkMessage>) => Promise<R>): Promise<R> =>
    work(fakeAgent({ messages: [{ type: 'error', code: 'boom' }] }).agent)

  it('throws when the turn fails', async () => {
    const complete = completeFromTurn(withFailing)
    await expect(
      complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('boom')
  })

  it('returns text and usage, and the route answers 502 for a failed turn', async () => {
    const ok = completeFromTurn((work) =>
      work(fakeAgent({ deltas: ['a', 'b'], usage: { inputTokens: 1, outputTokens: 2 } }).agent),
    )
    expect(await ok({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })).toEqual({
      text: 'ab',
      usage: { promptTokens: 1, completionTokens: 2 },
    })
    const routes = createOpenAICompatibleRoutes({
      models: ['m'],
      complete: completeFromTurn(withFailing),
    })
    const response = await routes(
      new Request('http://127.0.0.1/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
      }),
    )
    expect(response?.status).toBe(502)
  })

  const cancelled = (): Parameters<typeof completeFromTurn>[0] => (work) =>
    work(fakeAgent({ deltas: ['so', ' far'], status: 'cancelled' }).agent) as never
  const request = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }] }

  it('throws on a cancelled run by default', async () => {
    await expect(completeFromTurn(cancelled())(request)).rejects.toThrow(
      'the run ended with status cancelled',
    )
  })

  it('returns the text so far on a cancelled run with onCancelled: complete', async () => {
    const reasons: string[] = []
    const complete = completeFromTurn(cancelled(), {
      onCancelled: 'complete',
      onFailure: (r) => reasons.push(r),
    })
    expect((await complete(request)).text).toBe('so far')
    expect(reasons).toEqual([])
  })

  it('reports a failed turn to onFailure, and accepts a send-only agent', async () => {
    const reasons: string[] = []
    const failing = completeFromTurn(withFailing, { onFailure: (r) => reasons.push(r) })
    await expect(failing(request)).rejects.toThrow('boom')
    expect(reasons).toHaveLength(1)

    const { agent } = fakeAgent({ deltas: ['x'] })
    const sendOnly = { send: agent.send.bind(agent) }
    const complete = completeFromTurn(<R>(work: (a: typeof sendOnly) => Promise<R>) =>
      work(sendOnly),
    )
    expect((await complete(request)).text).toBe('x')
  })
})

describe('runAgentTurn: secrets', () => {
  const SECRET = 'sk-live-0123456789'
  const run = async (
    options: FakeOptions,
    extra: { signal?: AbortSignal } = {},
  ): Promise<AgentStreamEvent[]> => {
    const events: AgentStreamEvent[] = []
    const { agent } = fakeAgent(options)
    await runAgentTurn({
      agent,
      message: 'hi',
      runId: 'r',
      secrets: [SECRET],
      emit: (e) => {
        events.push(e)
      },
      ...extra,
    })
    return events
  }

  it('masks a secret split across two text_delta events and flushes the safe tail', async () => {
    const events = await run({ deltas: ['key is sk-live-0123', '456789 and sk-li'] })
    const text = events.map((e) => (e.type === 'text_delta' ? e.content : '')).join('')
    expect(JSON.stringify(events)).not.toContain(SECRET)
    expect(text).toBe('key is [redacted] and sk-li')
  })

  it('masks a secret in a tool result and keeps the order', async () => {
    const events = await run({
      deltas: ['before sk-live-01'],
      messages: [
        {
          type: 'tool_call',
          call_id: 'c1',
          name: 'shell',
          status: 'completed',
          result: `token ${SECRET}`,
        },
      ],
    })
    expect(JSON.stringify(events)).not.toContain(SECRET)
    const types = events.map((e) => e.type)
    expect(types.indexOf('text_delta')).toBeLessThan(types.indexOf('tool_result'))
    const result = events.find((e) => e.type === 'tool_result')
    expect(result && 'output' in result && result.output).toContain('[redacted]')
  })

  it('releases nothing held when the turn is aborted', async () => {
    const controller = new AbortController()
    const events: AgentStreamEvent[] = []
    const { agent } = fakeAgent({
      deltas: ['sk-live-01'],
      stream: () =>
        (async function* () {
          controller.abort()
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } }
        })(),
    })
    const outcome = await runAgentTurn({
      agent,
      message: 'hi',
      runId: 'r',
      secrets: [SECRET],
      signal: controller.signal,
      emit: (e) => {
        events.push(e)
      },
    })
    expect(outcome.ok).toBe(false)
    expect(events).toEqual([])
  })
})
