import { connect } from 'node:net'
import { describe, expect, it } from 'vitest'

import { createNodeServer } from '../../src/runtime-node.js'

describe('createNodeServer close', () => {
  it('force-closes with an idle keep-alive connection open', async () => {
    const node = createNodeServer(() => new Response('ok'))
    const { port } = await node.listen(0, '127.0.0.1')
    const sock = connect(port, '127.0.0.1')
    sock.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n')
    await new Promise((r) => sock.once('data', r))
    const start = Date.now()
    await node.close({ force: true })
    expect(Date.now() - start).toBeLessThan(1000)
    sock.destroy()
  })

  it('memoizes concurrent close calls', async () => {
    const node = createNodeServer(() => new Response('ok'))
    await node.listen(0, '127.0.0.1')
    const a = node.close()
    const b = node.close()
    expect(a).toBe(b)
    await Promise.all([a, b])
  })

  it('force-closes an active streaming connection', async () => {
    const node = createNodeServer(
      () => new Response(new ReadableStream({ pull: () => new Promise(() => undefined) })),
    )
    const { port } = await node.listen(0, '127.0.0.1')
    const sock = connect(port, '127.0.0.1')
    sock.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n')
    await new Promise((r) => sock.once('data', r))
    const closed = new Promise((r) => sock.once('close', r))
    const start = Date.now()
    await node.close({ force: true })
    await closed
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('force-closes an open upgraded socket', async () => {
    const node = createNodeServer(() => new Response('ok'), {
      onUpgrade: (_req, socket) => {
        socket.write('HTTP/1.1 101 Switching Protocols\r\n\r\n')
      },
    })
    const { port } = await node.listen(0, '127.0.0.1')
    const sock = connect(port, '127.0.0.1')
    sock.write('GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n')
    await new Promise((r) => sock.once('data', r))
    const closed = new Promise((r) => sock.once('close', r))
    const start = Date.now()
    await node.close({ force: true })
    await closed
    expect(Date.now() - start).toBeLessThan(1000)
  })
})
