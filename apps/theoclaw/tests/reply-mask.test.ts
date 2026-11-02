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
import type { ControlPlaneHandle } from '../src/control-plane/listener.js'
import { capturingStream, fakeBuilders, OPEN_DMS } from './composition-fixtures.js'
import { FakeAdapter, FakeAgent, assistant, finished, messageEvent, waitFor } from './fakes.js'

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
