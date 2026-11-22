import { describe, expect, it } from 'vitest'

import type { MessageEvent } from '@theokit/gateway'
import { createHmac } from 'node:crypto'

import { composeTheoClaw } from '../src/composition.js'
import { fakeBuilders, noAgent, offlineAdapter, WORKSPACE } from './composition-fixtures.js'
import { FakeAdapter, waitFor } from './fakes.js'

/**
 * The webhook routes as `composeTheoClaw` serves them through the gateway's webhook handler over the
 * adapters its runners started, and every line the router writes passes the configured-value mask.
 * (That a route refuses an adapter that cannot serve it is the descriptor's business now, not a
 * check made when the platform starts.)
 */

const SMS_ENV = {
  // A placeholder owner the app requires (B-371); these tests stay at the route level.
  THEOCLAW_OWNERS: 'telegram:owner',
  THEOCLAW_DM_POLICY: 'allowlist',
  THEOCLAW_SMS_TWILIO_ACCOUNT_SID: 'AC-composed',
  THEOCLAW_SMS_TWILIO_AUTH_TOKEN: 'sms-auth-token',
  THEOCLAW_SMS_TWILIO_FROM_NUMBER: '+12025550123',
  THEOCLAW_SMS_PUBLIC_URL: 'https://theoclaw.example.org/webhooks/sms',
  THEOCLAW_WORKSPACE: WORKSPACE,
}

const WHATSAPP_ENV = {
  // A placeholder owner the app requires (B-371); these tests stay at the route level.
  THEOCLAW_OWNERS: 'telegram:owner',
  THEOCLAW_DM_POLICY: 'allowlist',
  THEOCLAW_WHATSAPP_ACCESS_TOKEN: 'wa-access-token-value',
  THEOCLAW_WHATSAPP_PHONE_NUMBER_ID: '1234',
  THEOCLAW_WHATSAPP_APP_SECRET: 'wa-app-secret',
  THEOCLAW_WHATSAPP_VERIFY_TOKEN: 'wa-verify',
  THEOCLAW_WORKSPACE: WORKSPACE,
}

/** Twilio's signature, computed from its documented rule: base64 HMAC-SHA1 of the URL, then each sorted form key and value. */
function twilioSignature(url: string, params: URLSearchParams, authToken = 'sms-auth-token'): string {
  const entries = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return createHmac('sha1', authToken).update(entries.reduce((text, [key, value]) => text + key + value, url)).digest('base64')
}

const SMS_URL = 'https://theoclaw.example.org/webhooks/sms'

function twilioPost(signature?: string): Request {
  const params = new URLSearchParams({ MessageSid: 'SM-1', From: '+14155550100', To: '+12025550123', Body: 'hello theo' })
  return new Request('http://127.0.0.1:8787/webhooks/sms', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature ?? twilioSignature(SMS_URL, params) },
    body: params.toString(),
  })
}

const WHATSAPP_TEXT = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: '1234' },
            contacts: [{ wa_id: '5511999990000', profile: { name: 'Ana' } }],
            messages: [{ from: '5511999990000', id: 'wamid.1', timestamp: '1', type: 'text', text: { body: 'hello theo' } }],
          },
        },
      ],
    },
  ],
})

function signedWhatsAppPost(body: string): Request {
  return new Request('http://localhost/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', 'wa-app-secret').update(body).digest('hex')}` },
    body,
  })
}

describe('the composed SMS route', () => {
  it('delivers a Twilio post whose signature checks against THEOCLAW_SMS_PUBLIC_URL', async () => {
    const sms = offlineAdapter(SMS_ENV, 'sms')
    const delivered: MessageEvent[] = []
    const { builders } = fakeBuilders({ sms })
    const { loop, router } = composeTheoClaw({ env: SMS_ENV, agentFactory: noAgent, builders, write: () => undefined })
    await loop.ready
    sms.onInbound(async (event) => {
      delivered.push(event)
    })

    const response = await router(twilioPost())

    expect(response.status).toBe(200)
    expect(delivered.map((event) => event.text)).toEqual(['hello theo'])
    await loop.stopAll()
  })

  it('answers 401 when the signature does not check', async () => {
    const sms = offlineAdapter(SMS_ENV, 'sms')
    const delivered: MessageEvent[] = []
    const { builders } = fakeBuilders({ sms })
    const { loop, router } = composeTheoClaw({ env: SMS_ENV, agentFactory: noAgent, builders, write: () => undefined })
    await loop.ready
    sms.onInbound(async (event) => {
      delivered.push(event)
    })

    const response = await router(twilioPost('not-the-signature'))

    expect(response.status).toBe(401)
    expect(delivered).toEqual([])
    await loop.stopAll()
  })

  it('answers 503 on a platform whose adapter failed to start, and 200 once it connects', async () => {
    const sms = offlineAdapter(SMS_ENV, 'sms')
    const connect = sms.connect.bind(sms)
    let attempts = 0
    sms.connect = async () => (++attempts === 1 ? false : connect())
    const lines: string[] = []
    const { builders } = fakeBuilders({ sms })
    const { loop, router } = composeTheoClaw({
      env: SMS_ENV,
      agentFactory: noAgent,
      builders,
      write: (line) => lines.push(line),
      retry: { initialDelayMs: 1, maxDelayMs: 1, maxAttempts: 5 },
    })

    await waitFor(() => lines.includes('sms: connected'), 2000, 'sms to connect on retry')
    expect(attempts).toBe(2)
    expect((await router(twilioPost())).status).toBe(200)
    await loop.stopAll()
  })
})

describe('the composed SMS route over an adapter the descriptor did not build', () => {
  it('refuses every post, since no Twilio options are held for the adapter to verify with', async () => {
    const { builders } = fakeBuilders({ sms: new FakeAdapter('sms') })
    const { loop, router } = composeTheoClaw({ env: SMS_ENV, agentFactory: noAgent, builders, write: () => undefined })
    await loop.ready

    expect((await router(twilioPost())).status).toBe(401)
    await loop.stopAll()
  })
})

describe('the composed WhatsApp route', () => {
  it('refuses a post over an adapter the descriptor did not build, without failing the platform', async () => {
    const { builders } = fakeBuilders({ whatsapp: new FakeAdapter('whatsapp') })
    const { loop, router } = composeTheoClaw({ env: WHATSAPP_ENV, agentFactory: noAgent, builders, write: () => undefined })
    await loop.ready

    // The descriptor holds the app secret per adapter it built, so it refuses this one's signature.
    expect((await router(signedWhatsAppPost(WHATSAPP_TEXT))).status).toBe(401)
    expect(loop.failed).toEqual([])
    await loop.stopAll()
  })

  it('writes a route failure without the configured value it quotes', async () => {
    const whatsapp = offlineAdapter(WHATSAPP_ENV, 'whatsapp')
    // The conversion of the envelope throws, as a defect in it would.
    Object.assign(whatsapp, {
      toDeliverableEvents: () => {
        throw new Error('conversion broke with token wa-access-token-value')
      },
    })
    const lines: string[] = []
    const { builders } = fakeBuilders({ whatsapp })
    const { loop, router } = composeTheoClaw({ env: WHATSAPP_ENV, agentFactory: noAgent, builders, write: (line) => lines.push(line) })
    await loop.ready

    const response = await router(signedWhatsAppPost(WHATSAPP_TEXT))

    expect(response.status).toBe(500)
    expect(lines.some((line) => line.startsWith('whatsapp: webhook failed'))).toBe(true)
    expect(lines.join('\n')).not.toContain('wa-access-token-value')
    await loop.stopAll()
  })
})
