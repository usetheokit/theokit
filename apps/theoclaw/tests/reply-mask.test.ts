import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BasePlatformAdapter, GatewayContext, MessageEvent, PlatformName } from '@theokit/gateway'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { createBroadcastGroups } from '../src/channels/broadcast-groups.js'
import { createReplyHandler } from '../src/channels/reply-handler.js'
import type { TurnAgent } from '../src/channels/reply-handler.js'
import { startTheoClaw } from '../src/composition.js'
import { createControlSessions } from '../src/control-plane/control-sessions.js'
import { createEventMask } from '../src/control-plane/event-mask.js'
import type { ControlPlaneHandle } from '../src/control-plane/listener.js'
import { runTheoClawTurn, type TurnEvent } from '../src/control-plane/turn.js'
import { capturingStream, fakeBuilders, OPEN_DMS } from './composition-fixtures.js'
import { FakeAdapter, FakeAgent, assistant, finished, messageEvent, turnText, waitFor } from './fakes.js'

/** Three configured values, as `processSecrets` would list them. */
const VALUES = ['bearer-token-0123456789abcdef0123456789ab', 'sk-or-model-key-ABCDEFGHIJ', 'tg-123456:telegram-token-value']

function occurrences(text: string, values: readonly string[]): number {
  return values.reduce((count, value) => count + text.split(value).length - 1, 0)
}

/** An agent whose answer, and its earlier turns' answers, carry every configured value. */
function leakingAgent(prompts: string[] = []): TurnAgent {
  return new FakeAgent({
    frames: (text) => {
      prompts.push(text)
      return [assistant(`here they are: ${VALUES.join(' and ')}`), finished()]
    },
  }) as unknown as TurnAgent
}

const TOOL_CWD = mkdtempSync(join(tmpdir(), 'theoclaw-reply-mask-'))
afterAll(() => rmSync(TOOL_CWD, { recursive: true, force: true }))
const running: ControlPlaneHandle[] = []
afterEach(async () => {
  for (const app of running.splice(0)) await app.close()
})

describe('the chat reply mask', () => {
  it('a chat reply carries no configured value', async () => {
    const event = messageEvent('telegram', 'show me your keys')
    const replies: string[] = []
    const ctx: GatewayContext = {
      event,
      reply: async (text) => {
        replies.push(text)
        return { ok: true, messageId: 'm-1' }
      },
    }

    await createReplyHandler({
      reset: async () => undefined,
      withAgent: async (_event, work) => work({ agent: leakingAgent(), release: () => undefined }),
      secrets: VALUES,
    })(event, ctx)

    expect(replies).toHaveLength(1)
    expect(occurrences(replies[0] ?? '', VALUES)).toBe(0)
    expect(replies[0]).toContain('[redacted]')
  })

  it.each(['telegram', 'slack', 'whatsapp'] as const)(
    'a configured value holding a rendering marker pair is masked in a %s reply',
    async (platform) => {
      // Each renders differently once a platform's dialect rewrites its marker pair (LCR #78).
      const marked = ['Ab**cd**ef9_long', 'Zk3-_q9_-Lm2Np', 'Qr~~st~~uv7_word']
      const rendered = ['Abcdef9_long', 'Ab*cd*ef9_long', 'Zk3-q9-Lm2Np', 'Qrstuv7_word', 'Qr~st~uv7_word']
      const event = messageEvent(platform, 'show me your keys')
      const replies: string[] = []
      const ctx: GatewayContext = {
        event,
        reply: async (text) => {
          replies.push(text)
          return { ok: true, messageId: 'm-1' }
        },
      }
      // The first value arrives split across two frames, so the hold-back is crossed too.
      const agent = new FakeAgent({
        frames: [assistant('one: Ab**cd'), assistant(`**ef9_long two: ${marked[1]} three: ${marked[2]}`), finished()],
      }) as unknown as TurnAgent

      await createReplyHandler({
        reset: async () => undefined,
        withAgent: async (_event, work) => work({ agent, release: () => undefined }),
        secrets: marked,
      })(event, ctx)

      expect(replies).toHaveLength(1)
      expect(occurrences(replies[0] ?? '', marked)).toBe(0)
      expect(occurrences(replies[0] ?? '', rendered)).toBe(0)
      expect(replies[0]).toContain('[redacted]')
    },
  )

  it('a broadcast member and the group thread carry no configured value', async () => {
    const telegram = new FakeAdapter('telegram')
    const discord = new FakeAdapter('discord')
    const adapters = new Map<PlatformName, FakeAdapter>([
      ['telegram', telegram],
      ['discord', discord],
    ])
    const groups = createBroadcastGroups([
      {
        name: 'home',
        members: [
          { platform: 'telegram', channelId: 'tg-chat' },
          { platform: 'discord', channelId: 'dc-channel' },
        ],
      },
    ])
    const prompts: string[] = []
    const handler = createReplyHandler({
      reset: async () => undefined,
      withAgent: async (_event, work) => work({ agent: leakingAgent(prompts), release: () => undefined }),
      broadcast: {
        groups,
        adapterFor: (platform) => adapters.get(platform as PlatformName) as BasePlatformAdapter | undefined,
        write: () => undefined,
      },
      secrets: VALUES,
    })
    const deliver = (platform: PlatformName, channelId: string, text: string): Promise<void> => {
      const event = { ...messageEvent(platform, text, 'owner'), channel: { id: channelId, type: 'group' } } as MessageEvent
      const origin = adapters.get(platform)!
      return handler(event, { event, reply: (reply, opts) => origin.sendMessage({ channel: event.channel, text: reply, ...opts }) })
    }

    await deliver('telegram', 'tg-chat', `first question, my key is ${VALUES[1]}`)
    await deliver('discord', 'dc-channel', 'second question')

    // The other member got the first answer, and the second turn's prompt carried the thread.
    expect(discord.sent.length).toBeGreaterThanOrEqual(2)
    expect(occurrences(discord.sent.map((message) => message.text).join('\n'), VALUES)).toBe(0)
    expect(occurrences(telegram.sent.map((message) => message.text).join('\n'), VALUES)).toBe(0)
    expect(prompts[1]).toContain('[redacted]')
    expect(occurrences(prompts[1] ?? '', VALUES)).toBe(0)
  })

  it('the reply mask and the output mask hold the same values', async () => {
    const env = { ...OPEN_DMS, OPENROUTER_API_KEY: VALUES[1], THEOCLAW_TELEGRAM_TOKEN: VALUES[2], THEOCLAW_CONTROL_TOKEN: VALUES[0] }
    const { adapters, builders } = fakeBuilders()
    const stream = capturingStream()
    const app = await startTheoClaw({
      cwd: TOOL_CWD,
      env: { ...env, THEOCLAW_WORKSPACE: mkdtempSync(join(TOOL_CWD, 'ws-')) },
      agentFactory: () => leakingAgent(),
      getOrCreate: async () => Object.assign(leakingAgent(), { dispose: async () => undefined }) as never,
      builders,
      signals: new EventEmitter(),
      exit: () => undefined,
      streams: [stream],
    })
    running.push(app)
    await app.loop.ready
    const telegram = adapters.get('telegram')!

    await telegram.deliver(messageEvent('telegram', 'show me your keys'))
    await waitFor(() => telegram.sent.length === 1, 2000, 'the chat reply')
    for (const value of VALUES) stream.write(`${value}\n`)

    expect(occurrences(telegram.sent[0]?.text ?? '', VALUES)).toBe(0)
    expect(occurrences(stream.text(), VALUES)).toBe(0)
    // The control token is not a chat credential: only one list for both masks hides it in a reply.
    expect(telegram.sent[0]?.text.split('[redacted]')).toHaveLength(VALUES.length + 1)
  })
})

/** FR-007 (B-398): every event a `/control` turn or a session turn emits. */
describe('the /control and session event mask', () => {
  const SECRET = VALUES[1]!
  const HALF = 12

  /** The text the client would render, from the deltas in order. */
  const deltaText = (events: readonly TurnEvent[]): string =>
    events.flatMap((event) => (event.type === 'text_delta' ? [event.content] : [])).join('')

  it("a control turn's deltas carry no configured value", async () => {
    const agent = new FakeAgent({ frames: [assistant(`key: ${SECRET.slice(0, HALF)}`), assistant(`${SECRET.slice(HALF)} end`), finished()] })
    const events: TurnEvent[] = []

    const outcome = await runTheoClawTurn({
      withAgent: (work) => work(agent as unknown as TurnAgent),
      message: 'show me the key',
      runId: 'run-1',
      emit: (event) => void events.push(event),
      secrets: VALUES,
    })

    expect(outcome).toEqual({ ok: true })
    expect(deltaText(events)).toBe('key: [redacted] end')
    expect(occurrences(JSON.stringify(events), VALUES)).toBe(0)
  })

  it("a session turn's deltas carry no configured value", async () => {
    const sessions = createControlSessions({
      build: async () => new FakeAgent({ frames: [finished()], deltas: [`key: ${SECRET.slice(0, HALF)}`, `${SECRET.slice(HALF)} end`] }) as unknown as TurnAgent,
      report: () => undefined,
      secrets: VALUES,
    })
    const events: TurnEvent[] = []

    const outcome = await sessions.run('s1', 'show me the key', (event) => void events.push(event), {})
    await sessions.close()

    expect(outcome).toEqual({ ok: true })
    expect(deltaText(events)).toBe('key: [redacted] end')
    expect(occurrences(JSON.stringify(events), VALUES)).toBe(0)
  })

  it('held text is released before a tool_call event, in order (EC-2)', () => {
    const events: TurnEvent[] = []
    const mask = createEventMask(VALUES, (event) => void events.push(event))

    mask.emit({ type: 'text_delta', content: `reading ${SECRET.slice(0, HALF)}` })
    mask.emit({ type: 'tool_call', callId: 'c1', toolName: 'read_file', input: { path: 'a.txt' } })
    mask.flush()

    expect(events.map((event) => event.type)).toEqual(['text_delta', 'text_delta', 'tool_call'])
    expect(deltaText(events)).toBe(`reading ${SECRET.slice(0, HALF)}`)
  })

  it('a value split across a delta, a tool_call and a delta is released as two fragments in order, and a value whole inside either text block holds 0 occurrences (EC-3)', () => {
    const events: TurnEvent[] = []
    const mask = createEventMask(VALUES, (event) => void events.push(event))

    mask.emit({ type: 'text_delta', content: `${SECRET} then ${SECRET.slice(0, HALF)}` })
    mask.emit({ type: 'tool_call', callId: 'c1', toolName: 'read_file', input: {} })
    mask.emit({ type: 'text_delta', content: `${SECRET.slice(HALF)} and ${SECRET}` })
    mask.flush()

    expect(events.map((event) => event.type)).toEqual(['text_delta', 'text_delta', 'tool_call', 'text_delta'])
    const before = deltaText(events.slice(0, 2))
    const after = deltaText(events.slice(3))
    expect(before).toBe(`[redacted] then ${SECRET.slice(0, HALF)}`)
    expect(after).toBe(`${SECRET.slice(HALF)} and [redacted]`)
  })

  it('a value nested two levels deep in a tool_call input is masked and the shape kept (EC-5)', () => {
    const events: TurnEvent[] = []
    const mask = createEventMask(VALUES, (event) => void events.push(event))

    mask.emit({ type: 'tool_call', callId: 'c1', toolName: 'http', input: { headers: { authorization: `Bearer ${VALUES[0]}` }, list: [VALUES[2], 3, true] } })

    expect(events).toEqual([
      { type: 'tool_call', callId: 'c1', toolName: 'http', input: { headers: { authorization: 'Bearer [redacted]' }, list: ['[redacted]', 3, true] } },
    ])
  })

  it("a failed turn's reason, which WebChat sends to the client, carries no configured value", async () => {
    const throwing: TurnAgent = { send: () => Promise.reject(new Error(`provider refused key ${SECRET}`)) }

    const outcome = await runTheoClawTurn({ withAgent: (work) => work(throwing), message: 'hi', runId: 'run-1', emit: () => undefined, secrets: VALUES })

    expect(outcome).toMatchObject({ ok: false, code: 'turn_failed' })
    expect(JSON.stringify(outcome)).toContain('provider refused key [redacted]')
    expect(occurrences(JSON.stringify(outcome), VALUES)).toBe(0)
  })

  it('a turn aborted while a prefix is held emits nothing after the abort', async () => {
    const controller = new AbortController()
    const events: TurnEvent[] = []
    const agent = new FakeAgent({ frames: [assistant(`hello ${SECRET.slice(0, HALF)}`), assistant('never sent')], afterDeltas: undefined, before: undefined })
    const gated: TurnAgent = {
      send: async (text, options) => {
        const run = await agent.send(turnText(text), options)
        return {
          ...run,
          async *stream() {
            for await (const frame of run.stream()) {
              yield frame
              // The first frame is out; the turn is cancelled before the next one is read.
              controller.abort()
              await new Promise((resolve) => setTimeout(resolve, 0))
            }
          },
        }
      },
    }

    const outcome = await runTheoClawTurn({
      withAgent: (work) => work(gated),
      message: 'hi',
      runId: 'run-1',
      emit: (event) => void events.push(event),
      signal: controller.signal,
      secrets: VALUES,
    })

    expect(outcome).toMatchObject({ ok: false, code: 'turn_cancelled' })
    expect(deltaText(events)).toBe('hello ')
    expect(JSON.stringify(events)).not.toContain(SECRET.slice(0, HALF))
  })
})
