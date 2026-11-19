import { createHmac, randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  decodeBase64Signature,
  decodeHexSignature,
  verifyHmacSha256,
} from '../../packages/theo/src/server/webhook/index.js'

const sign = (secret: string, body: string) =>
  createHmac('sha256', secret).update(body).digest('base64')

const req = (body: string, sig?: string) =>
  new Request('https://x.test/hook', {
    method: 'POST',
    body,
    headers: sig === undefined ? {} : { 'x-webhook-signature': sig },
  })

const verify = verifyHmacSha256({
  header: 'x-webhook-signature',
  secrets: ['old', 'new'],
  option: 'signatureKey',
  decode: decodeBase64Signature,
})

describe('verifyHmacSha256 (public)', () => {
  it('accepts either rotated secret', async () => {
    expect(await verify(req('{}', sign('old', '{}')))).toEqual({ ok: true })
    expect(await verify(req('{}', sign('new', '{}')))).toEqual({ ok: true })
  })

  it('rejects a third secret', async () => {
    expect(await verify(req('{}', sign('third', '{}')))).toEqual({
      ok: false,
      reason: 'signature mismatch',
    })
  })

  it('reports a missing header and a non-base64 header', async () => {
    expect(await verify(req('{}'))).toEqual({
      ok: false,
      reason: 'missing x-webhook-signature header',
    })
    expect(await verify(req('{}', '!!not base64!!'))).toEqual({
      ok: false,
      reason: 'malformed signature base64',
    })
  })

  it('refuses when no secret is configured', async () => {
    const v = verifyHmacSha256({
      header: 'x-webhook-signature',
      secrets: '',
      option: 'signatureKey',
      decode: decodeBase64Signature,
    })
    const r = await v(req('{}', sign('x', '{}')))
    expect(r.ok).toBe(false)
  })
})

describe('verifyHmacSha256 raw bytes', () => {
  it('verifies a body whose bytes do not survive a UTF-8 text round trip', async () => {
    // Leading BOM plus an invalid sequence: `text()` would drop the first and rewrite the second.
    const body = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0xff, 0xfe, 0x7d])
    const secret = randomBytes(32).toString('hex')
    const sig = createHmac('sha256', secret).update(body).digest('base64')
    const verifyRaw = verifyHmacSha256({
      header: 'x-webhook-signature',
      secrets: [secret],
      option: 'signatureKey',
      decode: decodeBase64Signature,
    })
    const r = await verifyRaw(
      new Request('https://x.test/hook', {
        method: 'POST',
        body,
        headers: { 'x-webhook-signature': sig },
      }),
    )
    expect(r).toEqual({ ok: true })
  })
})

describe('decodeHexSignature', () => {
  it('names the prefix when it is missing', () => {
    const r = decodeHexSignature('sha256=')('abcd')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('sha256=')
  })

  it('decodes hex with and without a prefix, and rejects bad hex', () => {
    expect(decodeHexSignature('sha256=')('sha256=0aff')).toEqual({
      ok: true,
      bytes: new Uint8Array([0x0a, 0xff]),
    })
    expect(decodeHexSignature()('0aff').ok).toBe(true)
    expect(decodeHexSignature()('zz')).toEqual({ ok: false, reason: 'malformed signature hex' })
    expect(decodeHexSignature()('abc')).toEqual({ ok: false, reason: 'malformed signature hex' })
  })
})
