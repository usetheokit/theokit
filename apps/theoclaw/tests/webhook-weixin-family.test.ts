import { describe, expect, it } from 'vitest'

import { computeWeChatSignature, WeChatAdapter } from '@theokit/gateway-wechat'
import { computeYuanbaoSignature, YuanbaoAdapter } from '@theokit/gateway-yuanbao'
import { computeZaloSignature, ZaloAdapter } from '@theokit/gateway-zalo'
import type { MessageEvent } from '@theokit/gateway'

import { createWeixinRoute, createYuanbaoRoute, createZaloRoute } from '../src/webhooks/weixin-family.js'

function collect(adapter: { onInbound(h: (e: MessageEvent) => Promise<void>): unknown }): MessageEvent[] {
  const events: MessageEvent[] = []
  adapter.onInbound(async (event) => {
    events.push(event)
  })
  return events
}

describe('WeChat route', () => {
  const adapter = new WeChatAdapter({ appId: 'a', appSecret: 's', token: 'tok' })
  const route = createWeixinRoute(adapter as never)
  const query = (signature?: string) =>
    `timestamp=1&nonce=n&signature=${signature ?? computeWeChatSignature('tok', '1', 'n')}`

  it('answers the server-URL check with the echostr', async () => {
    const response = await route(new Request(`http://x/webhooks/wechat?${query()}&echostr=hello`))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('hello')
  })

  it('refuses a bad signature with 401', async () => {
    const response = await route(new Request(`http://x/webhooks/wechat?${query('bad')}`, { method: 'POST', body: '<xml/>' }))
    expect(response.status).toBe(401)
  })

  it('delivers a signed text message', async () => {
    const events = collect(adapter)
    const xml =
      '<xml><ToUserName>gh</ToUserName><FromUserName>u1</FromUserName><CreateTime>1</CreateTime><MsgType>text</MsgType><Content>Responda só: pong</Content><MsgId>7</MsgId></xml>'
    const response = await route(new Request(`http://x/webhooks/wechat?${query()}`, { method: 'POST', body: xml }))
    expect(response.status).toBe(200)
    expect(events).toHaveLength(1)
    expect(events[0]?.text).toBe('Responda só: pong')
  })
})

describe('Yuanbao route', () => {
  const adapter = new YuanbaoAdapter({ appId: 'a', appSecret: 's', callbackSecret: 'cb' })
  const route = createYuanbaoRoute(adapter as never)
  const body = JSON.stringify({
    event_id: 'e1',
    type: 'message',
    message: { id: 'm1', text: 'Responda só: pong', create_time: 1, from: { id: 'u1' } },
  })

  it('refuses a request with no signature', async () => {
    expect((await route(new Request('http://x/webhooks/yuanbao', { method: 'POST', body }))).status).toBe(401)
  })

  it('delivers a signed message', async () => {
    const events = collect(adapter)
    const ts = String(Math.floor(Date.now() / 1000))
    const response = await route(
      new Request('http://x/webhooks/yuanbao', {
        method: 'POST',
        body,
        headers: { 'x-timestamp': ts, 'x-signature': computeYuanbaoSignature('cb', ts, body) },
      }),
    )
    expect(response.status).toBe(200)
    expect(events).toHaveLength(1)
  })
})

describe('Zalo route', () => {
  const adapter = new ZaloAdapter({ appId: 'app', oaSecretKey: 'k', accessToken: 't' })
  const route = createZaloRoute(adapter as never)
  const body = JSON.stringify({
    app_id: 'app',
    event_name: 'user_send_text',
    sender: { id: 'u1' },
    recipient: { id: 'oa' },
    message: { text: 'Responda só: pong', msg_id: 'm1' },
    timestamp: '5',
  })

  it('refuses a forged signature', async () => {
    const response = await route(
      new Request('http://x/webhooks/zalo', { method: 'POST', body, headers: { 'x-zevent-signature': 'mac=00' } }),
    )
    expect(response.status).toBe(401)
  })

  it('answers 503 when nothing is subscribed, 200 once something is', async () => {
    const headers = { 'x-zevent-signature': `mac=${computeZaloSignature('app', body, '5', 'k')}` }
    const post = () => route(new Request('http://x/webhooks/zalo', { method: 'POST', body, headers }))
    expect((await post()).status).toBe(503)
    const events = collect(adapter)
    expect((await post()).status).toBe(200)
    expect(events).toHaveLength(1)
  })
})
