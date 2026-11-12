import { describe, expect, it } from 'vitest'

import { WhatsAppAdapter } from '@theokit/gateway-whatsapp'

import { adapterBuilders } from '../src/channels/adapter-factory.js'
import type { ConfiguredPlatform } from '../src/channels/platforms.js'

/** Placeholder settings each adapter accepts at construction; no test here ever connects. */
const PLACEHOLDERS: readonly ConfiguredPlatform[] = [
  { platform: 'telegram', settings: { token: 'placeholder-token' } },
  { platform: 'discord', settings: { token: 'placeholder-token' } },
  { platform: 'slack', settings: { botToken: 'xoxb-placeholder', appToken: 'xapp-placeholder' } },
  {
    platform: 'matrix',
    settings: { homeserverUrl: 'https://matrix.example.org', accessToken: 'x', userId: '@bot:example.org' },
  },
  { platform: 'mattermost', settings: { baseUrl: 'https://mattermost.example.org', accessToken: 'x' } },
  { platform: 'email', settings: { address: 'bot@example.org', password: 'x', imapHost: 'imap.example.org', smtpHost: 'smtp.example.org' } },
  { platform: 'line', settings: { channelSecret: 'x', channelAccessToken: 'x' } },
  { platform: 'whatsapp', settings: { accessToken: 'x', phoneNumberId: '1234', appSecret: 'x', verifyToken: 'x' } },
  { platform: 'teams', settings: { clientId: 'x', clientSecret: 'x', tenantId: 'x' } },
  {
    platform: 'sms',
    settings: { accountSid: 'AC-x', authToken: 'x', fromNumber: '+15550000000', publicUrl: 'https://example.org/webhooks/sms' },
  },
]

describe('adapterBuilders', () => {
  it('builds one adapter per platform with its platform name', () => {
    const builders = adapterBuilders(PLACEHOLDERS)

    expect(builders.map((entry) => entry.platform)).toEqual(PLACEHOLDERS.map((entry) => entry.platform))
    for (const { platform, build } of builders) expect(build().platform).toBe(platform)
  })

  it('builds WhatsApp on the Cloud backend', () => {
    const [whatsapp] = adapterBuilders(PLACEHOLDERS.filter((entry) => entry.platform === 'whatsapp'))
    const adapter = whatsapp?.build()

    expect(adapter).toBeInstanceOf(WhatsAppAdapter)
    expect((adapter as WhatsAppAdapter).getBackend().kind).toBe('cloud')
  })

  it('builds nothing until a builder is called', () => {
    const builders = adapterBuilders([{ platform: 'matrix', settings: { homeserverUrl: 'x', accessToken: 'x', userId: 'bot' } }])

    expect(builders).toHaveLength(1)
    expect(() => builders[0]?.build()).toThrow(/user/i)
  })
})
