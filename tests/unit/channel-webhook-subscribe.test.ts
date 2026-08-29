/**
 * The channel seam must be able to answer the subscribe handshake (usetheokit/theokit#556).
 *
 * Meta verifies an endpoint with a GET carrying `hub.mode`, `hub.verify_token` and `hub.challenge`,
 * and requires the challenge echoed back as `text/plain` before it will deliver anything.
 * `handleChannelWebhook` only handled the POST, so an app had to add a route of its own regardless
 * — which meant the channel seam could not serve WhatsApp even once a validator existed.
 *
 * The handshake is modelled per platform for the same reason the validators are: Meta's shape is
 * shared by Instagram and Messenger but is not universal, and a generic `verifyToken` on the config
 * would bake one platform's query parameters into the seam.
 */
import { describe, expect, it, vi } from 'vitest'

import { handleChannelWebhook } from '../../packages/theo/src/server/agent/channel-webhook.js'
import {
  whatsapp,
  whatsappSubscribe,
} from '../../packages/theo/src/server/webhook/providers/whatsapp.js'

const PATH = '/api/agents/support/channels/whatsapp/webhook'
const VERIFY_TOKEN = 'fixture-only-verify-token'
const APP_SECRET = 'fixture-only-not-a-meta-app-secret'

function get(params: Record<string, string>): Request {
  const url = new URL(`http://x${PATH}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url, { method: 'GET' })
}

const CONFIG = {
  validators: { whatsapp: whatsapp({ appSecret: APP_SECRET }) },
  subscribe: { whatsapp: whatsappSubscribe({ verifyToken: VERIFY_TOKEN }) },
  onMessage: () => {},
}

describe('handleChannelWebhook — subscribe handshake (#556)', () => {
  it('echoes the challenge as text/plain, which is what Meta requires', async () => {
    const res = await handleChannelWebhook(
      get({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': '1158201444',
      }),
      PATH,
      CONFIG,
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/plain/u)
    await expect(res.text()).resolves.toBe('1158201444')
  })

  it('refuses a wrong token with 401 and echoes nothing', async () => {
    const res = await handleChannelWebhook(
      get({ 'hub.mode': 'subscribe', 'hub.verify_token': 'guessed', 'hub.challenge': 'X' }),
      PATH,
      CONFIG,
    )

    expect(res.status).toBe(401)
    await expect(res.text()).resolves.not.toContain('X')
  })

  it('never reaches onMessage — a handshake is not a delivery', async () => {
    const onMessage = vi.fn()

    await handleChannelWebhook(
      get({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'X' }),
      PATH,
      { ...CONFIG, onMessage },
    )

    expect(onMessage).not.toHaveBeenCalled()
  })

  it('405s a GET on a platform that declared no handshake', async () => {
    // Deliberately distinct from the 404 an unknown platform gets: the platform IS configured, and
    // saying "not found" would send the reader looking for a missing validator that is right there.
    const res = await handleChannelWebhook(get({ 'hub.mode': 'subscribe' }), PATH, {
      validators: CONFIG.validators,
      onMessage: () => {},
    })

    expect(res.status).toBe(405)
  })

  it('still 404s a GET for a platform nothing configured', async () => {
    const path = '/api/agents/support/channels/telegram/webhook'
    const res = await handleChannelWebhook(new Request(`http://x${path}`), path, CONFIG)

    expect(res.status).toBe(404)
  })

  it('leaves the POST path untouched — a signed delivery still routes', async () => {
    const onMessage = vi.fn()
    const body = JSON.stringify({ entry: [] })
    const { createHmac } = await import('node:crypto')
    const res = await handleChannelWebhook(
      new Request(`http://x${PATH}`, {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`,
        },
      }),
      PATH,
      { ...CONFIG, onMessage },
    )

    expect(res.status).toBe(200)
    expect(onMessage).toHaveBeenCalledWith({
      agent: 'support',
      platform: 'whatsapp',
      payload: { entry: [] },
    })
  })
})
