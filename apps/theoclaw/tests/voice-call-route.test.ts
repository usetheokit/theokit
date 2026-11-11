import { describe, expect, it } from 'vitest'

import { composeTheoClaw } from '../src/composition.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { readVoiceCallSettings, twilioSignature } from '../src/voice/phone-call.js'
import { fakeBuilders, noAgent, WORKSPACE } from './composition-fixtures.js'
import { assistant, FakeAgent, finished } from './fakes.js'

const URL_ = 'https://theoclaw.example.org/webhooks/voice'
const TOKEN = 'voice-auth-token-value'
const ENV = {
  THEOCLAW_OWNERS: 'telegram:owner',
  THEOCLAW_DM_POLICY: 'allowlist',
  THEOCLAW_WORKSPACE: WORKSPACE,
  THEOCLAW_MODEL: 'anthropic/x',
  THEOKIT_API_KEY: 'k',
  THEOCLAW_VOICE_CALL_TWILIO_AUTH_TOKEN: TOKEN,
  THEOCLAW_VOICE_CALL_PUBLIC_URL: URL_,
  THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS: '+14155550100',
}

function post(fields: Record<string, string>, sign = true): Request {
  const params = new URLSearchParams(fields)
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
  if (sign) headers['x-twilio-signature'] = twilioSignature(TOKEN, URL_, params)
  return new Request('http://127.0.0.1:8787/webhooks/voice', {
    method: 'POST',
    headers,
    body: params.toString(),
  })
}

function app(reply = 'It is noon.', env: Record<string, string> = ENV) {
  const sent: string[] = []
  const { router } = composeTheoClaw({
    env,
    agentFactory: noAgent,
    builders: fakeBuilders({}).builders,
    write: () => undefined,
    getOrCreate: async () => {
      const agent = new FakeAgent({ frames: [assistant(reply), finished()] })
      const send = agent.send.bind(agent)
      agent.send = async (text, options) => {
        sent.push(text)
        return send(text, options)
      }
      return Object.assign(agent, { dispose: async () => undefined })
    },
  })
  return { router, sent }
}

const CALL = { CallSid: 'CA1', From: '+14155550100' }

describe('the composed voice call route', () => {
  it('greets and listens', async () => {
    const response = await app().router(post(CALL))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/xml')
    const body = await response.text()
    expect(body).toContain('<Gather')
    expect(body).toContain('input="speech"')
  })

  it('runs one turn and speaks the reply, then listens again', async () => {
    const { router, sent } = app('It is <noon> & sunny.')
    const body = await (await router(post({ ...CALL, SpeechResult: 'what time is it' }))).text()
    expect(sent).toEqual(['what time is it'])
    expect(body).toContain('<Say>It is &lt;noon&gt; &amp; sunny.</Say>')
    expect(body).toContain('<Gather')
  })

  it('a caller who says what time is it hears a spoken answer', async () => {
    const { router, sent } = app('It is twelve o clock.')
    const body = await (await router(post({ ...CALL, SpeechResult: 'what time is it' }))).text()
    expect(sent).toEqual(['what time is it'])
    expect(body).toMatch(/<Say>It is twelve o clock\.<\/Say>/)
  })

  it('answers 401 without a valid signature and runs no turn', async () => {
    const { router, sent } = app()
    expect((await router(post({ ...CALL, SpeechResult: 'hi' }, false))).status).toBe(401)
    const wrong = post({ ...CALL, SpeechResult: 'hi' })
    const forged = new Request(wrong.url, {
      method: 'POST',
      headers: {
        'x-twilio-signature': 'AAAA',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'CallSid=CA1&From=%2B14155550100&SpeechResult=hi',
    })
    expect((await router(forged)).status).toBe(401)
    expect(sent).toEqual([])
  })

  it('refuses a caller outside the allowed numbers', async () => {
    const { router, sent } = app()
    const body = await (
      await router(post({ CallSid: 'CA2', From: '+19995550000', SpeechResult: 'hi' }))
    ).text()
    expect(body).toContain('<Hangup/>')
    expect(sent).toEqual([])
  })

  it('ends the call after two silences in a row, or a goodbye', async () => {
    const { router } = app()
    expect(await (await router(post(CALL))).text()).not.toContain('<Hangup/>')
    expect(await (await router(post(CALL))).text()).not.toContain('<Hangup/>')
    expect(await (await router(post(CALL))).text()).toContain('<Hangup/>')
    const bye = await (
      await router(post({ CallSid: 'CA3', From: '+14155550100', SpeechResult: 'Goodbye.' }))
    ).text()
    expect(bye).toContain('<Hangup/>')
  })

  it('truncates a long reply', async () => {
    const body = await (
      await app('a'.repeat(5000)).router(post({ ...CALL, SpeechResult: 'x' }))
    ).text()
    expect(body.length).toBeLessThan(1500)
  })

  it('is absent without the settings', async () => {
    const {
      THEOCLAW_VOICE_CALL_TWILIO_AUTH_TOKEN: _a,
      THEOCLAW_VOICE_CALL_PUBLIC_URL: _b,
      THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS: _c,
      ...bare
    } = ENV
    expect((await app('x', bare).router(post(CALL))).status).toBe(404)
  })

  it('names the missing variable when only one is set', () => {
    const { THEOCLAW_VOICE_CALL_PUBLIC_URL: _b, ...noUrl } = ENV
    expect(() => readVoiceCallSettings(noUrl)).toThrow(TheoClawConfigError)
    expect(() => readVoiceCallSettings(noUrl)).toThrow(/THEOCLAW_VOICE_CALL_PUBLIC_URL/)
    expect(() =>
      readVoiceCallSettings({ ...ENV, THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS: '555' }),
    ).toThrow(/E\.164/)
  })
})
