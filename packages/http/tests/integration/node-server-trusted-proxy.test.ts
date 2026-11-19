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
  headers: Record<string, string>,
): Promise<{
  identity?: string
  peer?: string
  protocol: string
  seen: string | null
  leaked: string | null
}> {
  node = createNodeServer(
    (req) =>
      Response.json({
        identity: trustedIdentity(req),
        peer: peerAddress(req),
        protocol: new URL(req.url).protocol,
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
})
