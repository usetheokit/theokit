/**
 * A remote agent that parks a gated tool on an approval cannot be answered over A2A.
 *
 * A served route emits `tool-approval-request` and keeps the stream open until somebody calls its
 * approve endpoint. The A2A tool has no way to make that call, so reading on waits for the remote
 * gate's timeout, or forever when it has none (review finding F-dom-2). The tool rejects as soon as
 * the gate appears, naming the tool and the gated tool, and releases the stream.
 */
import { describe, expect, it, vi } from 'vitest'

import { createA2ATool } from '../../src/a2a/a2a-client.js'

const FRAMES = [
  '{"type":"start"}',
  '{"type":"tool-input-available","toolCallId":"c1","toolName":"deploy","input":{}}',
  '{"type":"tool-approval-request","approvalId":"ap1","toolCallId":"c1"}',
]

/** A remote that sends the gate and then holds the stream open, as a parked run does. */
function gatedFetch(onCancel: () => void) {
  return vi.fn(async (_url: string, _init: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of FRAMES) controller.enqueue(new TextEncoder().encode(`data: ${f}\n\n`))
      },
      cancel: onCancel,
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

describe('an A2A remote that asks for approval', () => {
  it('test_a_remote_approval_gate_rejects_naming_the_gated_tool', async () => {
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      fetchImpl: gatedFetch(() => undefined),
    })

    const outcome = await settledWithin(Promise.resolve(tool.handler({ message: 'hi' })), 500)

    expect(outcome).toBeInstanceOf(Error)
    expect((outcome as Error).message).toBe(
      'A2A call to "ask" failed: the remote agent asked for approval of "deploy", which an A2A call cannot answer',
    )
  })

  it('test_a_remote_approval_gate_releases_the_stream', async () => {
    const cancelled = vi.fn()
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      fetchImpl: gatedFetch(cancelled),
    })

    await settledWithin(Promise.resolve(tool.handler({ message: 'hi' })), 500)

    expect(cancelled).toHaveBeenCalledOnce()
  })
})
