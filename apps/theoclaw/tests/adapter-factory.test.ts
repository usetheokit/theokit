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
    settings: { userId: '1', username: 'bot', clientId: 'x', clientSecret: 'x', refreshToken: 'x', allowFrom: 'alice' },
  },
  { platform: 'wechat', settings: { appId: 'x', appSecret: 'x', token: 'x' } },
  {
    platform: 'wecom',
    settings: { corpId: 'x', corpSecret: 'x', agentId: '1000002', token: 'x', encodingAesKey: 'a'.repeat(43) },
  },
  { platform: 'yuanbao', settings: { appId: 'x', appSecret: 'x', callbackSecret: 'x' } },
  { platform: 'qq', settings: { appId: 'x', appSecret: 'x' } },
  { platform: 'zalo', settings: { appId: 'x', oaSecretKey: 'x', accessToken: 'x' } },
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
    // The iMessage descriptor refuses to build anywhere but macOS.
    const os = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    try {
      for (const { platform, build } of builders) expect(build().platform).toBe(platform)
    } finally {
      os.mockRestore()
    }
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

describe('the Slack credential guard', () => {
  it('is the adapter\'s own: building Slack registers no process-wide rejection listener', () => {
    // GuardedSlackAdapter moved to @theokit/gateway-slack 0.5.0+, whose connect() answers false for a
    // refused credential instead of leaving a rejection for Node to turn into an exit.
    const before = process.listenerCount('unhandledRejection')
    const [slack] = adapterBuilders(PLACEHOLDERS.filter((entry) => entry.platform === 'slack'))
    expect(slack?.build().platform).toBe('slack')
    expect(process.listenerCount('unhandledRejection')).toBe(before)
  })
})

describe('signal sender id', () => {
  it('names a sender by phone number, not UUID, so signal:+number owners match', async () => {
    // NumberKeyedSignalAdapter moved to @theokit/gateway-signal 0.3.0 as its `senderKey` option, which
    // the descriptor takes and TheoClaw sets to "number".
    const { signalEnvelopeToMessageEvent } = await import('@theokit/gateway-signal')
    const [signal] = adapterBuilders([{ platform: 'signal', settings: { account: '+5511999990000' } }])
    const { senderKey } = ((signal?.build() as unknown as { opts: { senderKey?: 'uuid' | 'number' } }).opts)
    expect(senderKey).toBe('number')
    const envelope = { source: '+5511888880000', sourceNumber: '+5511888880000', sourceUuid: 'uuid-1', timestamp: 1, dataMessage: { message: 'pong', timestamp: 1 } }
    expect(signalEnvelopeToMessageEvent(envelope as never, 1, senderKey)?.sender.id).toBe('+5511888880000')
  })
})
