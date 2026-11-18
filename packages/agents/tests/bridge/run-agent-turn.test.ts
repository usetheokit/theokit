import { describe, expect, it, vi } from 'vitest'

import { withGuardrails } from '../../src/bridge/handle-wrappers.js'
import {
  completeFromTurn,
  createOpenAICompatibleRoutes,
  runAgentTurn,
  type AgentStreamEvent,
  type SdkAgentHandle,
  type SdkTurnHandle,
} from '../../src/bridge/index.js'

interface FakeRun {
  messages?: unknown[]
  deltas?: string[]
  wait?: Awaited<ReturnType<SdkTurnHandle['wait']>>
  cancel?: () => Promise<void> | void
  hang?: boolean
}

function fakeAgent(spec: FakeRun): { agent: SdkAgentHandle; sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = []
  const agent = {
    agentId: 'a',
    send: async (_m: string, opts?: Record<string, unknown>) => {
      sent.push(opts ?? {})
      const onDelta = opts?.onDelta as ((d: { update: unknown }) => void) | undefined
      for (const text of spec.deltas ?? []) onDelta?.({ update: { type: 'text-delta', text } })
      return {
        wait: async () => spec.wait ?? { status: 'finished' },
        cancel: spec.cancel,
        async *stream() {
          if (spec.hang === true) await new Promise(() => undefined)
          for (const m of spec.messages ?? []) yield m
        },
      }
    },
  } as unknown as SdkAgentHandle
  return { agent, sent }
}

const assistant = (text: string) => ({
  type: 'assistant',
  message: { content: [{ type: 'text', text }] },
})

async function run(spec: FakeRun, extra: Record<string, unknown> = {}) {
  const events: AgentStreamEvent[] = []
  const { agent, sent } = fakeAgent(spec)
  const outcome = await runAgentTurn({
    agent,
    message: 'hi',
    runId: 'r',
    emit: (e) => events.push(e),
    ...extra,
  })
  return { outcome, events, sent }
}

describe('runAgentTurn', () => {
  it('a streamed error fails the turn even when wait reports finished', async () => {
    const { outcome } = await run({
      messages: [{ type: 'error', code: 'x' }],
      wait: { status: 'finished' },
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.code).toBe('turn_failed')
      expect(outcome.reason).toContain('x')
    }
  })

  it('an aborted signal cancels the run and the iterator without waiting on a hung cancel', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const controller = new AbortController()
    const pending = run({ hang: true, cancel }, { signal: controller.signal })
    setTimeout(() => controller.abort(), 0)
    const { outcome } = await Promise.race([
      pending,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('hung')), 1000)),
    ])
    expect(outcome).toMatchObject({ ok: false, code: 'turn_cancelled' })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('an already aborted signal cancels without sending', async () => {
    const controller = new AbortController()
    controller.abort()
    const { outcome, sent } = await run({}, { signal: controller.signal })
    expect(outcome).toMatchObject({ code: 'turn_cancelled' })
    expect(sent).toHaveLength(0)
  })

  it('final assistant text already streamed by onDelta is not emitted twice', async () => {
    const { outcome, events } = await run({
      deltas: ['Hel', 'lo'],
      messages: [assistant('Hello')],
    })
    expect(outcome.ok).toBe(true)
    const text = events.flatMap((e) => (e.type === 'text_delta' ? [e.content] : []))
    expect(text.join('')).toBe('Hello')
  })

  it('assistant text that was not streamed is emitted', async () => {
    const { events } = await run({ messages: [assistant('Hi there')] })
    expect(events).toContainEqual({ type: 'text_delta', content: 'Hi there' })
  })

  it('usage is attached to a finished turn', async () => {
    const { outcome } = await run({
      wait: {
        status: 'finished',
        usage: { inputTokens: 3, outputTokens: 4 },
        cost: { amountUsd: 0.5 },
      },
    })
    expect(outcome).toEqual({ ok: true, usage: { inputTokens: 3, outputTokens: 4, costUsd: 0.5 } })
  })

  it('a run with no usage yields ok without a usage key', async () => {
    const { outcome } = await run({ wait: { status: 'finished' } })
    expect(outcome).toEqual({ ok: true })
    expect('usage' in outcome).toBe(false)
  })

  it('a non-finished status fails the turn', async () => {
    const { outcome } = await run({ wait: { status: 'error', error: { message: 'boom' } } })
    expect(outcome).toEqual({ ok: false, code: 'turn_failed', reason: 'boom' })
  })

  it('never rejects when send throws', async () => {
    const agent = {
      agentId: 'a',
      send: async () => {
        throw new Error('nope')
      },
    } as unknown as SdkAgentHandle
    const outcome = await runAgentTurn({ agent, message: 'x', runId: 'r', emit: () => undefined })
    expect(outcome).toEqual({ ok: false, code: 'turn_failed', reason: 'nope' })
  })

  it('sets onDelta and signal over caller sendOptions, and mapEvent can rewrite events', async () => {
    const controller = new AbortController()
    const { events, sent } = await run(
      { messages: [assistant('abc')] },
      {
        signal: controller.signal,
        sendOptions: { toolChoice: 'none', signal: 'bad', onDelta: 'bad' },
        mapEvent: (e: AgentStreamEvent) =>
          e.type === 'text_delta' ? { ...e, content: e.content.toUpperCase() } : e,
      },
    )
    expect(sent[0]?.toolChoice).toBe('none')
    expect(sent[0]?.signal).toBe(controller.signal)
    expect(typeof sent[0]?.onDelta).toBe('function')
    expect(events).toContainEqual({ type: 'text_delta', content: 'ABC' })
  })
})

describe('runAgentTurn cancellation, tools and guards', () => {
  it('closes the iterator, settles within one macrotask and drops late deltas', async () => {
    let onDelta: ((d: { update: unknown }) => void) | undefined
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }))
    const agent = {
      agentId: 'a',
      send: async (_m: string, opts?: Record<string, unknown>) => {
        onDelta = opts?.onDelta as typeof onDelta
        return {
          wait: async () => ({ status: 'finished' }),
          cancel: () => new Promise<void>(() => undefined),
          stream: () => ({
            [Symbol.asyncIterator]: () => ({
              next: () => new Promise<never>(() => undefined),
              return: returned,
            }),
          }),
        }
      },
    } as unknown as SdkAgentHandle
    const controller = new AbortController()
    const events: AgentStreamEvent[] = []
    const pending = runAgentTurn({
      agent,
      message: 'x',
      runId: 'r',
      emit: (e) => events.push(e),
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(true)
    expect(await pending).toMatchObject({ code: 'turn_cancelled' })
    expect(returned).toHaveBeenCalled()
    onDelta?.({ update: { type: 'text-delta', text: 'late' } })
    expect(events).toEqual([])
  })

  it('does not emit tool lifecycle from onDelta, which run.stream() already carries', async () => {
    const agent = {
      agentId: 'a',
      send: async (_m: string, opts?: Record<string, unknown>) => {
        const onDelta = opts?.onDelta as (d: { update: unknown }) => void
        onDelta({
          update: {
            type: 'tool-call-started',
            callId: 'c1',
            toolCall: { name: 'ls', args: {} },
          },
        })
        return {
          wait: async () => ({ status: 'finished' }),
          async *stream() {
            yield {
              type: 'tool_call',
              call_id: 'c1',
              name: 'ls',
              status: 'running',
            }
          },
        }
      },
    } as unknown as SdkAgentHandle
    const events: AgentStreamEvent[] = []
    await runAgentTurn({ agent, message: 'x', runId: 'r', emit: (e) => events.push(e) })
    expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(1)
  })

  it('a guarded turn streams no raw deltas: only the guarded text is emitted', async () => {
    let received: Record<string, unknown> | undefined
    const inner = {
      agentId: 'a',
      dispose: () => Promise.resolve(),
      send: async (_m: string, opts?: Record<string, unknown>) => {
        received = opts
        const onDelta = opts?.onDelta as ((d: { update: unknown }) => void) | undefined
        onDelta?.({ update: { type: 'text-delta', text: 'BANANA' } })
        return { wait: async () => ({ status: 'finished', result: 'BANANA' }) }
      },
    } as unknown as SdkAgentHandle
    const guarded = withGuardrails(inner, [
      {
        name: 'redact',
        checkOutput: (text: string) => ({
          action: 'redact' as const,
          text: text.replaceAll('BANANA', '[REDACTED]'),
        }),
      },
    ])
    const events: AgentStreamEvent[] = []
    const outcome = await runAgentTurn({
      agent: guarded,
      message: 'x',
      runId: 'r',
      emit: (e) => events.push(e),
    })
    expect(outcome.ok).toBe(true)
    expect(received?.onDelta).toBeUndefined()
    const text = events.flatMap((e) => (e.type === 'text_delta' ? [e.content] : []))
    expect(text.join('')).toBe('[REDACTED]')
  })
})

describe('completeFromTurn', () => {
  const body = JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
  const request = () =>
    new Request('http://127.0.0.1:8080/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })

  it('returns the text and usage of a finished turn', async () => {
    const { agent } = fakeAgent({
      messages: [assistant('yo')],
      wait: { status: 'finished', usage: { inputTokens: 1, outputTokens: 2 } },
    })
    const complete = completeFromTurn((work) => work(agent))
    const result = await complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    expect(result).toEqual({ text: 'yo', usage: { promptTokens: 1, completionTokens: 2 } })
  })

  it('completeFromTurn throws when the turn fails', async () => {
    const { agent } = fakeAgent({ messages: [{ type: 'error', code: 'x' }] })
    const complete = completeFromTurn((work) => work(agent))
    await expect(
      complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/x/)
    const routes = createOpenAICompatibleRoutes({ models: ['m'], complete })
    const response = await routes(request())
    expect(response?.status).toBe(502)
  })
})
