import { describe, expect, it, vi } from 'vitest'

import { runCli } from '../src/cli.js'
import { placeCall } from '../src/voice/outbound-call.js'
import { harness } from './support/cli-harness.js'

const env = {
  THEOCLAW_VOICE_CALL_TWILIO_ACCOUNT_SID: 'ACabc',
  THEOCLAW_VOICE_CALL_TWILIO_AUTH_TOKEN: 'tok-secret',
  THEOCLAW_VOICE_CALL_FROM_NUMBER: '+15550199',
  THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS: '+15550100, +15550101',
}
const ok = () => vi.fn(async () => new Response(JSON.stringify({ sid: 'CA123' }), { status: 201 }))

describe('placeCall', () => {
  it('posts the form with basic auth and escapes the message', async () => {
    const fetch = ok()
    const sid = await placeCall({ env, to: '+15550100', message: 'a < b & c', fetch })
    expect(sid).toBe('CA123')
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACabc/Calls.json')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('ACabc:tok-secret').toString('base64')}`,
    )
    const form = init.body as URLSearchParams
    expect(form.get('To')).toBe('+15550100')
    expect(form.get('From')).toBe('+15550199')
    expect(form.get('Twiml')).toBe('<Response><Say>a &lt; b &amp; c</Say></Response>')
  })

  it('refuses bad, unlisted numbers and an unset list without a request', async () => {
    const fetch = ok()
    await expect(placeCall({ env, to: '5550100', message: 'x', fetch })).rejects.toThrow(/E\.164/)
    await expect(placeCall({ env, to: '+15550333', message: 'x', fetch })).rejects.toThrow(/ALLOWED_NUMBERS/)
    await expect(
      placeCall({ env: { ...env, THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS: undefined }, to: '+15550100', message: 'x', fetch }),
    ).rejects.toThrow(/not set/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('names a missing credential', async () => {
    await expect(
      placeCall({ env: { ...env, THEOCLAW_VOICE_CALL_FROM_NUMBER: undefined }, to: '+15550100', message: 'x', fetch: ok() }),
    ).rejects.toThrow('THEOCLAW_VOICE_CALL_FROM_NUMBER')
  })

  it('reports Twilio errors without the token', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'bad tok-secret' }), { status: 401 }))
    const error = await placeCall({ env, to: '+15550100', message: 'x', fetch }).catch((e: Error) => e)
    expect((error as Error).message).toContain('401')
    expect((error as Error).message).toContain('bad')
    expect((error as Error).message).not.toContain('tok-secret')
  })
})

describe('theoclaw call', () => {
  it('prints the SID and exits 0', async () => {
    const h = harness()
    const fetch = ok()
    const code = await runCli(['call', '+15550100', '--message', 'hi'], { ...h.io, env: { ...h.io.env, ...env }, fetch })
    expect(code).toBe(0)
    expect(h.stdout()).toBe('CA123\n')
  })

  it('exits 2 with the usage when the number is missing', async () => {
    const h = harness()
    expect(await runCli(['call'], h.io)).toBe(2)
    expect(h.stderr()).toContain('theoclaw call')
  })
})
