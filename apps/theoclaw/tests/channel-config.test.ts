import { describe, expect, it } from 'vitest'

import { startChannelLoop } from '../src/channels/channel-loop.js'
import { PLATFORMS, resolvePlatforms } from '../src/channels/platforms.js'
import { FakeAdapter } from './fakes.js'

/**
 * FR-003: a platform runs only when every variable it needs is set; a platform with any variable
 * missing is skipped whole, and the skip names the missing variables, never a value.
 */
describe('resolvePlatforms', () => {
  it('skips a platform with no credentials and names the missing variables', () => {
    const resolved = resolvePlatforms({ THEOCLAW_TELEGRAM_TOKEN: 'telegram-token-value' })

    expect(resolved.configured.map((entry) => entry.platform)).toEqual(['telegram'])
    expect(resolved.skipped).toContainEqual({
      platform: 'slack',
      missing: ['THEOCLAW_SLACK_BOT_TOKEN', 'THEOCLAW_SLACK_APP_TOKEN'],
    })
    expect(resolved.secrets).toEqual(['telegram-token-value'])
  })

  it('skips a platform whose variables are only partly set, naming only the missing ones', () => {
    const resolved = resolvePlatforms({ THEOCLAW_SLACK_BOT_TOKEN: 'bot-token-value' })

    expect(resolved.skipped).toContainEqual({
      platform: 'slack',
      missing: ['THEOCLAW_SLACK_APP_TOKEN'],
    })
    expect(resolved.configured).toEqual([])
    expect(resolved.secrets).toEqual([])
  })

  it('an empty or blank variable counts as missing', () => {
    const resolved = resolvePlatforms({ THEOCLAW_TELEGRAM_TOKEN: '  ' })

    expect(resolved.configured).toEqual([])
    expect(resolved.skipped).toContainEqual({
      platform: 'telegram',
      missing: ['THEOCLAW_TELEGRAM_TOKEN'],
    })
  })

  it('an empty-string variable counts as missing', () => {
    const resolved = resolvePlatforms({ THEOCLAW_DISCORD_TOKEN: '' })

    expect(resolved.skipped).toContainEqual({ platform: 'discord', missing: ['THEOCLAW_DISCORD_TOKEN'] })
    expect(resolved.secrets).toEqual([])
  })

  it('passes a value on trimmed', () => {
    const resolved = resolvePlatforms({ THEOCLAW_TELEGRAM_TOKEN: ' telegram-token-value\n' })

    expect(resolved.configured).toEqual([{ platform: 'telegram', settings: { token: 'telegram-token-value' } }])
    expect(resolved.secrets).toEqual(['telegram-token-value'])
  })

  it('requires the WhatsApp verify token and keeps it with the settings', () => {
    const partial = resolvePlatforms({
      THEOCLAW_WHATSAPP_ACCESS_TOKEN: 'wa-access',
      THEOCLAW_WHATSAPP_PHONE_NUMBER_ID: '1234',
      THEOCLAW_WHATSAPP_APP_SECRET: 'wa-app-secret',
    })
    expect(partial.skipped).toContainEqual({ platform: 'whatsapp', missing: ['THEOCLAW_WHATSAPP_VERIFY_TOKEN'] })

    const complete = resolvePlatforms({
      THEOCLAW_WHATSAPP_ACCESS_TOKEN: 'wa-access',
      THEOCLAW_WHATSAPP_PHONE_NUMBER_ID: '1234',
      THEOCLAW_WHATSAPP_APP_SECRET: 'wa-app-secret',
      THEOCLAW_WHATSAPP_VERIFY_TOKEN: 'wa-verify',
    })
    expect(complete.configured).toEqual([
      {
        platform: 'whatsapp',
        settings: { accessToken: 'wa-access', phoneNumberId: '1234', appSecret: 'wa-app-secret', verifyToken: 'wa-verify' },
      },
    ])
  })

  it('a skipped platform carries only its name and the missing variable names', () => {
    const resolved = resolvePlatforms({ THEOCLAW_SLACK_BOT_TOKEN: 'bot-token-value' })
    const slack = resolved.skipped.find((entry) => entry.platform === 'slack')

    expect(slack).toStrictEqual({ platform: 'slack', missing: ['THEOCLAW_SLACK_APP_TOKEN'] })
    expect(JSON.stringify(resolved.skipped)).not.toContain('bot-token-value')
  })

  it('lists all ten platforms', () => {
    expect(PLATFORMS.map((spec) => spec.platform)).toEqual([
      'telegram',
      'discord',
      'slack',
      'matrix',
      'mattermost',
      'email',
      'line',
      'whatsapp',
      'teams',
      'sms',
    ])
  })

  it('hands a configured platform the settings its adapter reads', () => {
    const resolved = resolvePlatforms({
      THEOCLAW_SMS_TWILIO_ACCOUNT_SID: 'AC-sid',
      THEOCLAW_SMS_TWILIO_AUTH_TOKEN: 'auth-token',
      THEOCLAW_SMS_TWILIO_FROM_NUMBER: '+15550000000',
      THEOCLAW_SMS_PUBLIC_URL: 'https://example.test/webhooks/sms',
    })

    expect(resolved.configured).toEqual([
      {
        platform: 'sms',
        settings: {
          accountSid: 'AC-sid',
          authToken: 'auth-token',
          fromNumber: '+15550000000',
          publicUrl: 'https://example.test/webhooks/sms',
        },
      },
    ])
  })

  it('collects every value a configured platform read as a secret', () => {
    const resolved = resolvePlatforms({
      THEOCLAW_LINE_CHANNEL_SECRET: 'line-secret',
      THEOCLAW_LINE_CHANNEL_ACCESS_TOKEN: 'line-access-token',
    })

    expect(resolved.secrets).toEqual(['line-secret', 'line-access-token'])
  })
})

/**
 * NFR-003 at the loop: a connect that fails with the credential in its message is written with the
 * platform's name and no trace of the value. The secret has no recognisable shape, so only the
 * loop's own mask can remove it; no four characters of it may survive, which
 * catches a partial mask such as `redactSecrets` leaves on an `sk-ant-` shape.
 */
describe('the channel loop output', () => {
  it('never writes a credential value when a connect fails', async () => {
    const token = 's3cret-value-xyz-0123'
    const lines: string[] = []
    const loop = startChannelLoop({
      platforms: [
        {
          platform: 'discord',
          build: () =>
            new FakeAdapter('discord', {
              connect: async () => {
                throw new Error(`login failed for token ${token} (sk-ant-api03-${token})`)
              },
            }),
        },
      ],
      handler: async () => undefined,
      secrets: [token],
      write: (line) => lines.push(line),
    })

    await loop.ready
    const output = lines.join('\n')

    expect(output).toContain('discord')
    expect(output).not.toContain(token)
    for (let start = 0; start + 4 <= token.length; start += 1) {
      expect(output).not.toContain(token.slice(start, start + 4))
    }
  })
})
