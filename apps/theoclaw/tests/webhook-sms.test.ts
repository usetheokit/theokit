import { describe, expect, it } from 'vitest'

import type { MessageEvent } from '@theokit/gateway'
import type { SMSAdapterOptions } from '@theokit/gateway-sms'

import { createSmsRoute } from '../src/webhooks/sms.js'
import { FakeAdapter } from './fakes.js'

const OPTIONS: SMSAdapterOptions = {
  backend: 'twilio',
  accountSid: 'AC-test',
  authToken: 'twilio-auth-token',
  fromNumber: '+12025550123',
  publicUrl: 'https://theoclaw.example.org/webhooks/sms',
}

/** A FakeAdapter that also verifies signatures, the structural type `smsWebhookVerifier` accepts. */
class VerifyingSmsAdapter extends FakeAdapter {
  readonly verified: string[] = []

  constructor(private readonly signatureIsValid: boolean) {
    super('sms')
  }

  verifySignature(ctx: { readonly rawBody: string }): boolean {
    this.verified.push(ctx.rawBody)
    return this.signatureIsValid
  }
}

function subscribed(adapter: FakeAdapter): MessageEvent[] {
  const delivered: MessageEvent[] = []
  adapter.onInbound(async (event) => {
    delivered.push(event)
  })
  return delivered
}

const TWILIO_BODY = new URLSearchParams({
  MessageSid: 'SM-1',
  From: '+14155550100',
  To: '+12025550123',
  Body: 'hello theo',
}).toString()

function post(body: string): Request {
  return new Request('http://internal:8080/webhooks/sms', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'sig' },
    body,
  })
}

describe('createSmsRoute', () => {
  it('answers 401 on a bad signature', async () => {
    const adapter = new VerifyingSmsAdapter(false)
    const delivered = subscribed(adapter)

    const response = await createSmsRoute({ adapter, options: OPTIONS })(post(TWILIO_BODY))

    expect(response.status).toBe(401)
    expect(delivered).toHaveLength(0)
  })

  it('answers 503 when deliver returns no_handler', async () => {
    const adapter = new VerifyingSmsAdapter(true)

    const response = await createSmsRoute({ adapter, options: OPTIONS })(post(TWILIO_BODY))

    expect(response.status).toBe(503)
  })

  it('reads the body after verifying it', async () => {
    const adapter = new VerifyingSmsAdapter(true)
    const delivered = subscribed(adapter)

    const response = await createSmsRoute({ adapter, options: OPTIONS })(post(TWILIO_BODY))

    expect(response.status).toBe(200)
    expect(adapter.verified).toEqual([TWILIO_BODY])
    expect(delivered.map((event) => event.text)).toEqual(['hello theo'])
  })

  it('answers 400 on a body parse inbound rejects', async () => {
    const adapter = new VerifyingSmsAdapter(true)
    const delivered = subscribed(adapter)
    const noSid = new URLSearchParams({
      From: '+14155550100',
      To: '+12025550123',
      Body: 'hi',
    }).toString()

    const response = await createSmsRoute({ adapter, options: OPTIONS })(post(noSid))

    expect(response.status).toBe(400)
    expect(delivered).toHaveLength(0)
  })
})
