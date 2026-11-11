import { describe, expect, it } from 'vitest'

import { UsageError } from '../src/cli-args.js'
import { runCli } from '../src/cli.js'
import { placeCall } from '../src/voice/outbound-call.js'
import { cleanScratch, harness } from './support/cli-harness.js'
import { afterEach } from 'vitest'

afterEach(cleanScratch)

const env = {
  THEOCLAW_VOICE_CALL_TWILIO_ACCOUNT_SID: 'ACabc',
  THEOCLAW_VOICE_CALL_TWILIO_AUTH_TOKEN: 'sekret-token',
  THEOCLAW_VOICE_CALL_FROM_NUMBER: '+15550199',
  THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS: '+15550100, +15550101',
}

function stub(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  }) as unknown as typeof globalThis.fetch
  return { calls, fetch }
}

describe('placeCall', () => {
  it('posts a basic-auth form with escaped TwiML and returns the SID', async () => {
    const s = stub(201, { sid: 'CA123' })
    expect(await placeCall({ env, to: '+15550100', message: 'a < b & c', fetch: s.fetch })).toBe(
      'CA123',
    )
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACabc/Calls.json')
    const headers = s.calls[0]!.init.headers as Record<string, string>
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from('ACabc:sekret-token').toString('base64')}`,
    )
    const form = new URLSearchParams(s.calls[0]!.init.body as string)
    expect(form.get('To')).toBe('+15550100')
    expect(form.get('From')).toBe('+15550199')
    expect(form.get('Twiml')).toBe('<Response><Say>a &lt; b &amp; c</Say></Response>')
  })

  it('refuses bad, unlisted or unconfigured destinations without a request', async () => {
    const s = stub(201, { sid: 'CA123' })
    await expect(
      placeCall({ env, to: '5550100', message: 'x', fetch: s.fetch }),
    ).rejects.toBeInstanceOf(UsageError)
    await expect(
      placeCall({ env, to: '+15550102', message: 'x', fetch: s.fetch }),
    ).rejects.toBeInstanceOf(UsageError)
    const { THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS: _, ...open } = env
    await expect(
      placeCall({ env: open, to: '+15550100', message: 'x', fetch: s.fetch }),
    ).rejects.toThrow(/THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS/)
    expect(s.calls).toHaveLength(0)
  })

  it('names a missing credential', async () => {
    const { THEOCLAW_VOICE_CALL_FROM_NUMBER: _, ...partial } = env
    await expect(placeCall({ env: partial, to: '+15550100', message: 'x' })).rejects.toThrow(
      /THEOCLAW_VOICE_CALL_FROM_NUMBER/,
    )
  })

  it('reports status and message on failure, never the token', async () => {
    const s = stub(401, { message: 'bad sekret-token' })
    const error = await placeCall({ env, to: '+15550100', message: 'x', fetch: s.fetch }).catch(
      (e: Error) => e,
    )
    expect((error as Error).message).toContain('401')
    expect((error as Error).message).not.toContain('sekret-token')
  })
})

describe('theoclaw call', () => {
  it('prints the SID and exits 0; with no number exits 2', async () => {
    const s = stub(201, { sid: 'CA999' })
    const v = harness()
    const io = { ...v.io, env: { ...v.io.env, ...env, THEOCLAW_CONFIG: '' }, fetch: s.fetch }
    expect(await runCli(['call', '+15550100', '--message', 'hi'], io)).toBe(0)
    expect(v.stdout()).toBe('CA999\n')

    const none = harness()
    expect(await runCli(['call'], none.io)).toBe(2)
    expect(none.stderr()).toContain('usage: theoclaw')
  })
})
