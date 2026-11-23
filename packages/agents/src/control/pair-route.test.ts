import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDevicePairing } from './device-pairing.js'
import { pairRoute } from './pair-route.js'

const CRED = 'abcdefghijklmnopqrstuvwxyz012345'
const setup = (maxPending?: number) => {
  const pairing = createDevicePairing({
    dir: mkdtempSync(join(tmpdir(), 'pair-route-')),
    ...(maxPending === undefined ? {} : { maxPending }),
  })
  return { pairing, route: pairRoute(pairing) }
}
const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('http://x/pair', { method: 'POST', body, headers })

describe('pairRoute', () => {
  it('accepts the reference wire format { code, name, token } and answers 202', async () => {
    const { pairing, route } = setup()
    const res = await route(
      post(JSON.stringify({ code: pairing.issueCode(), name: 'p', token: CRED })),
    )
    expect(res.status).toBe(202)
    const text = await res.text()
    expect(text).not.toContain(CRED)
    expect(pairing.pending()).toHaveLength(1)
  })

  it('accepts credential as an alias for token', async () => {
    const { pairing, route } = setup()
    const res = await route(
      post(JSON.stringify({ code: pairing.issueCode(), name: 'p', credential: CRED })),
    )
    expect(res.status).toBe(202)
  })

  it('answers 401 for a spent code and never echoes the credential', async () => {
    const { pairing, route } = setup()
    const body = JSON.stringify({ code: pairing.issueCode(), name: 'p', token: CRED })
    await route(post(body))
    const res = await route(post(body))
    expect(res.status).toBe(401)
    expect(await res.text()).not.toContain(CRED)
  })

  it('answers 400 for bad_credential and bad_name', async () => {
    const { pairing, route } = setup()
    const code = pairing.issueCode()
    expect((await route(post(JSON.stringify({ code, name: 'p', token: 'short' })))).status).toBe(
      400,
    )
    expect((await route(post(JSON.stringify({ code, name: ' ', token: CRED })))).status).toBe(400)
  })

  it('answers 400 bad_body for invalid JSON and non-string fields', async () => {
    const { pairing, route } = setup()
    const code = pairing.issueCode()
    for (const body of [
      'nope',
      'null',
      JSON.stringify({ code, name: 'p' }),
      JSON.stringify({ code, name: 5, token: CRED }),
      JSON.stringify({ code: 1, name: 'p', token: CRED }),
      JSON.stringify({ code, name: 'p', token: 12345 }),
    ]) {
      const res = await route(post(body))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad_body' })
    }
  })

  it('answers 429 once maxPending requests wait', async () => {
    const { pairing, route } = setup(1)
    const one = JSON.stringify({ code: pairing.issueCode(), name: 'a', token: CRED })
    expect((await route(post(one))).status).toBe(202)
    const two = JSON.stringify({ code: pairing.issueCode(), name: 'b', token: `${CRED}2` })
    expect((await route(post(two))).status).toBe(429)
  })

  it('answers 413 for a body over 64 KiB, by Content-Length and by streamed size', async () => {
    const { route } = setup()
    expect((await route(post('x', { 'content-length': '70000' }))).status).toBe(413)
    expect((await route(post('x'.repeat(70_000)))).status).toBe(413)
  })

  it('answers 405 with Allow: POST for another method', async () => {
    const { route } = setup()
    const res = await route(new Request('http://x/pair'))
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })

  it('renames a refusal reason and passes the request to cityOf', async () => {
    const { pairing } = setup()
    const route = pairRoute(pairing, {
      errorNames: { bad_credential: 'bad_token' },
      cityOf: (request) => request.headers.get('x-city') ?? undefined,
    })
    const refused = await route(
      post(JSON.stringify({ code: pairing.issueCode(), name: 'p', token: 'short' })),
    )
    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({ error: 'bad_token' })
    const accepted = await route(
      post(JSON.stringify({ code: pairing.issueCode(), name: 'p', token: CRED }), {
        'x-city': 'Oslo',
      }),
    )
    expect(accepted.status).toBe(202)
    expect(pairing.pending()[0]?.city).toBe('Oslo')
  })
})
