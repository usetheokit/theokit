import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createNodeServer,
  peerAddress,
  trustedIdentity,
  type NodeServer,
  type TrustedProxyOptions,
} from '../../src/runtime-node.js'

let node: NodeServer | undefined
afterEach(async () => {
  await node?.close({ force: true })
  node = undefined
})

async function probe(
  trustedProxy: TrustedProxyOptions | undefined,
  headers: Record<string, string | string[]>,
): Promise<{
  identity?: string
  peer?: string
  protocol: string
  host: string
  hostHeader: string | null
  seen: string | null
  leaked: string | null
}> {
  node = createNodeServer(
    (req) =>
      Response.json({
        identity: trustedIdentity(req),
        peer: peerAddress(req),
        protocol: new URL(req.url).protocol,
        host: new URL(req.url).host,
        hostHeader: req.headers.get('host'),
        seen: req.headers.get('x-theokit-trusted-identity'),
        leaked: req.headers.get('x-user'),
      }),
    { trustedProxy },
  )
  const { port } = await node.listen(0, '127.0.0.1')
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, headers }, (res) => {
      let body = ''
      res.on('data', (d) => (body += String(d)))
      res.on('end', () => resolve(JSON.parse(body)))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('createNodeServer trustedProxy', () => {
  it('believes the identity from an allowlisted peer', async () => {
    const r = await probe(
      { identityHeader: 'x-user', addresses: ['127.0.0.1'] },
      {
        'x-user': 'alice',
        'x-theokit-trusted-identity': 'mallory',
        'x-theokit-peer': 'evil',
        'x-forwarded-proto': 'https',
      },
    )
    expect(r.identity).toBe('alice')
    expect(r.peer).toBe('127.0.0.1')
    expect(r.protocol).toBe('https:')
  })

  it('reads an array-valued identity header such as set-cookie', async () => {
    const r = await probe(
      { identityHeader: 'set-cookie', addresses: ['127.0.0.1'] },
      { 'set-cookie': ['alice', 'bob'] },
    )
    expect(r.identity).toBe('alice')
  })

  it('ignores the identity from another peer and strips spoofed headers', async () => {
    const r = await probe(
      { identityHeader: 'x-user', addresses: ['10.0.0.1'] },
      { 'x-user': 'alice', 'x-theokit-trusted-identity': 'mallory', 'x-forwarded-proto': 'https' },
    )
    expect(r.identity).toBeUndefined()
    expect(r.seen).toBeNull()
    expect(r.leaked).toBeNull()
    expect(r.protocol).toBe('http:')
  })

  it('strips spoofed headers and ignores forwarded proto without trustedProxy', async () => {
    const r = await probe(undefined, {
      'x-theokit-trusted-identity': 'mallory',
      'x-theokit-peer': 'evil',
      'x-forwarded-proto': 'https',
    })
    expect(r.identity).toBeUndefined()
    expect(r.peer).toBe('127.0.0.1')
    expect(r.protocol).toBe('http:')
  })

  it('throws on invalid options, naming the option', () => {
    expect(() =>
      createNodeServer(() => new Response('x'), {
        trustedProxy: { identityHeader: 'authorization', addresses: ['127.0.0.1'] },
      }),
    ).toThrow(/identityHeader/)
    expect(() =>
      createNodeServer(() => new Response('x'), {
        trustedProxy: { identityHeader: 'x-user', addresses: [] },
      }),
    ).toThrow(/addresses/)
  })

  it('normalizes allowlist addresses (case and ::ffff: prefix)', async () => {
    const r = await probe(
      { identityHeader: 'x-user', addresses: ['::FFFF:127.0.0.1'] },
      { 'x-user': 'alice' },
    )
    expect(r.identity).toBe('alice')
  })

  it('rejects malformed and reserved identity header names', () => {
    for (const identityHeader of [
      'X-User',
      'x_user',
      '',
      'x user',
      'authorization',
      'x-theokit-peer',
      'x-theokit-trusted-identity',
    ]) {
      expect(() =>
        createNodeServer(() => new Response('x'), {
          trustedProxy: { identityHeader, addresses: ['127.0.0.1'] },
        }),
      ).toThrow(/identityHeader/)
    }
  })

  it('suppresses an empty identity and still removes the header', async () => {
    const r = await probe(
      { identityHeader: 'x-user', addresses: ['127.0.0.1'] },
      { 'x-user': '   ' },
    )
    expect(r.identity).toBeUndefined()
    expect(r.leaked).toBeNull()
  })

  it('removes the identity header from the Request on the trusted path', async () => {
    const r = await probe({ identityHeader: 'x-user', addresses: ['127.0.0.1'] }, { 'x-user': 'a' })
    expect(r.identity).toBe('a')
    expect(r.leaked).toBeNull()
  })

  it('accepts x-forwarded-proto as identity header and keeps the allowlist for the URL', async () => {
    const trusted = await probe(
      { identityHeader: 'x-forwarded-proto', addresses: ['127.0.0.1'] },
      { 'x-forwarded-proto': 'https' },
    )
    expect(trusted.identity).toBe('https')
    expect(trusted.protocol).toBe('https:')
    await node?.close({ force: true })
    const other = await probe(
      { identityHeader: 'x-forwarded-proto', addresses: ['10.0.0.1'] },
      { 'x-forwarded-proto': 'https' },
    )
    expect(other.identity).toBeUndefined()
    expect(other.protocol).toBe('http:')
  })

  it('keeps the host in the URL when host is the identity header, but removes it from the Request', async () => {
    const r = await probe(
      { identityHeader: 'host', addresses: ['127.0.0.1'] },
      { host: 'app.example.com' },
    )
    expect(r.host).toBe('app.example.com')
    expect(r.hostHeader).toBeNull()
    expect(r.identity).toBe('app.example.com')
  })
})
