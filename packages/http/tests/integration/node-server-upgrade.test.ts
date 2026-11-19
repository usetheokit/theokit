import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import { createNodeServer, type NodeServer } from '../../src/runtime-node.js'

let node: NodeServer | undefined
afterEach(async () => {
  await node?.close({ force: true })
  node = undefined
})
const UPGRADE = 'GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n'

describe('createNodeServer upgrade', () => {
  it('hands the socket to onUpgrade', async () => {
    let got = false
    node = createNodeServer(() => new Response('ok'), {
      onUpgrade: (req, socket) => {
        got = req.headers.upgrade === 'test'
        socket.write('HTTP/1.1 101 Switching Protocols\r\n\r\n')
      },
    })
    const { port } = await node.listen(0, '127.0.0.1')
    const sock = connect(port, '127.0.0.1')
    sock.write(UPGRADE)
    const data = await new Promise<string>((r) => sock.once('data', (d) => r(String(d))))
    expect(data).toContain('101')
    expect(got).toBe(true)
    sock.destroy()
  })

  it('answers 404 and closes without onUpgrade', async () => {
    node = createNodeServer(() => new Response('ok'))
    const { port } = await node.listen(0, '127.0.0.1')
    const sock = connect(port, '127.0.0.1')
    sock.write(UPGRADE)
    let data = ''
    sock.on('data', (d) => (data += String(d)))
    await new Promise((r) => sock.once('close', r))
    expect(data).toContain('HTTP/1.1 404')
  })
})
