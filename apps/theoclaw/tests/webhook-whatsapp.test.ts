import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import type { MessageEvent } from '@theokit/gateway'

import { adapterBuilders } from '../src/channels/adapter-factory.js'
import { descriptorFor, resolvePlatforms } from '../src/channels/platforms.js'
import { withFailedStatusLog } from '../src/channels/whatsapp-status-log.js'
import { gatewayRouter, offline } from './webhook-fixtures.js'

/** The WhatsApp Cloud webhook as the gateway's webhook handler serves it over TheoClaw's adapter (FR-006). */

const APP_SECRET = 'whatsapp-app-secret'
const VERIFY_TOKEN = 'whatsapp-verify-token'
const ENV = {
  THEOCLAW_WHATSAPP_ACCESS_TOKEN: 'wa-access-token',
  THEOCLAW_WHATSAPP_PHONE_NUMBER_ID: '1234',
  THEOCLAW_WHATSAPP_APP_SECRET: APP_SECRET,
  THEOCLAW_WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
}

const sign = (body: string): string => `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`

function signedPost(body: string, signature = sign(body)): Request {
  return new Request('http://localhost/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body,
  })
}

const message = (body: string, id = 'wamid.1') => ({ from: '5511999990000', id, timestamp: '1', type: 'text', text: { body } })
const envelope = (value: Record<string, unknown>) =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1234' }, ...value } }] }],
  })

function rig(options: { started?: boolean } = {}) {
  const resolved = resolvePlatforms(ENV)
  const entry = resolved.configured[0]!
  const adapter = offline(adapterBuilders([entry])[0]!.build())
  const delivered: MessageEvent[] = []
  adapter.onInbound(async (event) => {
    delivered.push(event)
  })
  const lines: string[] = []
  const descriptor = withFailedStatusLog(descriptorFor(entry.platform, entry.settings), (line) => lines.push(line))
  const router = gatewayRouter({ channels: [{ descriptor, adapter }], isStarted: () => options.started ?? true, write: (line) => lines.push(line) })
  return { adapter, delivered, lines, router }
}

describe('the WhatsApp webhook', () => {
  it('logs a failed delivery status with code, title and masked recipient', async () => {
    const { lines, router } = rig()
    const status = (s: string) => ({ id: 'wamid.1', status: s, recipient_id: '5511987654321', errors: [{ code: 130497, title: 'Restricted' }] })

    const response = await router(signedPost(envelope({ statuses: [status('failed'), status('delivered')] })))

    expect(response.status).toBe(200)
    expect(lines).toEqual(['whatsapp: delivery failed to ***4321: error 130497 Restricted'])
  })

  it('writes nothing for a failed status in a request that does not verify', async () => {
    const { lines, router } = rig()
    const body = envelope({ statuses: [{ id: 'wamid.1', status: 'failed', recipient_id: '5511987654321' }] })

    expect((await router(signedPost(body, 'sha256=bad'))).status).toBe(401)
    expect(lines).toEqual([])
  })

  it('answers the subscription challenge as text', async () => {
    const { router } = rig()
    const url = (token: string): string => `http://localhost/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=abc123`

    const good = await router(new Request(url(VERIFY_TOKEN)))
    expect(good.status).toBe(200)
    expect(await good.text()).toBe('abc123')
  })

  // The descriptor answers 403, Meta's documented refusal, where TheoClaw's own route answered 401.
  it('answers 403 on a wrong verify token', async () => {
    const { router } = rig()
    const wrong = await router(new Request('http://localhost/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123'))
    expect(wrong.status).toBe(403)
    expect(await wrong.text()).toBe('')
  })

  it('answers 503 before the platform starts', async () => {
    const { router } = rig({ started: false })
    expect((await router(signedPost(envelope({ messages: [message('hi')] })))).status).toBe(503)
  })

  it('answers 503 when deliver returns no_handler', async () => {
    const { adapter, router } = rig()
    adapter.onInbound(undefined as never)
    expect((await router(signedPost(envelope({ messages: [message('hi')] })))).status).toBe(503)
  })

  it('answers 401 on a bad signature', async () => {
    const { delivered, router } = rig()
    expect((await router(signedPost(envelope({ messages: [message('hi')] }), 'sha256=bad'))).status).toBe(401)
    expect(delivered).toEqual([])
  })

  it('delivers each event the adapter returns', async () => {
    const { delivered, router } = rig()
    expect((await router(signedPost(envelope({ contacts: [{ wa_id: '5511999990000', profile: { name: 'Ana' } }], messages: [message('one', 'wamid.1'), message('two', 'wamid.2')] })))).status).toBe(200)
    expect(delivered.map((event) => event.text)).toEqual(['one', 'two'])
  })

  it('acknowledges status receipts without delivering', async () => {
    const { delivered, router } = rig()
    const body = envelope({ statuses: [{ id: 'wamid.1', status: 'read', recipient_id: '5511999990000' }] })
    expect((await router(signedPost(body))).status).toBe(200)
    expect(delivered).toEqual([])
  })

  it('answers 400 on a payload parse webhook payload rejects', async () => {
    const { delivered, router } = rig()
    for (const body of ['{"not":"an envelope"}', 'not json']) {
      expect((await router(signedPost(body))).status).toBe(400)
    }
    expect(delivered).toEqual([])
  })

  it('answers 500 when a handler throws, so Meta retries', async () => {
    const { adapter, router } = rig()
    adapter.onInbound(async () => {
      throw new Error('handler broke')
    })
    expect((await router(signedPost(envelope({ messages: [message('hi')] })))).status).toBe(500)
  })

  it('answers 503 when any event finds no handler (the worst outcome wins)', async () => {
    const { adapter, router } = rig()
    let first = true
    adapter.onInbound(async () => {
      if (first) {
        first = false
        adapter.onInbound(undefined as never)
      }
    })
    expect((await router(signedPost(envelope({ messages: [message('one', 'wamid.1'), message('two', 'wamid.2')] })))).status).toBe(503)
  })

  it('answers 500 and writes it when the conversion throws', async () => {
    const { adapter, lines, router } = rig()
    Object.assign(adapter, {
      toDeliverableEvents: () => {
        throw new Error('conversion broke')
      },
    })
    expect((await router(signedPost(envelope({ messages: [message('hi')] })))).status).toBe(500)
    expect(lines).toEqual(['whatsapp: webhook failed: conversion broke'])
  })

  it('answers 405 for a method the route does not take', async () => {
    const { router } = rig()
    expect((await router(new Request('http://localhost/webhooks/whatsapp', { method: 'PUT' }))).status).toBe(405)
  })

  it('refuses a body over 1 MiB with 413', async () => {
    const { router } = rig()
    expect((await router(signedPost('x'.repeat(1024 * 1024 + 1)))).status).toBe(413)
  })
})
