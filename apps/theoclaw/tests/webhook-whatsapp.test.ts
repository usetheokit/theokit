import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import type { WhatsAppMessageEvent } from '@theokit/gateway'
import { ConfigurationError } from '@theokit/gateway-whatsapp'

import { createWhatsAppRoute } from '../src/webhooks/whatsapp.js'
import type { DeliverableWhatsAppAdapter } from '../src/webhooks/whatsapp.js'
import { messageEvent } from './fakes.js'

const APP_SECRET = 'whatsapp-app-secret'
const VERIFY_TOKEN = 'whatsapp-verify-token'
const ENVELOPE = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })

function sign(body: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`
}

function signedPost(body: string, signature = sign(body)): Request {
  return new Request('http://localhost/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body,
  })
}

/** A two-method adapter: what toDeliverableEvents returns, and what deliver answers. */
function fakeWhatsApp(
  events: () => WhatsAppMessageEvent[],
  outcome: Awaited<ReturnType<DeliverableWhatsAppAdapter['deliver']>> = 'ok',
) {
  const delivered: string[] = []
  let conversions = 0
  const adapter: DeliverableWhatsAppAdapter = {
    toDeliverableEvents: () => {
      conversions += 1
      return events()
    },
    deliver: async (event) => {
      delivered.push(event.text)
      return outcome
    },
  }
  return { adapter, delivered, conversions: () => conversions }
}

const event = (text: string) => messageEvent('whatsapp', text) as WhatsAppMessageEvent

function route(adapter: DeliverableWhatsAppAdapter, lines: string[] = []) {
  return createWhatsAppRoute({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, adapter, write: (line) => lines.push(line) })
}

describe('createWhatsAppRoute', () => {
  it('answers the subscription challenge as text', async () => {
    const { adapter } = fakeWhatsApp(() => [])
    const url = `http://localhost/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1234`

    const response = await route(adapter)(new Request(url))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('1234')
    expect(response.headers.get('content-type')).toBe('text/plain')
  })

  it('answers 401 on a wrong verify token', async () => {
    const { adapter } = fakeWhatsApp(() => [])
    const url = 'http://localhost/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1234'

    expect((await route(adapter)(new Request(url))).status).toBe(401)
  })

  it('answers 503 when deliver returns no_handler', async () => {
    const { adapter } = fakeWhatsApp(() => [event('hi')], 'no_handler')

    expect((await route(adapter)(signedPost(ENVELOPE))).status).toBe(503)
  })

  it('answers 401 on a bad signature', async () => {
    const fake = fakeWhatsApp(() => [event('hi')])

    const response = await route(fake.adapter)(signedPost(ENVELOPE, 'sha256=00'))

    expect(response.status).toBe(401)
    expect(fake.conversions()).toBe(0)
  })

  it('delivers each event the adapter returns', async () => {
    const fake = fakeWhatsApp(() => [event('one'), event('two')])

    const response = await route(fake.adapter)(signedPost(ENVELOPE))

    expect(response.status).toBe(200)
    expect(fake.delivered).toEqual(['one', 'two'])
  })

  it('acknowledges status receipts without delivering', async () => {
    const fake = fakeWhatsApp(() => [])

    const response = await route(fake.adapter)(signedPost(ENVELOPE))

    expect(response.status).toBe(200)
    expect(fake.delivered).toEqual([])
  })

  it('answers 400 on a payload parse webhook payload rejects', async () => {
    const fake = fakeWhatsApp(() => [event('hi')])

    for (const body of ['{"not":"an envelope"}', 'not json']) {
      expect((await route(fake.adapter)(signedPost(body))).status).toBe(400)
    }
    expect(fake.conversions()).toBe(0)
  })

  it('answers 500 when to deliverable events throws', async () => {
    const fake = fakeWhatsApp(() => {
      throw new ConfigurationError({ code: 'missing_phone_number_id', message: 'no phone number id' })
    })
    const lines: string[] = []

    const response = await route(fake.adapter, lines)(signedPost(ENVELOPE))

    expect(response.status).toBe(500)
    expect(fake.delivered).toEqual([])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('whatsapp')
    expect(lines[0]).toContain('missing_phone_number_id')
  })

  it('leaves any other conversion failure to the router', async () => {
    const fake = fakeWhatsApp(() => {
      throw new Error('boom')
    })
    const lines: string[] = []

    await expect(route(fake.adapter, lines)(signedPost(ENVELOPE))).rejects.toThrow('boom')
    expect(lines).toEqual([])
  })
})
