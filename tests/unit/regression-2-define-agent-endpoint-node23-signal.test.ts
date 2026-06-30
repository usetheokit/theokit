import { EventEmitter } from 'node:events'

import { describe, it, expect } from 'vitest'

import type { AgentEvent } from '../../packages/theo/src/server/agent/agent-types.js'
import { defineAgentEndpoint } from '../../packages/theo/src/server/define/define-agent-endpoint.js'

/**
 * Regression for the empty-SSE-stream bug exposed on Node ≥23.
 *
 * Node 23 added `http.IncomingMessage.prototype.signal` — a Web `AbortSignal`
 * that fires `abort` the instant the request body is fully received
 * (`req.complete === true`), NOT when the client disconnects. The wrapper's
 * `resolveAbortSignal` duck-typed a Web `Request` as "has `.signal` with
 * `aborted` + `addEventListener`"; on Node 24 the Node `IncomingMessage` ALSO
 * satisfies that shape, so the wrapper returned the request-lifecycle signal —
 * already aborted by the time the handler primes — and EVERY agent stream
 * produced 0 bytes.
 *
 * The fix discriminates a Node `IncomingMessage` (an `EventEmitter`, `typeof
 * r.on === 'function'`) from a Web `Request` and wires client-disconnect to
 * the underlying SOCKET close (the only event that means "client gone" rather
 * than "request body finished"). Complements regression-1, which covered the
 * pre-Node-23 IncomingMessage shape (no `.signal`).
 *
 * If anyone reverts the discriminator, the first test fails loudly.
 */

async function collectChunks(response: Response): Promise<string[]> {
  const reader = response.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) buf += dec.decode(value, { stream: true })
  }
  return buf.split('\n\n').filter((c) => c.startsWith('data:'))
}

/**
 * Build a Node ≥23 `IncomingMessage`-shaped request: an `EventEmitter` that
 * also carries the request-lifecycle `.signal`. With `signalAborted: true` it
 * mirrors the real Node-24 state at handler entry — body consumed,
 * `complete === true`, `req.signal.aborted === true`.
 */
function makeNode23Request(opts: { signalAborted: boolean }): EventEmitter & {
  socket: EventEmitter
  complete: boolean
  aborted: boolean
  signal: AbortSignal
} {
  const req = new EventEmitter() as EventEmitter & {
    socket: EventEmitter
    complete: boolean
    aborted: boolean
    signal: AbortSignal
  }
  req.socket = new EventEmitter()
  req.complete = true
  req.aborted = false
  const ac = new AbortController()
  if (opts.signalAborted) ac.abort()
  req.signal = ac.signal
  return req
}

describe('regression-2 — defineAgentEndpoint vs Node ≥23 IncomingMessage.signal', () => {
  it('streams events even when the Node request-lifecycle .signal is already aborted', async () => {
    const endpoint = defineAgentEndpoint({
      async *handler(): AsyncGenerator<AgentEvent> {
        yield { type: 'message', content: 'one' }
        yield { type: 'message', content: 'two' }
      },
    })

    const req = makeNode23Request({ signalAborted: true })
    const response = (await endpoint.handler({
      query: undefined,
      body: undefined,
      params: undefined,
      request: req as unknown as Request,
      ctx: undefined,
    })) as Response

    const chunks = await collectChunks(response)
    expect(chunks).toHaveLength(2)
  })

  it('a genuine Web Request signal is still honored (real disconnect closes the stream)', async () => {
    const endpoint = defineAgentEndpoint({
      async *handler(): AsyncGenerator<AgentEvent> {
        yield { type: 'message', content: 'never seen' }
      },
    })

    // Genuine Web Request: exposes `.signal`, is NOT a Node EventEmitter.
    const ac = new AbortController()
    ac.abort()
    const webRequest = { signal: ac.signal }

    const response = (await endpoint.handler({
      query: undefined,
      body: undefined,
      params: undefined,
      request: webRequest as unknown as Request,
      ctx: undefined,
    })) as Response

    const chunks = await collectChunks(response)
    expect(chunks).toHaveLength(0)
  })

  it('the signal threaded to the handler aborts when the underlying socket closes (real disconnect)', async () => {
    // The real handler threads `args.signal` into `runner.stream({ signal })`,
    // so the SDK cancels the in-flight provider call on disconnect. The wrapper
    // contract is therefore: the handler's signal aborts on SOCKET close
    // (client gone), not at request-body-end.
    let received: AbortSignal | undefined
    const endpoint = defineAgentEndpoint({
      async *handler(args): AsyncGenerator<AgentEvent> {
        received = args.signal
        yield { type: 'message', content: 'first' }
      },
    })

    const req = makeNode23Request({ signalAborted: false })
    const response = (await endpoint.handler({
      query: undefined,
      body: undefined,
      params: undefined,
      request: req as unknown as Request,
      ctx: undefined,
    })) as Response

    expect(received).toBeDefined()
    expect(received!.aborted).toBe(false)

    // Real client disconnect: the underlying socket closes.
    req.socket.emit('close')
    expect(received!.aborted).toBe(true)

    await response.body?.cancel()
  })

  it('the Node request-completion close event does NOT abort the stream (body-end is not a disconnect)', async () => {
    const endpoint = defineAgentEndpoint({
      async *handler(): AsyncGenerator<AgentEvent> {
        yield { type: 'message', content: 'a' }
        yield { type: 'message', content: 'b' }
        yield { type: 'message', content: 'c' }
      },
    })

    const req = makeNode23Request({ signalAborted: false })
    const response = (await endpoint.handler({
      query: undefined,
      body: undefined,
      params: undefined,
      request: req as unknown as Request,
      ctx: undefined,
    })) as Response

    // Node ≥23 emits `req`'s own 'close' at body-end with `complete === true`.
    // That is request-completion noise, NOT a disconnect — it must be ignored.
    req.emit('close')

    const chunks = await collectChunks(response)
    expect(chunks).toHaveLength(3)
  })
})
