import { createHmac } from 'node:crypto'

import { computeWeChatSignature, WeChatAdapter } from '@theokit/gateway-wechat'
import { YuanbaoAdapter } from '@theokit/gateway-yuanbao'
import { QQAdapter } from '@theokit/gateway-qq'
import { describe, expect, it } from 'vitest'

import { createQqRoute, createYuanbaoRoute } from '../src/webhooks/signed-json.js'
import { createWeixinRoute } from '../src/webhooks/weixin.js'

type Call = { url: string; body: string }

function stubFetch(calls: Call[]) {
  return async (url: string, init: { body?: string }) => {
    calls.push({ url, body: init.body ?? '' })
    const text = url.includes('token') ? '{"access_token":"tok","expires_in":7200,"code":0,"data":{"access_token":"tok","expires_in":7200}}' : '{"errcode":0,"code":0}'
    return { status: 200, text: async () => text }
  }
}

describe('WeChat route', () => {
  it('echoes the verification, then answers a DM with pong', async () => {
    const calls: Call[] = []
    const adapter = new WeChatAdapter({ appId: 'wx', appSecret: 's', token: 'tk', fetch: stubFetch(calls) as never })
    adapter.onInbound(async (event) => {
      await adapter.sendMessage({ channel: event.channel, text: 'pong' })
    })
    await adapter.connect()
    const route = createWeixinRoute(adapter)
    const signed = (): string => {
      const q = new URLSearchParams({ timestamp: '1', nonce: 'n', signature: computeWeChatSignature('tk', '1', 'n') })
      return q.toString()
    }

    const check = await route(new Request(`http://x/webhooks/wechat?${signed()}&echostr=hello`))
    expect(check.status).toBe(200)
    expect(await check.text()).toBe('hello')

    const xml = '<xml><ToUserName>a</ToUserName><FromUserName>u1</FromUserName><CreateTime>1</CreateTime><MsgType>text</MsgType><Content>Responda só: pong</Content><MsgId>1</MsgId></xml>'
    const post = await route(new Request(`http://x/webhooks/wechat?${signed()}`, { method: 'POST', body: xml }))
    expect(post.status).toBe(200)
    expect(calls.some((call) => call.body.includes('pong'))).toBe(true)

    const bad = await route(new Request('http://x/webhooks/wechat?signature=zz&timestamp=1&nonce=n', { method: 'POST', body: xml }))
    expect(bad.status).toBe(401)
  })
})

describe('Yuanbao route', () => {
  it('answers a signed DM with pong and refuses a bad signature', async () => {
    const calls: Call[] = []
    const adapter = new YuanbaoAdapter({ appId: 'a', appSecret: 's', callbackSecret: 'cb', fetch: stubFetch(calls) as never })
    adapter.onInbound(async (event) => {
      await adapter.sendMessage({ channel: event.channel, text: 'pong' })
    })
    await adapter.connect()
    const route = createYuanbaoRoute(adapter)
    const body = JSON.stringify({ event_id: 'e1', type: 'message', message: { id: 'm1', text: 'Responda só: pong', create_time: 1, from: { id: 'u1' } } })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = createHmac('sha256', 'cb').update(`${timestamp}.${body}`).digest('hex')

    const ok = await route(new Request('http://x/webhooks/yuanbao', { method: 'POST', body, headers: { 'x-signature': signature, 'x-timestamp': timestamp } }))
    expect(ok.status).toBe(200)
    expect(calls.some((call) => call.body.includes('pong'))).toBe(true)

    const bad = await route(new Request('http://x/webhooks/yuanbao', { method: 'POST', body, headers: { 'x-signature': 'no', 'x-timestamp': timestamp } }))
    expect(bad.status).toBe(401)
  })
})

describe('QQ route', () => {
  it('refuses an unsigned callback', async () => {
    const adapter = new QQAdapter({ appId: 'a', appSecret: 's', fetch: stubFetch([]) as never })
    const route = createQqRoute(adapter)
    const res = await route(new Request('http://x/webhooks/qq', { method: 'POST', body: '{"op":0}' }))
    expect(res.status).toBe(401)
  })
})
