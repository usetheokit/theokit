import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { WhatsAppAdapter } from '@theokit/gateway-whatsapp'

import { adapterBuilders } from '../src/channels/adapter-factory.js'
import type { ConfiguredPlatform } from '../src/channels/platforms.js'

/** A service-account key file with a placeholder key: the adapter only reads it at construction. */
function keyFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'gchat-')), 'sa.json')
  writeFileSync(path, JSON.stringify({ client_email: 'bot@p.iam.gserviceaccount.com', private_key: 'x' }))
  return path
}

/** Placeholder settings each adapter accepts at construction; no test here ever connects. */
const PLACEHOLDERS: readonly ConfiguredPlatform[] = [
  { platform: 'telegram', settings: { token: 'placeholder-token' } },
  { platform: 'discord', settings: { token: 'placeholder-token' } },
  { platform: 'slack', settings: { botToken: 'xoxb-placeholder', appToken: 'xapp-placeholder' } },
  {
    platform: 'matrix',
    settings: {
      homeserverUrl: 'https://matrix.example.org',
      accessToken: 'x',
      userId: '@bot:example.org',
    },
  },
  {
    platform: 'mattermost',
    settings: { baseUrl: 'https://mattermost.example.org', accessToken: 'x' },
  },
  {
    platform: 'email',
    settings: {
      address: 'bot@example.org',
      password: 'x',
      imapHost: 'imap.example.org',
      smtpHost: 'smtp.example.org',
    },
  },
  { platform: 'line', settings: { channelSecret: 'x', channelAccessToken: 'x' } },
  {
    platform: 'whatsapp',
    settings: { accessToken: 'x', phoneNumberId: '1234', appSecret: 'x', verifyToken: 'x' },
  },
  { platform: 'teams', settings: { clientId: 'x', clientSecret: 'x', tenantId: 'x' } },
  { platform: 'google_chat', settings: { serviceAccountFile: keyFile(), audience: 'https://example.org/webhooks/google_chat' } },
  { platform: 'signal', settings: { account: '+5511999990000' } },
  { platform: 'imessage', settings: {} },
  { platform: 'raft', settings: {} },
  {
    platform: 'x',
    settings: { userId: '1', username: 'bot', clientId: 'x', clientSecret: 'x', refreshToken: 'x', allowFrom: ['alice'] },
  },
  {
    platform: 'sms',
    settings: {
      accountSid: 'AC-x',
      authToken: 'x',
      fromNumber: '+15550000000',
      publicUrl: 'https://example.org/webhooks/sms',
    },
  },
]

describe('adapterBuilders', () => {
  it('builds one adapter per platform with its platform name', () => {
    const builders = adapterBuilders(PLACEHOLDERS)

    expect(builders.map((entry) => entry.platform)).toEqual(
      PLACEHOLDERS.map((entry) => entry.platform),
    )
    for (const { platform, build } of builders) expect(build().platform).toBe(platform)
  })

  it('builds WhatsApp on the Cloud backend', () => {
    const [whatsapp] = adapterBuilders(
      PLACEHOLDERS.filter((entry) => entry.platform === 'whatsapp'),
    )
    const adapter = whatsapp?.build()

    expect(adapter).toBeInstanceOf(WhatsAppAdapter)
    expect((adapter as WhatsAppAdapter).getBackend().kind).toBe('cloud')
  })

  it('builds nothing until a builder is called', () => {
    const builders = adapterBuilders([
      { platform: 'matrix', settings: { homeserverUrl: 'x', accessToken: 'x', userId: 'bot' } },
    ])

    expect(builders).toHaveLength(1)
    expect(() => builders[0]?.build()).toThrow(/user/i)
  })
})

describe('GuardedSlackAdapter', () => {
  it('reports a Slack credential rejection instead of letting it crash the process', async () => {
    const { GuardedSlackAdapter, isSlackPlatformError } =
      await import('../src/channels/adapter-factory.js')
    const before = process.listenerCount('unhandledRejection')
    const adapter = new GuardedSlackAdapter({ botToken: 'xoxb-fake', appToken: 'xapp-fake' })
    vi.spyOn(Object.getPrototypeOf(GuardedSlackAdapter.prototype), 'connect').mockResolvedValue(
      false,
    )
    expect(await adapter.connect()).toBe(false)
    expect(process.listenerCount('unhandledRejection')).toBe(before + 1)
    const err = Object.assign(new Error('An API error occurred: invalid_auth'), {
      code: 'slack_webapi_platform_error',
    })
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const listener = process.listeners('unhandledRejection').at(-1) as (r: unknown) => void
    listener(err)
    expect(write).toHaveBeenCalledWith(expect.stringContaining('slack: connect failed'))
    expect(() => listener(new Error('other'))).toThrow('other')
    expect(isSlackPlatformError(err)).toBe(true)
    vi.restoreAllMocks()
  })
})

describe('signal sender id', () => {
  it('hands the handler the phone number, not the UUID, so signal:+number owners match', async () => {
    const { NumberKeyedSignalAdapter } = await import('../src/channels/adapter-factory.js')
    const adapter = new NumberKeyedSignalAdapter({ account: '+5511999990000' })
    const seen: string[] = []
    adapter.onInbound(async (event) => {
      seen.push(event.sender.id)
    })
    await adapter.deliver({
      id: 'u:1',
      platform: 'signal',
      sender: { id: 'uuid-1' },
      channel: { id: '+5511888880000' },
      text: 'Responda só: pong',
      receivedAt: 1,
      signal: { timestamp: 1, sourceNumber: '+5511888880000', sourceUuid: 'uuid-1', raw: {} },
    } as never)
    expect(seen).toEqual(['+5511888880000'])
  })
})
