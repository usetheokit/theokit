import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import type { MessageEvent } from '@theokit/gateway'

import { offlineAdapter } from './composition-fixtures.js'
import { gatewayRouter } from './webhook-fixtures.js'
import { descriptorFor, resolvePlatforms } from '../src/channels/platforms.js'

/** The Twilio SMS webhook as the gateway's webhook handler serves it over TheoClaw's adapter. */

const URL_ = 'https://theoclaw.example.org/webhooks/sms'
const TOKEN = 'sms-auth-token'
const ENV = {
  THEOCLAW_SMS_TWILIO_ACCOUNT_SID: 'AC-webhook',
  THEOCLAW_SMS_TWILIO_AUTH_TOKEN: TOKEN,
  THEOCLAW_SMS_TWILIO_FROM_NUMBER: '+12025550123',
  THEOCLAW_SMS_PUBLIC_URL: URL_,
}

function sign(params: URLSearchParams): string {
  const data = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).reduce((text, [key, value]) => text + key + value, URL_)
  return createHmac('sha1', TOKEN).update(data).digest('base64')
}

function post(fields: Record<string, string>, signature?: string): Request {
  const params = new URLSearchParams(fields)
  return new Request('http://127.0.0.1:8787/webhooks/sms', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature ?? sign(params) },
    body: params.toString(),
  })
}

const INBOUND = { MessageSid: 'SM-1', From: '+14155550100', To: '+12025550123', Body: 'hello theo' }

function rig(started = true) {
  const adapter = offlineAdapter(ENV, 'sms')
  const entry = resolvePlatforms(ENV).configured[0]!
  const delivered: MessageEvent[] = []
  adapter.onInbound(async (event) => {
    delivered.push(event)
  })
  const router = gatewayRouter({ channels: [{ descriptor: descriptorFor(entry.platform, entry.settings), adapter }], isStarted: () => started })
  return { adapter, delivered, router }
}

describe('the SMS webhook', () => {
  it('answers 401 on a bad signature', async () => {
    const { delivered, router } = rig()
    expect((await router(post(INBOUND, 'bad'))).status).toBe(401)
    expect(delivered).toEqual([])
  })

  it('reads the body after verifying it: a post signed over THEOCLAW_SMS_PUBLIC_URL is delivered', async () => {
    const { delivered, router } = rig()
    expect((await router(post(INBOUND))).status).toBe(200)
    expect(delivered.map((event) => event.text)).toEqual(['hello theo'])
  })

  it('answers 503 before the platform starts', async () => {
    expect((await rig(false).router(post(INBOUND))).status).toBe(503)
  })

  it('answers 503 when deliver returns no_handler', async () => {
    const { adapter, router } = rig()
    adapter.onInbound(undefined as never)
    expect((await router(post(INBOUND))).status).toBe(503)
  })

  it('answers 400 on a body parse inbound rejects', async () => {
    const { delivered, router } = rig()
    expect((await router(post({ Nothing: 'here' }))).status).toBe(400)
    expect(delivered).toEqual([])
  })

  it('answers 405 for a method the route does not take', async () => {
    const { router } = rig()
    expect((await router(new Request('http://localhost/webhooks/sms', { method: 'GET' }))).status).toBe(405)
  })

  it('refuses a body over 1 MiB with 413', async () => {
    const { router } = rig()
    expect((await router(post({ Body: 'x'.repeat(1024 * 1024 + 1) }))).status).toBe(413)
  })
})
