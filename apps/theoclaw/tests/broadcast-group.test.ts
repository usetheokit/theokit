import type { BasePlatformAdapter, GatewayContext, MessageEvent, PlatformName, SendResult } from '@theokit/gateway'
import { describe, expect, it } from 'vitest'

import type { BroadcastGroupConfig } from '../src/channels/broadcast-groups.js'
import { AgentTurnError, createReplyHandler } from '../src/channels/reply-handler.js'
import type { TurnAgent } from '../src/channels/reply-handler.js'
import { FakeAdapter, FakeAgent, assistant, finished, messageEvent } from './fakes.js'

const HOME: BroadcastGroupConfig = {
  name: 'home',
  members: [
    { platform: 'telegram', channelId: 'tg-chat' },
    { platform: 'discord', channelId: 'dc-channel' },
  ],
}

/** An event from `platform` in the member channel `channelId`. */
function inChannel(platform: PlatformName, channelId: string, text: string): MessageEvent {
  return { ...messageEvent(platform, text, 'owner'), channel: { id: channelId, type: 'group' } } as MessageEvent
}

/**
 * A reply handler over broadcast groups, with one in-memory adapter per platform and an agent that
 * answers "answer to <prompt's last line>" and records every prompt it was sent.
 */
function setup(config: readonly BroadcastGroupConfig[], options: { failTurns?: boolean; adapters?: FakeAdapter[] } = {}) {
  const adapters = new Map<PlatformName, FakeAdapter>(
    (options.adapters ?? [new FakeAdapter('telegram'), new FakeAdapter('discord')]).map((adapter) => [adapter.platform, adapter]),
  )
  const prompts: string[] = []
  const lines: string[] = []
  const handler = createReplyHandler({
    reset: async () => undefined,
    withAgent: async (_event, work) =>
      work({
        agent: new FakeAgent({
          frames: (text) => {
            prompts.push(text)
            return [assistant(`answer to ${text.split('\n').at(-1)}`), finished()]
          },
          ...(options.failTurns ? { result: { status: 'error', error: { code: 'MODEL_DOWN' } } } : {}),
        }) as unknown as TurnAgent,
        agentId: 'a-1',
        release: () => undefined,
      }),
    broadcast: {
      groups: config,
      adapterFor: (platform) => adapters.get(platform as PlatformName) as BasePlatformAdapter | undefined,
      write: (line) => void lines.push(line),
    },
  })
  const deliver = (event: MessageEvent): Promise<void> => {
    const origin = adapters.get(event.platform as PlatformName)
    const ctx: GatewayContext = {
      event,
      reply: (text, opts) => origin?.sendMessage({ channel: event.channel, text, ...opts }) ?? Promise.resolve({ ok: false }),
    }
    return handler(event, ctx)
  }
  const sent = (platform: PlatformName) => adapters.get(platform)?.sent.map((message) => [message.channel.id, message.text])
  return { prompts, lines, deliver, sent }
}

describe('broadcast groups', () => {
  it('one broadcast group carries a single agent thread across two channels', async () => {
    const app = setup([HOME])
    await app.deliver(inChannel('telegram', 'tg-chat', 'first question'))
    await app.deliver(inChannel('discord', 'dc-channel', 'second question'))

    expect(app.prompts[0]).toBe('first question')
    expect(app.prompts[1]).toContain('first question')
    expect(app.prompts[1]).toContain('answer to first question')
    expect(app.prompts[1]?.endsWith('New message:\nsecond question')).toBe(true)
    expect(app.sent('telegram')).toEqual([
      ['tg-chat', 'answer to first question'],
      ['tg-chat', 'answer to second question'],
    ])
    expect(app.sent('discord')).toEqual([
      ['dc-channel', 'answer to first question'],
      ['dc-channel', 'answer to second question'],
    ])
  })

  it('a channel outside every group gets one reply and no transcript', async () => {
    const app = setup([HOME])
    await app.deliver(inChannel('telegram', 'elsewhere', 'hello'))
    await app.deliver(inChannel('telegram', 'elsewhere', 'again'))
    expect(app.prompts).toEqual(['hello', 'again'])
    expect(app.sent('discord')).toEqual([])
  })

  it('keeps at most 20 turns (10 exchanges) and 16384 characters', async () => {
    const app = setup([HOME])
    for (let n = 0; n < 12; n += 1) await app.deliver(inChannel('telegram', 'tg-chat', `question ${n}`))
    const last = app.prompts.at(-1) ?? ''
    expect(last).not.toContain('question 0\n')
    expect(last).toContain('question 1\n')
    expect(last).toContain('answer to question 10')
    // 10 exchanges are 20 turns: 10 questions and 10 answers.
    expect(last.match(/^User: question \d+$/gm) ?? []).toHaveLength(10)
    expect(last.match(/^Assistant: answer to question \d+$/gm) ?? []).toHaveLength(10)

    const big = setup([HOME])
    for (let n = 0; n < 3; n += 1) await big.deliver(inChannel('discord', 'dc-channel', `${'q'.repeat(6000)}${n}`))
    await big.deliver(inChannel('discord', 'dc-channel', 'final'))
    const prompt = big.prompts.at(-1) ?? ''
    expect(prompt.length).toBeLessThanOrEqual(16_384 + 'Conversation so far:\n\n\nNew message:\nfinal'.length)
    expect(prompt).toContain('final')
    // The oldest big message was dropped, the newest kept.
    expect(prompt).not.toContain(`${'q'.repeat(6000)}0`)
    expect(prompt).toContain(`${'q'.repeat(6000)}2`)
  })

  it('a failed member send leaves the other members and the transcript intact', async () => {
    let refusals = 0
    const line = new FakeAdapter('line', {
      send: async (): Promise<SendResult> => {
        refusals += 1
        if (refusals === 1) return { ok: false, error: { code: 'RATE_LIMITED', message: 'slow down' } } as SendResult
        throw new Error('socket closed')
      },
    })
    const three: BroadcastGroupConfig = { name: 'home', members: [...HOME.members, { platform: 'line', channelId: 'U-line' }] }
    const app = setup([three], { adapters: [new FakeAdapter('telegram'), new FakeAdapter('discord'), line] })
    await app.deliver(inChannel('telegram', 'tg-chat', 'first question'))
    await app.deliver(inChannel('telegram', 'tg-chat', 'second question'))

    expect(app.sent('discord')).toEqual([
      ['dc-channel', 'answer to first question'],
      ['dc-channel', 'answer to second question'],
    ])
    expect(app.lines).toHaveLength(2)
    await app.deliver(inChannel('telegram', 'tg-chat', 'third question'))
    expect(app.prompts.at(-1)).toContain('answer to second question')
    for (const entry of app.lines) {
      expect(entry).toContain('home')
      expect(entry).toContain('line')
      expect(entry).not.toContain('owner')
    }
  })

  it('a failed turn leaves the transcript unchanged', async () => {
    const app = setup([HOME], { failTurns: true })
    await expect(app.deliver(inChannel('telegram', 'tg-chat', 'first question'))).rejects.toThrow(AgentTurnError)
    expect(app.prompts).toEqual(['first question'])
    // The failed turn still sends its one reply, the error sentence, to its origin.
    expect(app.sent('telegram')).toEqual([['tg-chat', 'Something went wrong on my side and I could not finish that.']])
    // The failed turn's own reply goes to its origin only, never to the other members.
    expect(app.sent('discord')).toEqual([])
  })

  it('a turn after a failed one in the same group still runs, on an empty transcript', async () => {
    let failNext = true
    const prompts: string[] = []
    const discord = new FakeAdapter('discord')
    const handler = createReplyHandler({
      reset: async () => undefined,
      withAgent: async (_event, work) => {
        const fail = failNext
        failNext = false
        return work({
          agent: new FakeAgent({
            frames: (text) => {
              prompts.push(text)
              return [assistant('an answer'), finished()]
            },
            ...(fail ? { result: { status: 'error', error: { code: 'MODEL_DOWN' } } } : {}),
          }) as unknown as TurnAgent,
          release: () => undefined,
        })
      },
      broadcast: { groups: [HOME], adapterFor: (platform) => (platform === 'discord' ? discord : undefined), write: () => undefined },
    })
    const event = inChannel('telegram', 'tg-chat', 'hello')
    const ctx: GatewayContext = { event, reply: async () => ({ ok: true }) }
    await handler(event, ctx).catch(() => undefined)
    await handler(event, ctx)
    expect(prompts).toEqual(['hello', 'hello'])
    await handler(event, ctx)
    expect(prompts[2]).toContain('an answer')
    expect(discord.sent.map((message) => message.text)).toEqual(['an answer', 'an answer'])
  })

  it('two member channels delivering at once keep both exchanges in delivery order', async () => {
    const app = setup([HOME])
    await Promise.all([
      app.deliver(inChannel('telegram', 'tg-chat', 'first question')),
      app.deliver(inChannel('discord', 'dc-channel', 'second question')),
    ])
    expect(app.prompts[1]).toContain('answer to first question')
  })

  it('the usage footer goes to the origin only, never to the other members or the thread', async () => {
    const telegram = new FakeAdapter('telegram')
    const discord = new FakeAdapter('discord')
    const prompts: string[] = []
    const handler = createReplyHandler({
      reset: async () => undefined,
      withAgent: async (_event, work) =>
        work({
          agent: new FakeAgent({
            frames: (text) => (prompts.push(text), [assistant('an answer'), finished()]),
            result: { status: 'finished', usage: { inputTokens: 5, outputTokens: 2 } },
          }) as unknown as TurnAgent,
          release: () => undefined,
        }),
      usage: { modeFor: () => 'tokens', model: 'm', write: () => undefined },
      broadcast: { groups: [HOME], adapterFor: (platform) => (platform === 'discord' ? discord : undefined), write: () => undefined },
    })
    const event = inChannel('telegram', 'tg-chat', 'hello')
    const ctx: GatewayContext = { event, reply: (text, opts) => telegram.sendMessage({ channel: event.channel, text, ...opts }) }
    await handler(event, ctx)
    await handler(event, ctx)
    expect(telegram.sent[0]?.text).toMatch(/an answer\n\n.+/)
    expect(discord.sent.map((message) => message.text)).toEqual(['an answer', 'an answer'])
    expect(prompts[1]).toContain('an answer')
    expect(prompts[1]).toContain('Assistant: an answer\n\nNew message:')
  })
})
