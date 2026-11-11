import type { BasePlatformAdapter, GatewayContext, MessageEvent, PlatformName, SendResult } from '@theokit/gateway'
import { describe, expect, it } from 'vitest'

import { createBroadcastGroups } from '../src/channels/broadcast-groups.js'
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
  const groups = createBroadcastGroups(config)
  const handler = createReplyHandler({
    reset: async () => undefined,
    withAgent: async (_event, work) =>
      work({
        agent: new FakeAgent({
          frames: (text) => {
            prompts.push(text)
            return [assistant(`answer to ${text.split('\n').at(-1)?.replace(/^Now: /, '') ?? ''}`), finished()]
          },
          ...(options.failTurns ? { result: { status: 'error', error: { code: 'MODEL_DOWN' } } } : {}),
        }) as unknown as TurnAgent,
        release: () => undefined,
      }),
    broadcast: {
      groups,
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
  return { groups, prompts, lines, deliver, sent }
}

describe('broadcast groups', () => {
  it('one broadcast group carries a single agent thread across two channels', async () => {
    const app = setup([HOME])
    await app.deliver(inChannel('telegram', 'tg-chat', 'first question'))
    await app.deliver(inChannel('discord', 'dc-channel', 'second question'))

    expect(app.prompts[0]).toBe('first question')
    expect(app.prompts[1]).toContain('first question')
    expect(app.prompts[1]).toContain('answer to first question')
    expect(app.prompts[1]?.endsWith('Now: second question')).toBe(true)
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

  it('keeps at most 20 turns and 16384 characters', () => {
    const group = createBroadcastGroups([HOME]).groupOf('telegram', 'tg-chat')
    for (let n = 0; n < 15; n += 1) group?.record('telegram', `question ${n}`, `answer ${n}`)
    expect(group?.transcript()).toHaveLength(20)
    expect(group?.transcript()[0]?.text).toBe('question 5')
    for (let n = 0; n < 3; n += 1) group?.record('discord', 'q'.repeat(6000), 'a'.repeat(100))
    const total = group?.transcript().reduce((sum, turn) => sum + turn.text.length, 0) ?? Infinity
    expect(total).toBeLessThanOrEqual(16_384)
    expect(group?.transcript().at(-1)?.text).toBe('a'.repeat(100))
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
    expect(app.groups.groupOf('telegram', 'tg-chat')?.transcript()).toHaveLength(4)
    expect(app.lines).toHaveLength(2)
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
    // The failed turn still sends its one reply, what it streamed before failing, to its origin.
    expect(app.sent('telegram')).toEqual([['tg-chat', 'answer to first question']])
    expect(app.groups.groupOf('telegram', 'tg-chat')?.transcript()).toEqual([])
    // The failed turn's own reply goes to its origin only, never to the other members.
    expect(app.sent('discord')).toEqual([])
  })

  it('a turn after a failed one in the same group still runs, on an empty transcript', async () => {
    let failNext = true
    const groups = createBroadcastGroups([HOME])
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
      broadcast: { groups, adapterFor: (platform) => (platform === 'discord' ? discord : undefined), write: () => undefined },
    })
    const event = inChannel('telegram', 'tg-chat', 'hello')
    const ctx: GatewayContext = { event, reply: async () => ({ ok: true }) }
    await handler(event, ctx).catch(() => undefined)
    await handler(event, ctx)
    expect(prompts).toEqual(['hello', 'hello'])
    expect(groups.groupOf('telegram', 'tg-chat')?.transcript().map((turn) => turn.text)).toEqual(['hello', 'an answer'])
    expect(discord.sent.map((message) => message.text)).toEqual(['an answer'])
  })

  it('two member channels delivering at once keep both exchanges in delivery order', async () => {
    const app = setup([HOME])
    await Promise.all([
      app.deliver(inChannel('telegram', 'tg-chat', 'first question')),
      app.deliver(inChannel('discord', 'dc-channel', 'second question')),
    ])
    expect(app.groups.groupOf('discord', 'dc-channel')?.transcript().map((turn) => turn.text)).toEqual([
      'first question',
      'answer to first question',
      'second question',
      'answer to second question',
    ])
    expect(app.prompts[1]).toContain('answer to first question')
  })
})
