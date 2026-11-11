/**
 * B-400 T1.3 (FR-005, NFR-005): `/usage off|tokens|full|cost` sets a conversation's footer, is
 * answered by a gateway hook without reaching the model, and a channel reply carries the footer.
 */
import 'reflect-metadata'

import { chunkText, GatewayRunner } from '@theokit/gateway'
import type { GatewayContext, MessageEvent } from '@theokit/gateway'
import { afterEach, describe, expect, it } from 'vitest'

import { createReplyHandler, type TurnAgent } from '../src/channels/reply-handler.js'
import { createUsageHook } from '../src/channels/usage-hook.js'
import type { SessionLease } from '../src/sessions/session-agents.js'
import { assistant, FakeAdapter, FakeAgent, type FakeTurn, finished, messageEvent, waitFor } from './fakes.js'

const MODEL = 'stub/model'
const TELEGRAM_MAX_MESSAGE = 4096
const runners: GatewayRunner[] = []

afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner.stop()))
})

function pricedTurn(answer: string): FakeTurn {
  return {
    frames: [assistant(answer), finished()],
    result: { status: 'finished', usage: { inputTokens: 120, outputTokens: 30 }, cost: { amountUsd: 0.00042 } },
  }
}

function withOne(agent: TurnAgent) {
  return async <R>(_event: MessageEvent, work: (lease: SessionLease) => R | Promise<R>): Promise<R> =>
    work({ agent, agentId: 'a-1', release: () => undefined })
}

function inflight(runner: GatewayRunner): number {
  return (runner as unknown as { readonly _inflightSize: number })._inflightSize
}

/** A runner over the usage hook and the reply handler, with one stub model whose sends are counted. */
async function app(answer = 'Hi!') {
  const adapter = new FakeAdapter('telegram')
  const agent = new FakeAgent(pricedTurn(answer))
  const lines: string[] = []
  const usage = createUsageHook()
  const handler = createReplyHandler({
    withAgent: withOne(agent),
    reset: async () => undefined,
    usage: { modeFor: usage.modeFor, model: MODEL, write: (line) => void lines.push(line) },
  })
  const runner = new GatewayRunner({ adapters: [adapter], handler, hooks: [usage.hook] })
  runners.push(runner)
  await runner.start()
  return {
    adapter,
    agent,
    lines,
    replies: () => adapter.sent.map((message) => message.text),
    send: async (text: string) => {
      await adapter.deliver(messageEvent('telegram', text, 'owner-1'))
      await waitFor(() => inflight(runner) === 0, 2000, 'the dispatch to settle')
    },
  }
}

describe('/usage (FR-005)', () => {
  it('/usage full appends tokens, cost and model to the next reply', async () => {
    const chat = await app()
    await chat.send('/usage full')
    await chat.send('hello')
    expect(chat.replies()).toEqual(['Usage footer is now full.', `Hi!\n\n— 120 in · 30 out · $0.00042 · ${MODEL}`])
    expect(chat.lines).toEqual([`theoclaw: usage channel ${MODEL} in=120 out=30 cost=$0.00042`])
  })

  it('/usage never reaches the model', async () => {
    const chat = await app()
    for (const command of ['/usage full', '/usage tokens', '/usage cost', '/usage off', '/usage nonsense']) await chat.send(command)
    // NFR-005: exactly 0 stub requests for five commands.
    expect(chat.agent.sent).toEqual([])
    expect(chat.lines).toEqual([])
  })

  it('any other argument answers the usage text', async () => {
    const chat = await app()
    await chat.send('/usage loud')
    await chat.send('/usage')
    expect(chat.replies()).toEqual([
      'Use /usage off, /usage tokens, /usage cost or /usage full.',
      'Use /usage off, /usage tokens, /usage cost or /usage full.',
    ])
  })

  it('/usage off removes the footer', async () => {
    const chat = await app()
    await chat.send('/usage tokens')
    await chat.send('hello')
    await chat.send('/usage off')
    await chat.send('hello again')
    expect(chat.replies()).toEqual(['Usage footer is now tokens.', 'Hi!\n\n— 120 in · 30 out', 'Usage footer is now off.', 'Hi!'])
    // The line is written for every finished turn, footer or not.
    expect(chat.lines).toHaveLength(2)
  })

  it('a reply carries no footer by default, and the cost footer says when the run was unpriced', async () => {
    const adapterReplies: string[] = []
    const agent = new FakeAgent({ frames: [assistant('Hi!'), finished()], result: { status: 'finished', usage: { inputTokens: 1, outputTokens: 2 } } })
    const usage = createUsageHook()
    const handler = createReplyHandler({ withAgent: withOne(agent), reset: async () => undefined, usage: { modeFor: usage.modeFor, model: MODEL, write: () => undefined } })
    const event = messageEvent('telegram', 'hello', 'owner-1')
    const ctx: GatewayContext = { event, reply: async (text) => (adapterReplies.push(text), { ok: true, messageId: 'm' }) }
    await handler(event, ctx)
    await usage.hook.pre_inbound!({ event: { ...event, text: '/usage cost' } } as never)
    await handler(event, ctx)
    expect(adapterReplies).toEqual(['Hi!', 'Hi!\n\n— cost unpriced'])
  })

  it('the footer follows the mode read when the reply is sent (EC-7)', async () => {
    const usage = createUsageHook()
    const event = messageEvent('telegram', 'hello', 'owner-1')
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const agent = new FakeAgent({ ...pricedTurn('Hi!'), before: gate })
    const replies: string[] = []
    const handler = createReplyHandler({ withAgent: withOne(agent), reset: async () => undefined, usage: { modeFor: usage.modeFor, model: MODEL, write: () => undefined } })
    const turn = handler(event, { event, reply: async (text) => (replies.push(text), { ok: true, messageId: 'm' }) })
    await waitFor(() => agent.sent.length === 1, 2000, 'the send')
    // The mode changes while the turn is running; the reply reads it when it is sent.
    await usage.hook.pre_inbound!({ event: { ...event, text: '/usage tokens' } } as never)
    release()
    await turn
    expect(replies).toEqual(['Hi!\n\n— 120 in · 30 out'])
  })

  it("usage footer on a reply at the platform's maximum length is still delivered (EC-5)", async () => {
    const answer = 'x'.repeat(TELEGRAM_MAX_MESSAGE)
    const chat = await app(answer)
    await chat.send('/usage full')
    await chat.send('hello')
    const reply = chat.replies().at(-1)!
    expect(reply.startsWith(answer)).toBe(true)
    expect(reply.endsWith(`— 120 in · 30 out · $0.00042 · ${MODEL}`)).toBe(true)
    // The platform's own chunking splits it; the footer travels in the last part, whole.
    const parts = chunkText(reply, { limit: TELEGRAM_MAX_MESSAGE })
    expect(parts.length).toBe(2)
    expect(parts.at(-1)).toContain(`— 120 in · 30 out · $0.00042 · ${MODEL}`)
  })

  it('DM and group conversations keep separate modes', async () => {
    const usage = createUsageHook()
    const dm = messageEvent('telegram', '/usage full', 'owner-1')
    const group = { ...dm, channel: { id: 'group-1', type: 'group' } } as MessageEvent
    await usage.hook.pre_inbound!({ event: dm } as never)
    expect(usage.modeFor(dm)).toBe('full')
    expect(usage.modeFor(group)).toBe('off')
  })
})
