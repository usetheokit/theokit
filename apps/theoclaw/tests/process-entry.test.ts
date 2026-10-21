import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { computeLineSignature } from '@theokit/gateway-line'
import type { ServerHandle } from '@theokit/http/runtime/node'

import { TheoClawConfigError } from '../src/channels/output-mask.js'
import { startChannelLoop } from '../src/channels/channel-loop.js'
import { installShutdown, parsePort, startServer } from '../src/server.js'
import { createLineRoute } from '../src/webhooks/line.js'
import { MAX_BODY_BYTES, createWebhookRouter } from '../src/webhooks/router.js'
import type { WebhookRoute } from '../src/webhooks/router.js'
import { FakeAdapter, deferred, waitFor } from './fakes.js'

const SECRET = 'line-channel-secret'
const LINE_BODY = JSON.stringify({
  events: [
    {
      type: 'message',
      timestamp: 1,
      source: { type: 'user', userId: 'U-1' },
      message: { id: 'm-1', type: 'text', text: 'hello' },
    },
  ],
})

const servers: ServerHandle[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))))
})

/** A route that records how often it was reached and what bytes it read. */
function spyRoute(methods: readonly string[] = ['POST']): WebhookRoute & { calls: Uint8Array[] } {
  const calls: Uint8Array[] = []
  return {
    methods,
    calls,
    handle: async (request) => {
      calls.push(new Uint8Array(await request.arrayBuffer()))
      return new Response(null, { status: 200 })
    },
  }
}

function chunkedBody(totalBytes: number): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close()
        return
      }
      const size = Math.min(65_536, totalBytes - sent)
      controller.enqueue(new Uint8Array(size).fill(0x61))
      sent += size
    },
  })
}

function post(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, { method: 'POST', ...init, duplex: 'half' } as RequestInit)
}

async function serve(handler: (request: Request) => Promise<Response>): Promise<string> {
  const server = await startServer({ handler, port: 0 })
  servers.push(server)
  return `http://127.0.0.1:${server.address()?.port}`
}

function shutdownHarness(
  stopAll: () => Promise<void> = async () => undefined,
  close: () => Promise<void> = async () => undefined,
) {
  const signals = new EventEmitter()
  const exit = vi.fn()
  const closeServer = vi.fn(close)
  const stop = vi.fn(stopAll)
  const lines: string[] = []
  installShutdown({ signals, stopAll: stop, closeServer, exit, write: (line) => lines.push(line) })
  return { signals, exit, closeServer, stopAll: stop, lines }
}

describe('the process entry', () => {
  it('answers a webhook within 1000 ms while the handler never settles', async () => {
    const line = new FakeAdapter('line')
    const loop = startChannelLoop({
      platforms: [{ platform: 'line', build: () => line }],
      handler: () => new Promise<void>(() => {}),
      secrets: [],
      write: () => undefined,
    })
    await loop.ready
    const router = createWebhookRouter({
      routes: new Map([['line', { methods: ['POST'], handle: createLineRoute({ channelSecret: SECRET, adapter: line }) }]]),
      isStarted: (platform) => loop.started.has(platform),
      write: () => undefined,
    })
    const base = await serve(router)

    const response = await fetch(`${base}/webhooks/line`, {
      method: 'POST',
      headers: { 'x-line-signature': computeLineSignature(SECRET, LINE_BODY) },
      body: LINE_BODY,
      signal: AbortSignal.timeout(1000),
    })

    expect(response.status).toBe(200)
  })

  it('stops every started runner on SIGTERM', async () => {
    const harness = shutdownHarness()

    harness.signals.emit('SIGTERM')

    await waitFor(() => harness.exit.mock.calls.length === 1, 1000, 'exit after SIGTERM')
    expect(harness.stopAll).toHaveBeenCalledTimes(1)
    expect(harness.closeServer).toHaveBeenCalledTimes(1)
    expect(harness.exit).toHaveBeenCalledWith(0)
  })

  it('unconfigured platform answers 404 and unstarted answers 503', async () => {
    const router = createWebhookRouter({
      routes: new Map([['line', spyRoute()]]),
      isStarted: () => false,
      write: () => undefined,
    })

    expect((await router(post('/webhooks/sms', { body: 'x' }))).status).toBe(404)
    expect((await router(post('/webhooks/nowhere', { body: 'x' }))).status).toBe(404)
    expect((await router(post('/elsewhere', { body: 'x' }))).status).toBe(404)
    expect((await router(post('/webhooks/line', { body: 'x' }))).status).toBe(503)
  })

  it('answers 405 for a method the route does not take', async () => {
    const router = createWebhookRouter({ routes: new Map([['line', spyRoute()]]), isStarted: () => true, write: () => undefined })

    const response = await router(new Request('http://localhost/webhooks/line', { method: 'GET' }))

    expect(response.status).toBe(405)
  })

  it('a second signal during shutdown is ignored', async () => {
    const gate = deferred<void>()
    const harness = shutdownHarness(() => gate.promise)

    harness.signals.emit('SIGTERM')
    harness.signals.emit('SIGTERM')
    gate.resolve()

    await waitFor(() => harness.exit.mock.calls.length === 1, 1000, 'exit after SIGTERM')
    expect(harness.stopAll).toHaveBeenCalledTimes(1)
    expect(harness.lines).toEqual(['shutdown: SIGTERM ignored, already stopping'])
  })

  it('a runner that fails to stop still closes the server and exits 1', async () => {
    const harness = shutdownHarness(async () => {
      throw new Error('drain failed')
    })

    harness.signals.emit('SIGINT')

    await waitFor(() => harness.exit.mock.calls.length === 1, 1000, 'exit after SIGINT')
    expect(harness.closeServer).toHaveBeenCalledTimes(1)
    expect(harness.exit).toHaveBeenCalledWith(1)
  })

  it('rejects a port that is not an integer', () => {
    expect(() => parsePort('abc')).toThrow(TheoClawConfigError)
    expect(() => parsePort('abc')).toThrow(/THEOCLAW_PORT/)
    expect(() => parsePort(undefined)).toThrow(/THEOCLAW_PORT/)
  })

  it('rejects a port out of range or fractional', () => {
    for (const value of ['8080.5', '-1', '65536', ' 80', '']) {
      expect(() => parsePort(value)).toThrow(/THEOCLAW_PORT/)
    }
    expect(parsePort('0')).toBe(0)
    expect(parsePort('65535')).toBe(65535)
  })

  it('refuses an oversized body with 413', async () => {
    const line = spyRoute()
    const router = createWebhookRouter({ routes: new Map([['line', line]]), isStarted: () => true, write: () => undefined })

    const response = await router(post('/webhooks/line', { headers: { 'content-length': '2000000' }, body: 'x' }))

    expect(response.status).toBe(413)
    expect(line.calls).toHaveLength(0)
  })

  it('caps a chunked body before any route reads it', async () => {
    const routes = new Map([
      ['line', spyRoute()],
      ['sms', spyRoute()],
      ['whatsapp', spyRoute(['GET', 'POST'])],
      ['teams', spyRoute()],
    ] as const)
    const router = createWebhookRouter({ routes, isStarted: () => true, write: () => undefined })

    for (const platform of routes.keys()) {
      const response = await router(post(`/webhooks/${platform}`, { body: chunkedBody(MAX_BODY_BYTES + 1) }))
      expect(response.status).toBe(413)
    }
    expect([...routes.values()].map((route) => route.calls.length)).toEqual([0, 0, 0, 0])
  })

  it('hands the route the exact bytes it read', async () => {
    const line = spyRoute()
    const router = createWebhookRouter({ routes: new Map([['line', line]]), isStarted: () => true, write: () => undefined })

    await router(post('/webhooks/line', { body: new Uint8Array([0xff, 0xfe, 0x00]) }))

    expect([...(line.calls[0] ?? [])]).toEqual([0xff, 0xfe, 0x00])
  })

  it('a body that cannot be read answers 400 and is written', async () => {
    const line = spyRoute()
    const lines: string[] = []
    const router = createWebhookRouter({
      routes: new Map([['line', line]]),
      isStarted: () => true,
      write: (entry) => lines.push(entry),
    })
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('client went away'))
      },
    })

    const response = await router(post('/webhooks/line', { body: broken }))

    expect(response.status).toBe(400)
    expect(line.calls).toHaveLength(0)
    expect(lines).toEqual(['line: request body could not be read: client went away'])
  })

  it('caps the body of a method other than post', async () => {
    const put = spyRoute(['PUT'])
    const router = createWebhookRouter({ routes: new Map([['line', put]]), isStarted: () => true, write: () => undefined })

    const response = await router(
      new Request('http://localhost/webhooks/line', {
        method: 'PUT',
        body: chunkedBody(MAX_BODY_BYTES + 1),
        duplex: 'half',
      } as RequestInit),
    )

    expect(response.status).toBe(413)
    expect(put.calls).toHaveLength(0)
  })

  it('a trailing slash reaches the same route', async () => {
    const line = spyRoute()
    const router = createWebhookRouter({ routes: new Map([['line', line]]), isStarted: () => true, write: () => undefined })

    const response = await router(post('/webhooks/line/', { body: '{}' }))

    expect(response.status).toBe(200)
    expect(line.calls).toHaveLength(1)
  })

  it('a route that throws answers 500 and is written', async () => {
    const lines: string[] = []
    const failing: WebhookRoute = {
      methods: ['POST'],
      handle: async () => {
        throw new Error('unknown backend: carrier-pigeon')
      },
    }
    const router = createWebhookRouter({
      routes: new Map([['sms', failing]]),
      isStarted: () => true,
      write: (line) => lines.push(line),
    })

    const response = await router(post('/webhooks/sms', { body: 'x' }))

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('')
    expect(lines).toEqual(['sms: webhook failed: unknown backend: carrier-pigeon'])
  })

  it('a server that fails to close still exits 1', async () => {
    const harness = shutdownHarness(undefined, async () => {
      throw new Error('server not running')
    })

    harness.signals.emit('SIGTERM')

    await waitFor(() => harness.exit.mock.calls.length === 1, 1000, 'exit after SIGTERM')
    expect(harness.exit).toHaveBeenCalledWith(1)
    expect(harness.lines).toEqual(['shutdown: closing the server failed: server not running'])
  })

  it('removing the shutdown listeners leaves the signal source as it was', () => {
    const signals = new EventEmitter()
    const remove = installShutdown({
      signals,
      stopAll: async () => undefined,
      closeServer: async () => undefined,
      exit: () => undefined,
      write: () => undefined,
    })

    remove()

    expect(signals.listenerCount('SIGINT') + signals.listenerCount('SIGTERM')).toBe(0)
  })

  it('a body of exactly the cap reaches the route without its old framing headers', async () => {
    const seen: { bytes: number; length: string | null }[] = []
    const line: WebhookRoute = {
      methods: ['POST'],
      handle: async (request) => {
        seen.push({
          bytes: (await request.arrayBuffer()).byteLength,
          length: request.headers.get('content-length'),
        })
        return new Response(null, { status: 200 })
      },
    }
    const router = createWebhookRouter({ routes: new Map([['line', line]]), isStarted: () => true, write: () => undefined })

    const response = await router(post('/webhooks/line', { body: chunkedBody(MAX_BODY_BYTES) }))

    expect(response.status).toBe(200)
    expect(seen).toEqual([{ bytes: MAX_BODY_BYTES, length: null }])
  })

  it('a 413 does not break the next request on the same connection', async () => {
    const line = spyRoute()
    const base = await serve(createWebhookRouter({ routes: new Map([['line', line]]), isStarted: () => true, write: () => undefined }))

    const declared = await fetch(`${base}/webhooks/line`, {
      method: 'POST',
      body: new Uint8Array(2_000_000),
    })
    const chunked = await fetch(`${base}/webhooks/line`, {
      method: 'POST',
      body: chunkedBody(MAX_BODY_BYTES + 1),
      duplex: 'half',
    } as RequestInit)
    const next = await fetch(`${base}/webhooks/line`, { method: 'POST', body: '{}' })

    expect([declared.status, chunked.status]).toEqual([413, 413])
    expect(next.status).toBe(200)
    expect(line.calls).toHaveLength(1)
  })

  it('a listen on a port in use fails instead of hanging', async () => {
    const first = await startServer({ handler: async () => new Response(null), port: 0 })
    servers.push(first)

    await expect(
      startServer({ handler: async () => new Response(null), port: first.address()?.port ?? 0 }),
    ).rejects.toThrow(/EADDRINUSE/)
  })

  describe('concurrency', () => {
    it('shutdown waits for an in-flight turn before it exits', async () => {
      const gate = deferred<void>()
      const telegram = new FakeAdapter('telegram')
      let handled = 0
      const loop = startChannelLoop({
        platforms: [{ platform: 'telegram', build: () => telegram }],
        handler: async () => {
          handled += 1
          await gate.promise
        },
        secrets: [],
        write: () => undefined,
      })
      await loop.ready
      await telegram.deliver({
        id: 'm-1',
        platform: 'telegram',
        sender: { id: 'u' },
        channel: { id: 'c', type: 'dm' },
        text: 'hi',
        receivedAt: 0,
        telegram: { chatId: 1, messageId: 1, raw: null },
      })
      await waitFor(() => handled === 1, 1000, 'the turn to start')
      const harness = shutdownHarness(() => loop.stopAll())

      harness.signals.emit('SIGTERM')
      await waitFor(() => harness.stopAll.mock.calls.length === 1, 1000, 'stopAll to start')
      await new Promise((resolve) => setImmediate(resolve))
      expect(harness.exit).not.toHaveBeenCalled()

      gate.resolve()
      await waitFor(() => harness.exit.mock.calls.length === 1, 2000, 'exit after the drain')
      expect(harness.exit).toHaveBeenCalledWith(0)
    })

    it('three signed posts with never-settling handlers each answer 200 within 1000 ms', async () => {
      const line = new FakeAdapter('line')
      const loop = startChannelLoop({
        platforms: [{ platform: 'line', build: () => line }],
        handler: () => new Promise<void>(() => {}),
        secrets: [],
        write: () => undefined,
      })
      await loop.ready
      const router = createWebhookRouter({
        routes: new Map([['line', { methods: ['POST'], handle: createLineRoute({ channelSecret: SECRET, adapter: line }) }]]),
        isStarted: (platform) => loop.started.has(platform),
      write: () => undefined,
      })
      const base = await serve(router)

      const statuses = await Promise.all(
        [1, 2, 3].map(async () => {
          const response = await fetch(`${base}/webhooks/line`, {
            method: 'POST',
            headers: { 'x-line-signature': computeLineSignature(SECRET, LINE_BODY) },
            body: LINE_BODY,
            signal: AbortSignal.timeout(1000),
          })
          return response.status
        }),
      )

      expect(statuses).toEqual([200, 200, 200])
    })
  })
})
