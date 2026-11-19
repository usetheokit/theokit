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
    const err = await s.listen(0, '192.0.2.1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BindError)
    expect((err as BindError).code).toBe('EADDRNOTAVAIL')
    expect((err as BindError).host).toBe('192.0.2.1')
    expect((err as BindError).message).toContain('192.0.2.1')
  })

  it('reports a server error after the bind through onError', async () => {
    const seen: { phase: string; error: unknown }[] = []
    const s = createNodeServer(() => new Response('ok'), {
      onError: (error, phase) => seen.push({ phase, error }),
    })
    servers.push(s)
    await s.listen(0, '127.0.0.1')
    const boom = new Error('late')
    s.server.emit('error', boom)
    expect(seen).toEqual([{ phase: 'server', error: boom }])
  })
})
