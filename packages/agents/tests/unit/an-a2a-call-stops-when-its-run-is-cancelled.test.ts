/**
 * The A2A tool reads the remote agent's event stream for the whole remote turn. The SDK passes the
 * run's `AbortSignal` to a tool handler as `ctx.signal`; a handler that drops it keeps the HTTP
 * connection, and the remote run behind it, alive after the caller cancelled, and its promise stays
 * pending until the remote finishes. These tests cancel mid-stream and before the request.
 */
import { describe, expect, it, vi } from 'vitest'

import { createA2ATool } from '../../src/a2a/a2a-client.js'

/**
 * A remote that answers headers at once and then holds the event stream open, the way a remote turn
 * in progress does. Like a real `fetch`, it errors the body with the signal's reason on abort.
 */
function holdingFetch() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const signal = init.signal ?? undefined
    signal?.throwIfAborted()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"start"}\n\n'))
        signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true })
      },
    })
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  })
}

/** Settle within `ms`, or report that the promise is still pending. */
async function settledWithin(promise: Promise<unknown>, ms: number): Promise<unknown> {
  const pending = Symbol('pending')
  const timer = new Promise((resolve) => setTimeout(() => resolve(pending), ms))
  const outcome = await Promise.race([
    promise.then(
      () => 'resolved',
      (err: unknown) => err,
    ),
    timer,
  ])
  return outcome === pending ? 'still pending' : outcome
}

describe('createA2ATool against a cancelled run', () => {
  it('test_cancelling_the_run_mid_stream_rejects_the_call_with_the_abort_reason', async () => {
    const fetchImpl = holdingFetch()
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      fetchImpl,
    })
    const controller = new AbortController()

    const call = Promise.resolve(tool.handler({ message: 'hi' }, { signal: controller.signal }))
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()

    const outcome = await settledWithin(call, 500)
    expect(outcome).toBe(controller.signal.reason)
    expect((outcome as Error).name).toBe('AbortError')
    expect(fetchImpl.mock.calls[0]?.[1].signal).toBe(controller.signal)
  })

  it('test_a_run_cancelled_before_the_call_never_reaches_the_remote_body', async () => {
    const fetchImpl = holdingFetch()
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      fetchImpl,
    })
    const controller = new AbortController()
    controller.abort()

    const call = Promise.resolve(tool.handler({ message: 'hi' }, { signal: controller.signal }))
    const outcome = await settledWithin(call, 500)

    expect(outcome).toBe(controller.signal.reason)
  })
})
