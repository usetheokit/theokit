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

describe('createNodeServer disconnect while handler pending', () => {
  it('cancels a body returned after the client left', async () => {
    let cancelled = false
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let signal: AbortSignal | undefined
    node = createNodeServer(async (request) => {
      signal = request.signal
      await gate
      return new Response(
        new ReadableStream<Uint8Array>({
          cancel: () => {
            cancelled = true
          },
        }),
      )
    })
    const { port } = await node.listen(0, '127.0.0.1')
    const sock = connect(port, '127.0.0.1')
    sock.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n')
    await new Promise((r) => setTimeout(r, 50))
    sock.destroy()
    await new Promise((r) => setTimeout(r, 50))
    expect(signal?.aborted).toBe(true)
    release()
    const start = Date.now()
    while (!cancelled && Date.now() - start < 1000) await new Promise((r) => setTimeout(r, 10))
    expect(cancelled).toBe(true)
  })

  it('keeps the signal live with abortOnDisconnect: false', async () => {
    let signal: AbortSignal | undefined
    node = createNodeServer(
      async (request) => {
        signal = request.signal
        await new Promise((r) => setTimeout(r, 100))
        return new Response('ok')
      },
      { abortOnDisconnect: false },
    )
    const { port } = await node.listen(0, '127.0.0.1')
    const sock = connect(port, '127.0.0.1')
    sock.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n')
    await new Promise((r) => setTimeout(r, 30))
    sock.destroy()
    await new Promise((r) => setTimeout(r, 150))
    expect(signal?.aborted).toBe(false)
  })

  it('reports handler errors with phase request and answers 500', async () => {
    const seen: string[] = []
    node = createNodeServer(
      () => {
        throw new Error('boom')
      },
      { onError: (_e, phase) => seen.push(phase) },
    )
    const { port } = await node.listen(0, '127.0.0.1')
    const res = await fetch(`http://127.0.0.1:${String(port)}/`)
    expect(res.status).toBe(500)
    expect(seen).toEqual(['request'])
  })
})

describe('createNodeServer disconnect with a read pending', () => {
  it('cancels the body without waiting for another chunk', async () => {
    let cancelled = false
    node = createNodeServer(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start: (c) => {
              c.enqueue(new TextEncoder().encode('x'))
            },
            // pull never settles: the next read stays pending forever
            pull: () => new Promise<void>(() => undefined),
            cancel: () => {
              cancelled = true
            },
          }),
        ),
    )
    const { port } = await node.listen(0, '127.0.0.1')
    const sock = connect(port, '127.0.0.1')
    sock.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n')
    await new Promise((r) => sock.once('data', r))
    sock.destroy()
    const start = Date.now()
    while (!cancelled && Date.now() - start < 1000) await new Promise((r) => setTimeout(r, 10))
    expect(cancelled).toBe(true)
  })
})
