import { describe, expect, it } from 'vitest'

import type { MessageEvent, WhatsAppMessageEvent } from '@theokit/gateway'
import { createHmac } from 'node:crypto'

import { composeTheoClaw } from '../src/composition.js'
import { fakeBuilders, noAgent, WORKSPACE } from './composition-fixtures.js'
import { FakeAdapter } from './fakes.js'

/**
 * The webhook routes as `composeTheoClaw` binds them to the adapters its runners started: what the
 * route needs of an adapter is checked once, when the platform starts, and every line the router
 * writes passes the configured-value mask.
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

/** An SMS stand-in that verifies signatures as told and records the URL each check was given. */
class VerifyingSms extends FakeAdapter {
  readonly checkedUrls: string[] = []

  constructor(private readonly valid: boolean) {
    super('sms')
  }

  verifySignature(ctx: { readonly url: string }): boolean {
    this.checkedUrls.push(ctx.url)
    return this.valid
  }
}

function twilioPost(): Request {
  return new Request('http://127.0.0.1:8787/webhooks/sms', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'sig' },
    body: new URLSearchParams({ MessageSid: 'SM-1', From: '+14155550100', To: '+12025550123', Body: 'hello theo' }).toString(),
  })
}

function signedWhatsAppPost(): Request {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
  return new Request('http://localhost/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', 'wa-app-secret').update(body).digest('hex')}` },
    body,
  })
}

describe('the composed SMS route', () => {
  it('delivers a Twilio post whose signature checks against THEOCLAW_SMS_PUBLIC_URL', async () => {
    const sms = new VerifyingSms(true)
    const delivered: MessageEvent[] = []
    const { builders } = fakeBuilders({ sms })
    const { loop, router } = composeTheoClaw({ env: SMS_ENV, agentFactory: noAgent, builders, write: () => undefined })
    await loop.ready
    sms.onInbound(async (event) => {
      delivered.push(event)
    })

    const response = await router(twilioPost())

    expect(response.status).toBe(200)
    expect(sms.checkedUrls).toEqual(['https://theoclaw.example.org/webhooks/sms'])
    expect(delivered.map((event) => event.text)).toEqual(['hello theo'])
    await loop.stopAll()
  })

  it('answers 401 when the signature does not check', async () => {
    const sms = new VerifyingSms(false)
    const delivered: MessageEvent[] = []
    const { builders } = fakeBuilders({ sms })
    const { loop, router } = composeTheoClaw({ env: SMS_ENV, agentFactory: noAgent, builders, write: () => undefined })
    await loop.ready
    sms.onInbound(async (event) => {
      delivered.push(event)
    })

    const response = await router(twilioPost())

    expect(response.status).toBe(401)
    expect(sms.checkedUrls).toEqual(['https://theoclaw.example.org/webhooks/sms'])
    expect(delivered).toEqual([])
    await loop.stopAll()
  })

  it('fails the platform at start when the built adapter cannot verify a signature', async () => {
    const lines: string[] = []
    const { builders } = fakeBuilders({ sms: new FakeAdapter('sms') })
    const { loop, router } = composeTheoClaw({ env: SMS_ENV, agentFactory: noAgent, builders, write: (line) => lines.push(line) })
    await loop.ready

    expect(loop.failed).toEqual(['sms'])
    expect(lines).toContain('sms: start failed: the built adapter cannot verify a webhook signature')
    expect((await router(twilioPost())).status).toBe(503)
    await loop.stopAll()
  })
})

describe('the composed WhatsApp route', () => {
  it('fails the platform at start when the built adapter cannot convert an envelope', async () => {
    const lines: string[] = []
    const { builders } = fakeBuilders({ whatsapp: new FakeAdapter('whatsapp') })
    const { loop, router } = composeTheoClaw({ env: WHATSAPP_ENV, agentFactory: noAgent, builders, write: (line) => lines.push(line) })
    await loop.ready

    expect(loop.failed).toEqual(['whatsapp'])
    expect(lines).toContain('whatsapp: start failed: the built adapter cannot convert a webhook envelope')
    expect((await router(signedWhatsAppPost())).status).toBe(503)
    await loop.stopAll()
  })

  it('writes a route failure without the configured value it quotes', async () => {
    const whatsapp = new (class extends FakeAdapter {
      toDeliverableEvents(): WhatsAppMessageEvent[] {
        throw new Error('conversion broke with token wa-access-token-value')
      }
    })('whatsapp')
    const lines: string[] = []
    const { builders } = fakeBuilders({ whatsapp })
    const { loop, router } = composeTheoClaw({ env: WHATSAPP_ENV, agentFactory: noAgent, builders, write: (line) => lines.push(line) })
    await loop.ready

    expect((await router(signedWhatsAppPost())).status).toBe(500)
    expect(lines.some((line) => line.startsWith('whatsapp: webhook failed'))).toBe(true)
    expect(lines.join('\n')).not.toContain('wa-access-token-value')
    await loop.stopAll()
  })
})
