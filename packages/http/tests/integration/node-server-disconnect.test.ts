import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import { createNodeServer, type NodeServer } from '../../src/runtime-node.js'

let node: NodeServer | undefined
afterEach(async () => {
  await node?.close({ force: true })
  node = undefined
})

describe('createNodeServer disconnect', () => {
  it('aborts the signal and cancels the body when the client leaves', async () => {
    let signal: AbortSignal | undefined
    let cancelled = false
    node = createNodeServer((request) => {
      signal = request.signal
      const body = new ReadableStream<Uint8Array>({
        pull: async (c) => {
          c.enqueue(new TextEncoder().encode('x'))
          await new Promise((r) => setTimeout(r, 20))
        },
        cancel: () => {
          cancelled = true
        },
      })
      return new Response(body)
    })
    const { port } = await node.listen(0, '127.0.0.1')
    const sock = connect(port, '127.0.0.1')
    sock.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n')
    await new Promise((r) => sock.once('data', r))
    sock.destroy()
    const start = Date.now()
    while ((!signal?.aborted || !cancelled) && Date.now() - start < 1000) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(signal?.aborted).toBe(true)
    expect(cancelled).toBe(true)
  })

  it('does not abort when the response finishes', async () => {
    let signal: AbortSignal | undefined
    node = createNodeServer((request) => {
      signal = request.signal
      return new Response('ok')
    })
    const { port } = await node.listen(0, '127.0.0.1')
    const res = await fetch(`http://127.0.0.1:${String(port)}/`)
    expect(await res.text()).toBe('ok')
    await new Promise((r) => setTimeout(r, 50))
    expect(signal?.aborted).toBe(false)
  })
})
