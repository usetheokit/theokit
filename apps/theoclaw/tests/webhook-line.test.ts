import { describe, expect, it } from 'vitest'

import type { MessageEvent } from '@theokit/gateway'
import { computeLineSignature } from '@theokit/gateway-line'

import { createLineRoute } from '../src/webhooks/line.js'
import { FakeAdapter } from './fakes.js'

const SECRET = 'line-channel-secret'

function textEvent(id: string, text: string) {
  return {
    type: 'message',
    timestamp: 1,
    source: { type: 'user', userId: `U-${id}` },
    replyToken: `reply-${id}`,
    message: { id, type: 'text', text },
  }
}

function signedPost(body: string, signature = computeLineSignature(SECRET, body)): Request {
  return new Request('http://localhost/webhooks/line', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-signature': signature },
    body,
  })
}

/** A started LINE adapter: subscribed, so deliver() hands each event to the recorded handler. */
function subscribedLine(): { adapter: FakeAdapter; delivered: MessageEvent[] } {
  const adapter = new FakeAdapter('line')
  const delivered: MessageEvent[] = []
  adapter.onInbound(async (event) => {
    delivered.push(event)
  })
  return { adapter, delivered }
}

describe('createLineRoute', () => {
  it('answers 401 on a bad signature', async () => {
    const { adapter, delivered } = subscribedLine()
    const body = JSON.stringify({ events: [textEvent('1', 'hi')] })

    const response = await createLineRoute({ channelSecret: SECRET, adapter })(signedPost(body, 'forged'))

    expect(response.status).toBe(401)
    expect(delivered).toHaveLength(0)
  })

  it('answers 503 when deliver returns no_handler', async () => {
    const adapter = new FakeAdapter('line')
    const body = JSON.stringify({ events: [textEvent('1', 'hi')] })

    const response = await createLineRoute({ channelSecret: SECRET, adapter })(signedPost(body))

    expect(response.status).toBe(503)
  })

  it('delivers once per convertible event', async () => {
    const { adapter, delivered } = subscribedLine()
    const follow = { type: 'follow', timestamp: 1, source: { type: 'user', userId: 'U-3' }, replyToken: 'r-3' }
    const body = JSON.stringify({ events: [textEvent('1', 'one'), follow, textEvent('2', 'two')] })

    const response = await createLineRoute({ channelSecret: SECRET, adapter })(signedPost(body))

    expect(response.status).toBe(200)
    expect(delivered.map((event) => event.text)).toEqual(['one', 'two'])
  })

  it('answers 400 on a body that is not json', async () => {
    const { adapter, delivered } = subscribedLine()

    const response = await createLineRoute({ channelSecret: SECRET, adapter })(signedPost('not json'))

    expect(response.status).toBe(400)
    expect(delivered).toHaveLength(0)
  })

  it('answers 400 when events is not a list', async () => {
    const { adapter } = subscribedLine()

    const response = await createLineRoute({ channelSecret: SECRET, adapter })(
      signedPost(JSON.stringify({ events: 'nope' })),
    )

    expect(response.status).toBe(400)
  })

  it('answers 400 when an event is not an object', async () => {
    const { adapter, delivered } = subscribedLine()

    const response = await createLineRoute({ channelSecret: SECRET, adapter })(
      signedPost(JSON.stringify({ events: [null] })),
    )

    expect(response.status).toBe(400)
    expect(delivered).toHaveLength(0)
  })

  it('answers 400 when an event carries a null message or source', async () => {
    const { adapter, delivered } = subscribedLine()
    const nullMessage = { type: 'message', source: { type: 'user', userId: 'U-1' }, message: null }
    const nullSource = { type: 'message', source: null, message: { id: '1', type: 'text', text: 'x' } }

    for (const event of [nullMessage, nullSource]) {
      const response = await createLineRoute({ channelSecret: SECRET, adapter })(
        signedPost(JSON.stringify({ events: [event] })),
      )
      expect(response.status).toBe(400)
    }
    expect(delivered).toHaveLength(0)
  })

  it('answers 200 on an empty events list', async () => {
    const { adapter } = subscribedLine()

    const response = await createLineRoute({ channelSecret: SECRET, adapter })(
      signedPost(JSON.stringify({ events: [] })),
    )

    expect(response.status).toBe(200)
  })

  it('verifies the signature over the raw bytes, not a re-serialised body', async () => {
    const { adapter, delivered } = subscribedLine()
    const body = `{ "events" : [ ${JSON.stringify(textEvent('1', 'spaced'))} ] }`

    const response = await createLineRoute({ channelSecret: SECRET, adapter })(signedPost(body))

    expect(response.status).toBe(200)
    expect(delivered).toHaveLength(1)
  })
})
