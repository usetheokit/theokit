import { describe, expect, it } from 'vitest'

import { computeLineSignature, lineChannel } from '@theokit/gateway-line'
import type { MessageEvent } from '@theokit/gateway'

import { gatewayRouter, offlineLine } from './webhook-fixtures.js'

/** The LINE webhook as the gateway's webhook handler serves it over TheoClaw's adapter (FR-005, FR-009). */

const SECRET = 'line-channel-secret'
const text = (value: string, id = 'm-1') => ({
  type: 'message',
  timestamp: 1,
  source: { type: 'user', userId: 'U-1' },
  message: { id, type: 'text', text: value },
})

function rig(started = true) {
  const adapter = offlineLine(SECRET)
  const delivered: string[] = []
  adapter.onInbound(async (event: MessageEvent) => {
    delivered.push(event.text)
  })
  const router = gatewayRouter({ channels: [{ descriptor: lineChannel, adapter }], isStarted: () => started })
  return { adapter, delivered, router }
}

function post(body: string, signature = computeLineSignature(SECRET, body)): Request {
  return new Request('http://localhost/webhooks/line', { method: 'POST', headers: { 'x-line-signature': signature }, body })
}

describe('the LINE webhook', () => {
  it('answers 401 on a bad signature', async () => {
    const { delivered, router } = rig()
    expect((await router(post(JSON.stringify({ events: [text('hi')] }), 'bad'))).status).toBe(401)
    expect(delivered).toEqual([])
  })

  it('answers 503 before the platform starts, so LINE retries', async () => {
    const { router } = rig(false)
    expect((await router(post(JSON.stringify({ events: [text('hi')] })))).status).toBe(503)
  })

  it('answers 503 when deliver returns no_handler', async () => {
    const { adapter, router } = rig()
    adapter.onInbound(undefined as never)
    expect((await router(post(JSON.stringify({ events: [text('hi')] })))).status).toBe(503)
  })

  it('delivers once per convertible event', async () => {
    const { delivered, router } = rig()
    const body = JSON.stringify({ events: [text('one', 'm-1'), { type: 'follow', timestamp: 2, source: { type: 'user', userId: 'U-1' } }, text('two', 'm-2')] })
    expect((await router(post(body))).status).toBe(200)
    expect(delivered).toEqual(['one', 'two'])
  })

  it('answers 400 on a body that is not json', async () => {
    const { router } = rig()
    expect((await router(post('not json'))).status).toBe(400)
  })

  it('answers 400 when events is not a list', async () => {
    const { router } = rig()
    expect((await router(post(JSON.stringify({ events: 'x' })))).status).toBe(400)
  })

  it('answers 400 when an event is not an object', async () => {
    const { delivered, router } = rig()
    expect((await router(post(JSON.stringify({ events: ['x', null] })))).status).toBe(400)
    expect(delivered).toEqual([])
  })

  // The package's conversion reads such an event without throwing, so it is acknowledged (TheoClaw's own route answered 400).
  it('acknowledges an event that carries a null message or source without delivering it', async () => {
    const { delivered, router } = rig()
    for (const event of [{ type: 'message', source: null }, { type: 'message', source: { type: 'user', userId: 'U-1' }, message: null }]) {
      expect((await router(post(JSON.stringify({ events: [event] })))).status).toBe(200)
    }
    expect(delivered).toEqual([])
  })

  it('answers 200 on an empty events list', async () => {
    const { router } = rig()
    expect((await router(post(JSON.stringify({ events: [] })))).status).toBe(200)
  })

  it('verifies the signature over the raw bytes, not a re-serialised body', async () => {
    const { delivered, router } = rig()
    const body = `{ "events" : [ ${JSON.stringify(text('spaced'))} ] }`
    expect((await router(post(body))).status).toBe(200)
    expect(delivered).toEqual(['spaced'])
  })

  it('answers 405 for a method the route does not take', async () => {
    const { router } = rig()
    expect((await router(new Request('http://localhost/webhooks/line', { method: 'GET' }))).status).toBe(405)
  })

  it('refuses a body over 1 MiB with 413', async () => {
    const { router } = rig()
    expect((await router(post('x'.repeat(1024 * 1024 + 1)))).status).toBe(413)
  })

  it('answers 500 when the handler path throws', async () => {
    const { adapter, router } = rig()
    Object.assign(adapter, { dispatchWebhookBody: async () => { throw new Error('boom') } })
    expect((await router(post(JSON.stringify({ events: [text('hi')] })))).status).toBe(500)
  })
})
