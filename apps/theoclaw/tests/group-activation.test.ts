import { GatewayRunner } from '@theokit/gateway'
import type { GatewayHook, MessageEvent, PlatformName } from '@theokit/gateway'
import { normalizeSlackEvent } from '@theokit/gateway-slack'
import { WhatsAppAdapter } from '@theokit/gateway-whatsapp'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { adapterBuilders } from '../src/channels/adapter-factory.js'
import { createGroupActivationHook } from '../src/channels/group-activation-hook.js'
import type { ConfiguredPlatform } from '../src/channels/platforms.js'
import { FakeAdapter, messageEvent, waitFor } from './fakes.js'

const MENTION_GATED: readonly ConfiguredPlatform[] = [
  { platform: 'telegram', settings: { token: 'placeholder-token' } },
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

/** The `requireMention` each of the four gated adapters was built with, read from the adapter. */
function builtRequireMention(requireMention: boolean): unknown[] {
  const from = vi.spyOn(WhatsAppAdapter, 'from')
  const [telegram, slack, mattermost] = adapterBuilders(MENTION_GATED, { requireMention }).map(({ build }) => build() as unknown as Record<string, unknown>)
  for (const { platform, build } of adapterBuilders(MENTION_GATED.filter((entry) => entry.platform === 'whatsapp'), { requireMention })) {
    expect(platform).toBe('whatsapp')
    build()
  }
  const whatsapp = from.mock.calls[0]?.[1]
  from.mockRestore()
  const opts = (adapter: Record<string, unknown> | undefined): Record<string, unknown> => (adapter?.opts ?? {}) as Record<string, unknown>
  return [telegram?.requireMention, opts(slack).requireMention, opts(mattermost).requireMention, whatsapp?.requireMention]
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

/** The owner check composition builds from the policy, here for one owner on one platform. */
function ownerOn(platform: PlatformName): (eventPlatform: string, senderId: string) => boolean {
  return (eventPlatform, senderId) => eventPlatform === platform && senderId === OWNER
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
  it("the shipped slack gateway drops an unmentioned public-channel message and keeps a mentioned one", () => {
    const body = (text: string) =>
      ({ team_id: 'T1', event: { type: 'message', channel: 'C1', channel_type: 'channel', user: 'U1', text, ts: '1.1' } }) as never
    expect(normalizeSlackEvent(body('hello everyone'), 'UBOT', { requireMention: true })).toBeUndefined()
    expect(normalizeSlackEvent(body('<@UBOT> hello'), 'UBOT', { requireMention: true })).toBeDefined()
    expect(normalizeSlackEvent(body('hello everyone'), 'UBOT', { requireMention: false })).toBeDefined()
  })

  it('builds telegram mattermost slack and whatsapp with requireMention under mention', () => {
    expect(builtRequireMention(true)).toEqual([true, true, true, true])
  })

  it('always builds telegram mattermost slack and whatsapp with requireMention false', () => {
    expect(builtRequireMention(false)).toEqual([false, false, false, false])
  })

  it('an owner /activation in a slack group replies that the mode is set at start and changes nothing', async () => {
    const slack = await app('slack', createGroupActivationHook({ isOwner: ownerOn('slack') }))
    await slack.send(group('slack', '/activation always'))
    expect(slack.adapter.sent.map((message) => message.text)).toEqual([
      'Group activation on slack is set at start by THEOCLAW_GROUP_ACTIVATION.',
    ])
    expect(slack.handled()).toBe(0)
    await slack.send(group('slack', 'hello everyone'))
    expect(slack.handled()).toBe(1)
  })

  it('reads an owner /activation that the platform delivers behind a mention of the bot', async () => {
    const slack = await app('slack', createGroupActivationHook({ isOwner: ownerOn('slack') }))
    await slack.send(group('slack', '<@U123BOT> /activation always'))
    const telegram = await app('telegram', createGroupActivationHook({ isOwner: ownerOn('telegram') }))
    await telegram.send(telegramGroup('/activation@theo_bot always'))
    expect(slack.adapter.sent.map((message) => message.text)).toEqual([
      'Group activation on slack is set at start by THEOCLAW_GROUP_ACTIVATION.',
    ])
    expect(telegram.adapter.sent.map((message) => message.text)).toEqual([
      'Group activation on telegram is set at start by THEOCLAW_GROUP_ACTIVATION.',
    ])
    expect(slack.handled() + telegram.handled()).toBe(0)
  })

  it("blocks a paired sender's /activation in silence and lets their other messages through", async () => {
    const telegram = await app('telegram', createGroupActivationHook({ isOwner: ownerOn('telegram') }))
    await telegram.send(telegramGroup('/activation always', 'paired-friend'))
    expect(telegram.adapter.sent).toEqual([])
    expect(telegram.handled()).toBe(0)
    // The mention gate is the Telegram adapter's (`requireMention`), not this hook's.
    await telegram.send(telegramGroup('hello everyone', 'paired-friend'))
    expect(telegram.handled()).toBe(1)
  })

  it('asks the owner check it is given, so a sender that check refuses cannot use the command', async () => {
    const asked: string[] = []
    const isOwner = (platform: string, senderId: string): boolean => {
      asked.push(`${platform}:${senderId}`)
      return false
    }
    const telegram = await app('telegram', createGroupActivationHook({ isOwner }))
    await telegram.send(telegramGroup('/activation always'))
    expect(asked).toEqual([`telegram:${OWNER}`])
    expect(telegram.adapter.sent).toEqual([])
  })
})
