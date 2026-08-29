/**
 * WhatsApp must be servable through `handleChannelWebhook` (usetheokit/theokit#556).
 *
 * The channel seam answered 404 for `whatsapp` because no validator existed, and the subscribe
 * handshake Meta performs before delivering anything was not modelled at all. Between them, the one
 * platform `@theokit/gateway-whatsapp` exists for was unreachable by construction — so an app had
 * to hand-roll HMAC-SHA256 over the RAW body, which is the sharp edge: hashing a parsed-and-
 * restringified body compares different bytes and rejects correct requests (#534's class of
 * defect).
 *
 * The signature scheme is the same `X-Hub-Signature-256` GitHub uses — same header, same
 * construction — which is why both now go through one implementation rather than two copies of a
 * crypto routine.
 */
import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  whatsapp,
  whatsappSubscribe,
} from '../../packages/theo/src/server/webhook/providers/whatsapp.js'

// Test-only fixture; no network call, no real credential.
const APP_SECRET = 'fixture-only-not-a-meta-app-secret'
const VERIFY_TOKEN = 'fixture-only-verify-token'

function sign(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

function delivery(body: string, signature?: string): Request {
  return new Request('http://example.test/api/agents/s/channels/whatsapp/webhook', {
    method: 'POST',
    body,
    headers: signature === undefined ? {} : { 'x-hub-signature-256': signature },
  })
}

function handshake(params: Record<string, string>): Request {
  const url = new URL('http://example.test/api/agents/s/channels/whatsapp/webhook')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url, { method: 'GET' })
}

describe('whatsapp signature verification (#556)', () => {
  const BODY = JSON.stringify({ entry: [{ changes: [{ field: 'messages' }] }] })

  it('accepts a delivery signed with the app secret', async () => {
    const verify = whatsapp({ appSecret: APP_SECRET })

    await expect(verify(delivery(BODY, sign(APP_SECRET, BODY)))).resolves.toEqual({ ok: true })
  })

  it('rejects a delivery signed with a different secret', async () => {
    const verify = whatsapp({ appSecret: APP_SECRET })

    const result = await verify(delivery(BODY, sign('someone-else', BODY)))

    expect(result.ok).toBe(false)
  })

  it('rejects a body altered after signing — the whole point of signing the raw bytes', async () => {
    const verify = whatsapp({ appSecret: APP_SECRET })

    const result = await verify(delivery(`${BODY} `, sign(APP_SECRET, BODY)))

    expect(result.ok).toBe(false)
  })

  it('rejects an unsigned delivery, naming the header it wanted', async () => {
    const result = await whatsapp({ appSecret: APP_SECRET })(delivery(BODY))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/x-hub-signature-256/iu)
  })

  it('rejects a malformed header rather than treating it as a mismatch', async () => {
    const result = await whatsapp({ appSecret: APP_SECRET })(delivery(BODY, 'not-a-signature'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/sha256=/u)
  })

  it('supports secret rotation, so a rotation is not an outage', async () => {
    const verify = whatsapp({ appSecret: ['rotated-in', APP_SECRET] })

    await expect(verify(delivery(BODY, sign(APP_SECRET, BODY)))).resolves.toEqual({ ok: true })
    await expect(verify(delivery(BODY, sign('rotated-in', BODY)))).resolves.toEqual({ ok: true })
  })
})

describe('whatsapp subscribe handshake (#556)', () => {
  it('echoes the challenge when the token matches', async () => {
    const subscribe = whatsappSubscribe({ verifyToken: VERIFY_TOKEN })

    const result = await subscribe(
      handshake({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': '1158201444',
      }),
    )

    expect(result).toEqual({ ok: true, challenge: '1158201444' })
  })

  it('refuses a wrong token — the only thing standing between anyone and a subscription', async () => {
    const subscribe = whatsappSubscribe({ verifyToken: VERIFY_TOKEN })

    const result = await subscribe(
      handshake({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'guessed',
        'hub.challenge': '1158201444',
      }),
    )

    expect(result.ok).toBe(false)
  })

  it('refuses a mode other than subscribe', async () => {
    const subscribe = whatsappSubscribe({ verifyToken: VERIFY_TOKEN })

    const result = await subscribe(
      handshake({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': '1158201444',
      }),
    )

    expect(result.ok).toBe(false)
  })

  it('refuses a handshake with no challenge to echo', async () => {
    const subscribe = whatsappSubscribe({ verifyToken: VERIFY_TOKEN })

    const result = await subscribe(
      handshake({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN }),
    )

    expect(result.ok).toBe(false)
  })
})
