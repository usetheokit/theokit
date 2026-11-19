import { afterEach, describe, expect, it } from 'vitest'

import { BindError, createNodeServer, type NodeServer } from '../../src/runtime-node.js'

const servers: NodeServer[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close({ force: true })))
})
const make = (): NodeServer => {
  const s = createNodeServer(() => new Response('ok'))
  servers.push(s)
  return s
}

describe('createNodeServer bind', () => {
  it('resolves with the real port', async () => {
    const s = make()
    const addr = await s.listen(0, '127.0.0.1')
    expect(addr.host).toBe('127.0.0.1')
    expect(addr.port).toBeGreaterThan(0)
    expect(s.address()).toEqual(addr)
  })

  it('rejects with BindError on a busy port', async () => {
    const a = make()
    const { port } = await a.listen(0, '127.0.0.1')
    const b = make()
    const err = await b.listen(port, '127.0.0.1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BindError)
    expect((err as BindError).code).toBe('EADDRINUSE')
    expect((err as BindError).message).toContain(String(port))
  })

  it('rejects with BindError naming the address on EADDRNOTAVAIL', async () => {
    const s = make()
    const err = await s.listen(0, '203.0.113.1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BindError)
    expect((err as BindError).code).toBe('EADDRNOTAVAIL')
    expect((err as BindError).message).toContain('203.0.113.1')
  })

  it('reports a post-bind server error with phase server', async () => {
    const seen: string[] = []
    const s = createNodeServer(() => new Response('ok'), { onError: (_e, p) => seen.push(p) })
    servers.push(s)
    await s.listen(0, '127.0.0.1')
    s.server.emit('error', new Error('late'))
    expect(seen).toEqual(['server'])
  })
})
