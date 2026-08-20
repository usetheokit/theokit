/**
 * #382 — the deploy shim must hand bytes to the platform as they are produced.
 *
 * Every one of these tests RUNS a stream through `createWebShim` and observes
 * when chunks arrive. None of them reads the generated adapter source. That
 * distinction is the whole point: the adapter streaming suites
 * (`streaming-ssr.test.ts`, `cloudflare-streaming-shell.test.ts`, ...) grep the
 * emitted module for a symbol, and a test that reads code cannot observe a
 * chunk boundary — which is why the shim buffered the whole response for as
 * long as it did.
 *
 * The producer is NOT written for this test. It is the framework's own SSE
 * encoder (`durableUiMessageStreamResponse`) driven through the real request
 * pipeline (`executeRoute`), in exactly the shape the six emitted handlers use.
 * A hand-rolled "handler" that already had every byte would agree with a
 * buffering shim (B-022).
 */
import { describe, it, expect } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { WireChunk } from '@theokit/presenter/wire'

import { createWebShim } from '../../packages/theo/src/adapters/web-shim.js'
import { durableUiMessageStreamResponse } from '../../packages/theo/src/server/agent/durable-ui-message-stream-response.js'
import { createInMemoryRunEventCache } from '../../packages/theo/src/server/agent/run-event-cache.js'
import { executeRoute } from '../../packages/theo/src/server/http/execute.js'
import type { ServerRouteNode } from '../../packages/theo/src/server/scan/match.js'

const ROUTE: ServerRouteNode = {
  filePath: '/fake/api/stream/route.ts',
  routePath: '/api/stream',
  pattern: /^\/api\/stream$/,
  paramNames: [],
}

function createGate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return { wait, release }
}

/** Fail with a readable message instead of hanging when the shim buffers. */
async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Run one streaming route through the shim, the way an emitted handler does. */
function runThroughShim(chunks: AsyncIterable<WireChunk>): {
  response: Promise<Response>
  finished: Promise<void>
  settled: () => boolean
} {
  const cache = createInMemoryRunEventCache()
  const shim = createWebShim(new Request('https://example.com/api/stream'))
  const loadModule = async (): Promise<Record<string, unknown>> => ({
    GET: {
      handler: () => durableUiMessageStreamResponse(chunks, { runId: 'run-382', cache }),
    },
  })
  const finished = executeRoute({
    route: ROUTE,
    method: 'GET',
    params: {},
    req: shim.req as unknown as IncomingMessage,
    res: shim.res as unknown as ServerResponse,
    loadModule,
    requestId: 'req-382',
  })
  let done = false
  void finished.then(
    () => {
      done = true
    },
    () => {
      done = true
    },
  )
  return { response: shim.toResponse(finished), finished, settled: () => done }
}

const decoder = new TextDecoder()

describe('#382 — createWebShim delivers bytes before the producer finishes', () => {
  it('hands the caller a chunk while the producer is still blocked', async () => {
    const gate = createGate()
    async function* gated(): AsyncGenerator<WireChunk> {
      yield { type: 'text-delta', id: 't1', delta: 'first' }
      await gate.wait
      yield { type: 'text-delta', id: 't1', delta: 'second' }
    }

    const run = runThroughShim(gated())
    const response = await withTimeout(
      run.response,
      2000,
      'toResponse() did not resolve while the producer was still writing — the shim is buffering the whole response',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.body).not.toBeNull()

    const reader = response.body!.getReader()
    const first = await withTimeout(
      reader.read(),
      2000,
      'no chunk arrived while the producer was blocked',
    )
    expect(first.done).toBe(false)
    expect(decoder.decode(first.value)).toContain('first')

    // The producer is parked on the gate: the run has NOT completed, and yet a
    // byte already reached the caller. That is the property #382 says is absent.
    await new Promise((r) => setTimeout(r, 0))
    expect(run.settled()).toBe(false)

    gate.release()

    let rest = ''
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      rest += decoder.decode(next.value)
    }
    await run.finished
    expect(rest).toContain('second')
    expect(rest).toContain('[DONE]')
  })

  it('delivers the run in many chunks, the first one early in the run', async () => {
    const GAP_MS = 40
    const COUNT = 6
    async function* paced(): AsyncGenerator<WireChunk> {
      for (let i = 0; i < COUNT; i += 1) {
        await new Promise((r) => setTimeout(r, GAP_MS))
        yield { type: 'text-delta', id: 't1', delta: `token-${i}` }
      }
    }

    const startedAt = Date.now()
    const run = runThroughShim(paced())
    const response = await withTimeout(run.response, 5000, 'toResponse() never resolved')
    const headersAt = Date.now() - startedAt

    const reader = response.body!.getReader()
    const arrivals: number[] = []
    let body = ''
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      arrivals.push(Date.now() - startedAt)
      body += decoder.decode(next.value)
    }
    await run.finished
    const completedAt = Date.now() - startedAt

    // Buffering produces exactly one arrival, at the instant the run ends.
    expect(arrivals.length).toBeGreaterThanOrEqual(COUNT)
    // J3 criterion 3: time-to-first-chunk over time-to-completion must be < 0.5.
    expect(arrivals[0] / completedAt).toBeLessThan(0.5)
    // Headers must be knowable before the body is finished.
    expect(headersAt).toBeLessThan(completedAt / 2)
    for (let i = 0; i < COUNT; i += 1) expect(body).toContain(`token-${i}`)
  })
})

describe('#382 — headers freeze when the first byte leaves', () => {
  it('refuses setHeader after the first write, naming the header', async () => {
    const { res, toResponse } = createWebShim(new Request('https://example.com/api'))
    res.setHeader('x-early', 'kept')
    res.write('first byte')
    const response = await toResponse()
    expect(response.headers.get('x-early')).toBe('kept')
    // Silently dropping it would hand the caller a Response whose headers
    // disagree with what the handler asked for, with nothing to notice.
    expect(() => res.setHeader('x-late', 'lost')).toThrow(/x-late/)
    res.end()
  })

  it('refuses writeHead after the headers were sent', async () => {
    const { res, toResponse } = createWebShim(new Request('https://example.com/api'))
    res.writeHead(200, { 'content-type': 'text/plain' })
    await toResponse()
    expect(() => res.writeHead(500)).toThrow(/headers were sent/)
    res.end()
  })

  it('answers a null-body status without a stream', async () => {
    const { res, toResponse } = createWebShim(new Request('https://example.com/api'))
    res.writeHead(204)
    res.end()
    const response = await toResponse()
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
  })
})

describe('#382 — backpressure is reported honestly', () => {
  it('write() turns false at the high-water mark and true again after a read', async () => {
    const { res, toResponse } = createWebShim(new Request('https://example.com/api'))
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    const response = await toResponse()

    const block = new Uint8Array(16 * 1024)
    let acceptedWithRoomLeft = 0
    while (res.write(block)) {
      acceptedWithRoomLeft += 1
      if (acceptedWithRoomLeft > 32) throw new Error('write() never reported backpressure')
    }
    // 64 KiB high-water mark / 16 KiB blocks: three writes leave room, the
    // fourth fills the queue. Always returning true is what lets a producer
    // outrun its consumer and grow the queue without bound.
    expect(acceptedWithRoomLeft).toBe(3)

    let drained = false
    res.once('drain', () => {
      drained = true
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(drained).toBe(false)

    const reader = response.body!.getReader()
    await reader.read()
    await new Promise((r) => setTimeout(r, 0))
    expect(drained).toBe(true)

    // Room reappears in step with what the consumer took, not all at once.
    await reader.read()
    expect(res.write(block)).toBe(true)

    res.end()
    await reader.cancel()
  })
})

describe('#382 — a failure after the first byte is not reported as a clean ending', () => {
  it('rejects toResponse() when the handler fails before the headers are out', async () => {
    const { toResponse } = createWebShim(new Request('https://example.com/api'))
    const pending = Promise.reject(new Error('handler blew up'))
    await expect(toResponse(pending)).rejects.toThrow('handler blew up')
  })

  it('errors the body stream when the handler fails after the first byte', async () => {
    const { res, toResponse } = createWebShim(new Request('https://example.com/api'))
    let failHandler!: (err: unknown) => void
    const pending = new Promise<void>((_, reject) => {
      failHandler = reject
    })

    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const response = await toResponse(pending)
    const reader = response.body!.getReader()

    res.write('partial payload')
    const first = await reader.read()
    expect(decoder.decode(first.value)).toBe('partial payload')

    failHandler(new Error('handler blew up mid-stream'))
    // ADR-0002: the consumer must see a broken stream. A `done: true` here
    // would report a truncated body as a complete one.
    await expect(reader.read()).rejects.toThrow('handler blew up mid-stream')
  })

  it('closes the stream when the handler returns without ending the response', async () => {
    const { res, toResponse } = createWebShim(new Request('https://example.com/api'))
    res.writeHead(200, { 'content-type': 'text/plain' })
    const response = await withTimeout(
      toResponse(Promise.resolve()),
      2000,
      'toResponse() hung on a handler that never called end()',
    )
    expect(await response.text()).toBe('')
    expect(res.writableEnded).toBe(true)
  })
})
