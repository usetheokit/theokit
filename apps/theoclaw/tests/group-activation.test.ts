import { GatewayRunner } from '@theokit/gateway'
import type { GatewayHook, MessageEvent, PlatformName } from '@theokit/gateway'
import { MattermostAdapter } from '@theokit/gateway-mattermost'
import { SlackAdapter } from '@theokit/gateway-slack'
import { WhatsAppAdapter } from '@theokit/gateway-whatsapp'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { adapterBuilders } from '../src/channels/adapter-factory.js'
import { createGroupActivationHook } from '../src/channels/group-activation-hook.js'
import type { ConfiguredPlatform } from '../src/channels/platforms.js'
import { FakeAdapter, messageEvent, waitFor } from './fakes.js'

// The constructors are wrapped, not replaced: each still builds the real adapter, and the test
// reads the options it was given.
vi.mock('@theokit/gateway-slack', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@theokit/gateway-slack')>()
  const SlackAdapter = vi.fn(function (options: ConstructorParameters<typeof actual.SlackAdapter>[0]) {
    return new actual.SlackAdapter(options)
  })
  return { ...actual, SlackAdapter }
})
vi.mock('@theokit/gateway-mattermost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@theokit/gateway-mattermost')>()
  const MattermostAdapter = vi.fn(function (options: ConstructorParameters<typeof actual.MattermostAdapter>[0]) {
    return new actual.MattermostAdapter(options)
  })
  return { ...actual, MattermostAdapter }
})

const MENTION_GATED: readonly ConfiguredPlatform[] = [
  { platform: 'slack', settings: { botToken: 'xoxb-placeholder', appToken: 'xapp-placeholder' } },
  { platform: 'mattermost', settings: { baseUrl: 'https://mattermost.example.org', accessToken: 'x' } },
  { platform: 'whatsapp', settings: { accessToken: 'x', phoneNumberId: '1234', appSecret: 'x', verifyToken: 'x' } },
]

const OWNER = 'owner-1'
const BOT = { username: 'theo_bot', id: 99 }
const runners: GatewayRunner[] = []

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(runners.splice(0).map((runner) => runner.stop()))
})

/** The `requireMention` each of the three gated adapters was built with. */
function builtRequireMention(requireMention: boolean): unknown[] {
  const from = vi.spyOn(WhatsAppAdapter, 'from')
  for (const { build } of adapterBuilders(MENTION_GATED, { requireMention })) build()
  const slack = vi.mocked(SlackAdapter).mock.calls[0]?.[0]
  const mattermost = vi.mocked(MattermostAdapter).mock.calls[0]?.[0]
  const whatsapp = from.mock.calls[0]?.[1]
  from.mockRestore()
  return [slack?.requireMention, mattermost?.requireMention, whatsapp?.requireMention]
}

/** A group message as the Telegram adapter delivers it: the grammy context rides in `telegram.raw`. */
function telegramGroup(text: string, senderId = OWNER, chatId = -100): MessageEvent {
  const event = messageEvent('telegram', text, senderId)
  return {
    ...event,
    channel: { id: String(chatId), type: 'group' },
    telegram: { chatId, messageId: 1, raw: { chat: { id: chatId, type: 'group' }, message: { text }, me: BOT } },
  } as unknown as MessageEvent
}

function group(platform: PlatformName, text: string, senderId = OWNER): MessageEvent {
  return { ...messageEvent(platform, text, senderId), channel: { id: 'group-1', type: 'group' } } as MessageEvent
}

function inflight(runner: GatewayRunner): number {
  return (runner as unknown as { readonly _inflightSize: number })._inflightSize
}

async function app(platform: PlatformName, hook: GatewayHook) {
  const adapter = new FakeAdapter(platform)
  let handled = 0
  const runner = new GatewayRunner({ adapters: [adapter], handler: async () => void (handled += 1), hooks: [hook] })
  runners.push(runner)
  await runner.start()
  return {
    adapter,
    handled: () => handled,
    send: async (event: MessageEvent) => {
      await adapter.deliver(event)
      await waitFor(() => inflight(runner) === 0, 2000, 'the dispatch to settle')
    },
  }
}

describe('group activation', () => {
  it('builds mattermost slack and whatsapp with requireMention under mention', () => {
    expect(builtRequireMention(true)).toEqual([true, true, true])
  })

  it('always builds mattermost slack and whatsapp with requireMention false', () => {
    expect(builtRequireMention(false)).toEqual([false, false, false])
  })

  it('a telegram group message without a mention never reaches the handler under mention', async () => {
    const telegram = await app('telegram', createGroupActivationHook({ owners: new Set([`telegram:${OWNER}`]), mode: 'mention' }))
    await telegram.send(telegramGroup('hello everyone'))
    expect(telegram.handled()).toBe(0)
    await telegram.send(telegramGroup('hello @theo_bot'))
    expect(telegram.handled()).toBe(1)
  })

  it("an owner /activation always lets the group's unmentioned telegram messages through", async () => {
    const telegram = await app('telegram', createGroupActivationHook({ owners: new Set([`telegram:${OWNER}`]), mode: 'mention' }))
    await telegram.send(telegramGroup('/activation always'))
    expect(telegram.adapter.sent.map((message) => message.text)).toEqual(['Group activation is now always.'])
    await telegram.send(telegramGroup('hello everyone'))
    expect(telegram.handled()).toBe(1)
    // Another group keeps the start-time mode.
    await telegram.send(telegramGroup('hello everyone', OWNER, -200))
    expect(telegram.handled()).toBe(1)
  })

  it('an owner /activation in a slack group replies that the mode is set at start and changes nothing', async () => {
    const slack = await app('slack', createGroupActivationHook({ owners: new Set([`slack:${OWNER}`]), mode: 'mention' }))
    await slack.send(group('slack', '/activation always'))
    expect(slack.adapter.sent.map((message) => message.text)).toEqual([
      'Group activation on slack is set at start by THEOCLAW_GROUP_ACTIVATION.',
    ])
    expect(slack.handled()).toBe(0)
    await slack.send(group('slack', 'hello everyone'))
    expect(slack.handled()).toBe(1)
  })

  it('reads an owner /activation that the platform delivers behind a mention of the bot', async () => {
    const slack = await app('slack', createGroupActivationHook({ owners: new Set([`slack:${OWNER}`]), mode: 'mention' }))
    await slack.send(group('slack', '<@U123BOT> /activation always'))
    const telegram = await app('telegram', createGroupActivationHook({ owners: new Set([`telegram:${OWNER}`]), mode: 'mention' }))
    await telegram.send(telegramGroup('/activation@theo_bot always'))
    expect(slack.adapter.sent.map((message) => message.text)).toEqual([
      'Group activation on slack is set at start by THEOCLAW_GROUP_ACTIVATION.',
    ])
    expect(telegram.adapter.sent.map((message) => message.text)).toEqual(['Group activation is now always.'])
    expect(slack.handled() + telegram.handled()).toBe(0)
  })

  it('answers a malformed owner /activation with its usage and never reaches the handler', async () => {
    const telegram = await app('telegram', createGroupActivationHook({ owners: new Set([`telegram:${OWNER}`]), mode: 'mention' }))
    await telegram.send(telegramGroup('/activation always now'))
    await telegram.send(telegramGroup('/activation'))
    expect(telegram.adapter.sent.map((message) => message.text)).toEqual([
      'Use /activation mention or /activation always.',
      'Use /activation mention or /activation always.',
    ])
    expect(telegram.handled()).toBe(0)
  })

  it("blocks a paired sender's /activation in silence", async () => {
    const telegram = await app('telegram', createGroupActivationHook({ owners: new Set([`telegram:${OWNER}`]), mode: 'mention' }))
    await telegram.send(telegramGroup('/activation always', 'paired-friend'))
    await telegram.send(telegramGroup('hello everyone', 'paired-friend'))
    expect(telegram.adapter.sent).toEqual([])
    expect(telegram.handled()).toBe(0)
  })
})
