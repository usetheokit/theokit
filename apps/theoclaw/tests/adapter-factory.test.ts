import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { WhatsAppAdapter } from '@theokit/gateway-whatsapp'

import { adapterBuilders, depsFor } from '../src/channels/adapter-factory.js'
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
  it('reports a Slack credential rejection instead of letting it crash the process', async () => {
    // GuardedSlackAdapter moved into @theokit/gateway-slack 0.5.0+: connect() stops Bolt's own
    // background token check and answers false for a refused credential. Run that path for real,
    // with Bolt's socket start refusing the way Slack does.
    const { App } = await import('@slack/bolt')
    const refusal = Object.assign(new Error('An API error occurred: invalid_auth'), { code: 'slack_webapi_platform_error' })
    const start = vi.spyOn(App.prototype, 'start').mockRejectedValue(refusal)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    const listeners = process.listenerCount('unhandledRejection')
    try {
      const [slack] = adapterBuilders([{ platform: 'slack', settings: { botToken: 'xoxb-fake', appToken: 'xapp-fake' } }])
      expect(await slack?.build().connect()).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(unhandled).toEqual([])
      expect(process.listenerCount('unhandledRejection')).toBe(listeners)
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('invalid_auth'))
    } finally {
      process.off('unhandledRejection', onUnhandled)
      start.mockRestore()
      stderr.mockRestore()
    }
  })
})

describe('signal sender id', () => {
  it('hands the handler the phone number, not the UUID, so signal:+number owners match', async () => {
    // NumberKeyedSignalAdapter moved to @theokit/gateway-signal 0.3.0 as its `senderKey` option: the
    // descriptor is given "number", and the package converts the envelope with it.
    const { signalChannel, signalEnvelopeToMessageEvent } = await import('@theokit/gateway-signal')
    const create = vi.spyOn(signalChannel, 'create')
    const [signal] = adapterBuilders([{ platform: 'signal', settings: { account: '+5511999990000' } }])
    signal?.build()
    const senderKey = create.mock.calls[0]?.[0]?.senderKey
    create.mockRestore()
    expect(senderKey).toBe('number')
    const envelope = { source: '+5511888880000', sourceNumber: '+5511888880000', sourceUuid: 'uuid-1', timestamp: 1, dataMessage: { message: 'pong', timestamp: 1 } }
    expect(signalEnvelopeToMessageEvent(envelope as never, 1, senderKey as 'number')?.sender.id).toBe('+5511888880000')
  })
})

describe('depsFor', () => {
  it('gives X a store that keeps the rotated token under x-refresh-token, whichever key the descriptor asks for', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'x-deps-'))
    const deps = depsFor({ platform: 'x', settings: {} }, {}, dir)
    const store = deps?.credentialStore as { get(k: string): Promise<string | undefined>; set(k: string, v: string): Promise<void> }
    await store.set('x-refresh-token:42', 'rotated')
    expect(readFileSync(join(dir, 'x-refresh-token'), 'utf8')).toBe('rotated')
    expect(await store.get('x-refresh-token:42')).toBe('rotated')
  })

  it('gives X nothing without a state directory', () => {
    expect(depsFor({ platform: 'x', settings: {} }, {}, '  ')).toBeUndefined()
  })

  it('gives Baileys the QR sink and the pairing wait only when set', () => {
    const baileys: ConfiguredPlatform = { platform: 'whatsapp', settings: { sessionDir: '/tmp/s' } }
    const onQr = vi.fn()
    expect(depsFor(baileys, { onQr, connectTimeoutMs: 5 })).toEqual({ onQr, connectTimeoutMs: 5 })
    expect(depsFor(baileys, {})).toEqual({})
    expect(depsFor({ platform: 'telegram', settings: { token: 't' } }, { onQr })).toBeUndefined()
  })
})
