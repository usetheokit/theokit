import { describe, expect, it } from 'vitest'

import { QQAdapter, signQQ } from '@theokit/gateway-qq'
import { WeChatAdapter, computeWeChatSignature } from '@theokit/gateway-wechat'
import { ZaloAdapter } from '@theokit/gateway-zalo'

import { resolvePlatforms } from '../src/channels/platforms.js'
import { createQueryRoute, createSignedBodyRoute } from '../src/webhooks/weixin-style.js'
import { webhookPlatform } from '../src/webhooks/platform-routes.js'

const json = (body: unknown) => ({ status: 200, text: async () => JSON.stringify(body) })

describe('resolvePlatforms for the Chinese and Vietnamese platforms', () => {
  it('runs each only with every variable set', () => {
    expect(resolvePlatforms({}).skipped).toContainEqual({
      platform: 'qq',
      missing: ['THEOCLAW_QQ_APP_ID', 'THEOCLAW_QQ_APP_SECRET'],
    })
    const resolved = resolvePlatforms({ THEOCLAW_QQ_APP_ID: '1', THEOCLAW_QQ_APP_SECRET: 'sec' })
    expect(resolved.configured).toEqual([{ platform: 'qq', settings: { appId: '1', appSecret: 'sec' } }])
    expect(resolved.secrets).toContain('sec')
  })

  it('gives every one a webhook route', () => {
    const deps = { write: () => undefined, verifierFactory: () => ({}) as never }
    expect(webhookPlatform({ platform: 'wechat', settings: { appId: 'a', appSecret: 's', token: 't' } }, deps)?.methods).toEqual(['GET', 'POST'])
    expect(webhookPlatform({ platform: 'zalo', settings: { appId: 'a', oaSecretKey: 'k', accessToken: 't' } }, deps)?.methods).toEqual(['POST'])
  })
})

describe('WeChat route', () => {
  const sent: string[] = []
  const fetchStub = async (url: string, init: { body?: string }) => {
    if (url.includes('/cgi-bin/token')) return json({ access_token: 'tok', expires_in: 7200 })
    sent.push(init.body ?? '')
    return json({ errcode: 0 })
  }
  const adapter = new WeChatAdapter({ appId: 'wx1', appSecret: 's', token: 'tk', fetch: fetchStub as never })
  const route = createQueryRoute(adapter)
  const sign = () => {
    const timestamp = '1700000000'
    const nonce = 'n1'
    return `signature=${computeWeChatSignature('tk', timestamp, nonce)}&timestamp=${timestamp}&nonce=${nonce}`
  }

  it('answers the server-URL check and refuses a bad signature', async () => {
    const ok = await route(new Request(`http://x/webhooks/wechat?${sign()}&echostr=hello`))
    expect(await ok.text()).toBe('hello')
    const bad = await route(new Request('http://x/webhooks/wechat?signature=zz&timestamp=1&nonce=2&echostr=hello'))
    expect(bad.status).toBe(401)
  })

  it('replies pong to a DM', async () => {
    expect(await adapter.connect()).toBe(true)
    adapter.onInbound(async (event) => {
      await adapter.sendMessage({ channel: event.channel, text: 'pong' })
    })
    const xml =
      '<xml><ToUserName><![CDATA[gh]]></ToUserName><FromUserName><![CDATA[u1]]></FromUserName><CreateTime>1700000000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[Responda só: pong]]></Content><MsgId>1</MsgId></xml>'
    const response = await route(new Request(`http://x/webhooks/wechat?${sign()}`, { method: 'POST', body: xml }))
    expect(response.status).toBe(200)
    expect(sent.join('\n')).toContain('pong')
  })
})

describe('signed-body routes', () => {
  it('QQ answers the callback URL validation with a signed token', async () => {
    const adapter = new QQAdapter({ appId: 'a', appSecret: 'secret', fetch: (async () => json({})) as never })
    const route = createSignedBodyRoute(adapter, ['x-signature-ed25519', 'x-signature-timestamp'])
    const body = JSON.stringify({ op: 13, d: { plain_token: 'pt', event_ts: '1700000000' } })
    const ts = String(Math.floor(Date.now() / 1000))
    const signature = signQQ('secret', ts + body)
    const response = await route(
      new Request('http://x/webhooks/qq', {
        method: 'POST',
        headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': ts },
        body,
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ plain_token: 'pt', signature: signQQ('secret', '1700000000pt') })
  })

  it('Zalo refuses an unsigned callback', async () => {
    const adapter = new ZaloAdapter({ appId: 'a', oaSecretKey: 'k', accessToken: 't', fetch: (async () => json({})) as never })
    const route = createSignedBodyRoute(adapter, ['x-zevent-signature'])
    expect((await route(new Request('http://x/webhooks/zalo', { method: 'POST', body: '{}' }))).status).toBe(401)
  })
})
