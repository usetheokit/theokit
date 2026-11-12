import 'reflect-metadata'

import { createHmac } from 'node:crypto'

import type { BasePlatformAdapter, PlatformName } from '@theokit/gateway'
import { signQQ } from '@theokit/gateway-qq'
import { computeWeChatSignature } from '@theokit/gateway-wechat'
import { computeWeComSignature, encryptWeCom } from '@theokit/gateway-wecom'
import { computeZaloSignature } from '@theokit/gateway-zalo'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { adapterBuilders } from '../src/channels/adapter-factory.js'
import { resolvePlatforms } from '../src/channels/platforms.js'
import { webhookPlatform, withRoute } from '../src/webhooks/platform-routes.js'
import type { Handle } from '../src/webhooks/platform-routes.js'
import { createWebhookRouter } from '../src/webhooks/router.js'
import type { WebhookRoute } from '../src/webhooks/router.js'

afterEach(() => vi.unstubAllGlobals())

const PONG = 'Responda só: pong'
const KEY = 'a'.repeat(43)

const ENVS = {
  wechat: { THEOCLAW_WECHAT_APP_ID: 'wx', THEOCLAW_WECHAT_APP_SECRET: 's', THEOCLAW_WECHAT_TOKEN: 'tk' },
  wecom: {
    THEOCLAW_WECOM_CORP_ID: 'corp',
    THEOCLAW_WECOM_CORP_SECRET: 's',
    THEOCLAW_WECOM_AGENT_ID: '1000002',
    THEOCLAW_WECOM_TOKEN: 'tk',
    THEOCLAW_WECOM_ENCODING_AES_KEY: KEY,
  },
  yuanbao: { THEOCLAW_YUANBAO_APP_ID: 'a', THEOCLAW_YUANBAO_APP_SECRET: 's', THEOCLAW_YUANBAO_CALLBACK_SECRET: 'cb' },
  qq: { THEOCLAW_QQ_APP_ID: 'a', THEOCLAW_QQ_APP_SECRET: 'secret' },
  zalo: { THEOCLAW_ZALO_APP_ID: 'app', THEOCLAW_ZALO_OA_SECRET_KEY: 'oa', THEOCLAW_ZALO_ACCESS_TOKEN: 'at' },
} as const

interface Rig {
  readonly call: (request: Request) => Promise<Response>
  readonly start: () => Promise<void>
  readonly sent: string[]
}

/**
 * One platform composed the way the instance composes it: settings from the environment, the
 * adapter factory, the webhook table and the router. Only the network is stubbed.
 */
function rig(platform: keyof typeof ENVS): Rig {
  const sent: string[] = []
  vi.stubGlobal('fetch', async (target: string, init?: { body?: string }) => {
    sent.push(init?.body ?? '')
    // QQ's token endpoint answers a `code` only on failure.
    if (target.includes('getAppAccessToken')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: '7200' }))
    return new Response(
      JSON.stringify({ access_token: 'tok', expires_in: 7200, errcode: 0, code: 0, error: 0, data: { access_token: 'tok', expires_in: 7200 } }),
    )
  })
  const resolved = resolvePlatforms(ENVS[platform])
  const entry = resolved.configured[0]
  if (entry === undefined) throw new Error('not configured')
  const webhook = webhookPlatform(entry, { write: () => undefined, verifierFactory: () => async () => ({ ok: false, reason: 'missing_authorization', message: '' }) })
  const handles = new WeakMap<BasePlatformAdapter, Handle>()
  const build = withRoute(adapterBuilders(resolved.configured)[0]!, webhook, handles)
  const started = new Map<PlatformName, BasePlatformAdapter>()
  const adapter = build.build()
  const route: WebhookRoute = {
    methods: webhook?.methods ?? [],
    handle: async (request) => {
      const handle = handles.get(adapter)
      return handle === undefined ? new Response(null, { status: 503 }) : handle(request)
    },
  }
  const call = createWebhookRouter({
    routes: new Map([[platform, route]]),
    isStarted: (name) => started.has(name),
    write: () => undefined,
  })
  return {
    call,
    sent,
    start: async () => {
      adapter.onInbound(async (event) => {
        await adapter.sendMessage({ channel: event.channel, text: 'pong' })
      })
      await adapter.connect()
      started.set(platform, adapter)
    },
  }
}

const url = (platform: string, query = ''): string => `http://theoclaw.test/webhooks/${platform}${query}`
const ponged = (r: Rig): boolean => r.sent.some((body) => body.includes('pong'))

describe('WeChat', () => {
  it('echoes the verification and answers a DM with pong', async () => {
    const r = rig('wechat')
    expect((await r.call(new Request(url('wechat', '?signature=x')))).status).toBe(503)
    await r.start()
    const q = new URLSearchParams({ timestamp: '1', nonce: 'n', signature: computeWeChatSignature('tk', '1', 'n') }).toString()
    const check = await r.call(new Request(url('wechat', `?${q}&echostr=hello`)))
    expect(await check.text()).toBe('hello')

    const xml = `<xml><ToUserName>a</ToUserName><FromUserName>u1</FromUserName><CreateTime>1</CreateTime><MsgType>text</MsgType><Content>${PONG}</Content><MsgId>1</MsgId></xml>`
    expect((await r.call(new Request(url('wechat', `?${q}`), { method: 'POST', body: xml }))).status).toBe(200)
    expect(ponged(r)).toBe(true)
    expect((await r.call(new Request(url('wechat', '?signature=zz&timestamp=1&nonce=n'), { method: 'POST', body: xml }))).status).toBe(401)
    expect((await r.call(new Request(url('wechat'), { method: 'PUT' }))).status).toBe(405)
  })
})

describe('WeCom', () => {
  it('decrypts the verification and answers an encrypted DM with pong', async () => {
    const r = rig('wecom')
    await r.start()
    const query = (encrypted: string): string =>
      new URLSearchParams({ timestamp: '1', nonce: 'n', msg_signature: computeWeComSignature('tk', '1', 'n', encrypted) }).toString()

    const echo = encryptWeCom(KEY, 'hello', 'corp')
    const check = await r.call(new Request(url('wecom', `?${query(echo)}&echostr=${encodeURIComponent(echo)}`)))
    expect(await check.text()).toBe('hello')

    const inner = `<xml><ToUserName>corp</ToUserName><FromUserName>u1</FromUserName><CreateTime>1</CreateTime><MsgType>text</MsgType><Content>${PONG}</Content><MsgId>1</MsgId><AgentID>1000002</AgentID></xml>`
    const encrypted = encryptWeCom(KEY, inner, 'corp')
    const body = `<xml><ToUserName>corp</ToUserName><Encrypt>${encrypted}</Encrypt></xml>`
    expect((await r.call(new Request(url('wecom', `?${query(encrypted)}`), { method: 'POST', body }))).status).toBe(200)
    expect(ponged(r)).toBe(true)
    expect((await r.call(new Request(url('wecom', '?msg_signature=zz&timestamp=1&nonce=n'), { method: 'POST', body }))).status).toBe(401)
  })
})

describe('Yuanbao', () => {
  it('answers a signed DM with pong, refuses a bad signature and is 503 before start', async () => {
    const r = rig('yuanbao')
    const body = JSON.stringify({ event_id: 'e1', type: 'message', message: { id: 'm1', text: PONG, create_time: 1, from: { id: 'u1' } } })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const headers = { 'x-signature': createHmac('sha256', 'cb').update(`${timestamp}.${body}`).digest('hex'), 'x-timestamp': timestamp }
    expect((await r.call(new Request(url('yuanbao'), { method: 'POST', body, headers }))).status).toBe(503)
    await r.start()
    expect((await r.call(new Request(url('yuanbao'), { method: 'POST', body, headers }))).status).toBe(200)
    expect(ponged(r)).toBe(true)
    expect((await r.call(new Request(url('yuanbao'), { method: 'POST', body, headers: { ...headers, 'x-signature': 'no' } }))).status).toBe(401)
    expect((await r.call(new Request(url('yuanbao'), { method: 'GET' }))).status).toBe(405)
  })
})

describe('QQ Bot', () => {
  it('answers the op-13 validation and a signed C2C message with pong', async () => {
    const r = rig('qq')
    await r.start()
    const ts = String(Math.floor(Date.now() / 1000))
    const post = (payload: unknown, signature?: string): Promise<Response> => {
      const body = JSON.stringify(payload)
      return r.call(
        new Request(url('qq'), {
          method: 'POST',
          body,
          headers: { 'x-signature-ed25519': signature ?? signQQ('secret', ts + body), 'x-signature-timestamp': ts },
        }),
      )
    }

    const validation = await post({ op: 13, d: { plain_token: 'pt', event_ts: '123' } })
    expect(validation.status).toBe(200)
    expect(await validation.json()).toEqual({ plain_token: 'pt', signature: signQQ('secret', '123pt') })

    const message = { id: 'e1', op: 0, t: 'C2C_MESSAGE_CREATE', d: { id: 'm1', content: PONG, timestamp: new Date().toISOString(), author: { user_openid: 'u1' } } }
    expect((await post(message)).status).toBe(200)
    expect(ponged(r)).toBe(true)
    expect((await post(message, 'ab')).status).toBe(401)
  })
})

describe('Zalo', () => {
  it('answers a signed DM with pong and refuses a bad signature', async () => {
    const r = rig('zalo')
    await r.start()
    const timestamp = Date.now()
    const body = JSON.stringify({
      app_id: 'app',
      event_name: 'user_send_text',
      sender: { id: 'u1' },
      recipient: { id: 'oa' },
      message: { text: PONG, msg_id: 'm1' },
      timestamp,
    })
    const signature = `mac=${computeZaloSignature('app', body, String(timestamp), 'oa')}`
    expect((await r.call(new Request(url('zalo'), { method: 'POST', body, headers: { 'x-zevent-signature': signature } }))).status).toBe(200)
    expect(ponged(r)).toBe(true)
    expect((await r.call(new Request(url('zalo'), { method: 'POST', body, headers: { 'x-zevent-signature': 'mac=00' } }))).status).toBe(401)
  })
})
