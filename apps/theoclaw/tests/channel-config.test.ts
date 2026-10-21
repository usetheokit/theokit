import { describe, expect, it } from 'vitest'

import { PLATFORMS, resolvePlatforms } from '../src/channels/platforms.js'

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
