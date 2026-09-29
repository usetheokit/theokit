/**
 * SSE streaming handler — Web Standard Response with ReadableStream.
 *
 * Per ADR D4: SSE is the v1 transport.
 * Per EC-2: uses ReadableStream with controller.enqueue() instead of res.write().
 * Works natively on Node, Bun, Deno, CF Workers.
 *
 * ## One wire, not two (usetheokit/theokit#386)
 *
 * This encoder used to write `event: <type>` + `data: <framework StreamEvent>` — snake_case agent
 * events — while the durable encoder wrote `data: <UIMessageChunk>`, the kebab-case wire every
 * client this framework ships actually reads. `parseWireStream` runs `wireChunkSchema.safeParse`
 * on each `data:` payload and drops what fails through a `warn` whose default sink is a no-op, so
 * a `TheoApp` app mounted through `agentRuntime` served a route none of its own clients could read:
 * zero chunks, no assistant message, and a run reporting success with an empty answer. Silent at
 * every layer.
 *
 * The events are routed through `presentUIMessageStream` now — the same translator `mountAgent`
 * uses — so there is one wire and one place that produces it.
 *
 * ## And it terminates
 *
 * It emitted no terminal frame at all, so a client could not tell a completed run from a dropped
 * connection. That is the defect #384 closed for the durable encoder, and #384's fix keys on the
 * `finish` chunk this encoder never sent. `presentUIMessageStream` emits it, and `[DONE]` closes
 * the stream the way the durable path does.
 */
import { debugLog } from '../debug-log.js'

import type { AgentStreamEvent } from './agent-stream-events.js'
import { presentUIMessageStream } from './present-ui-message-stream.js'

/** Minimal event shape matching SDK's SDKMessage discriminated union. */
export interface StreamEvent {
  type: string
  [key: string]: unknown
}

const encoder = new TextEncoder()

/** What the durable encoder writes to close a stream; a client keys its terminal state on it. */
const DONE_FRAME = 'data: [DONE]\n\n'

/**
 * Create a Web Standard Response that streams the agent's turn as UIMessage wire chunks.
 *
 * The `event:` line carries the chunk's own type. It is informational — `parseWireStream` reads
 * only `data:` lines, per WHATWG SSE — and kept because an `EventSource` consumer can dispatch on
 * it.
 *
 * @param eventStream - the framework's own run events
 * @param opts.onError - what a consumer is told a failure was; masked by default (#390)
 */
export function streamAgentResponse(
  eventStream: AsyncIterable<StreamEvent>,
  opts: { onError?: Parameters<typeof presentUIMessageStream>[1]['onError'] } = {},
): Response {
  const chunks = presentUIMessageStream(eventStream as AsyncIterable<AgentStreamEvent>, {
    textId: crypto.randomUUID(),
    ...(opts.onError !== undefined ? { onError: opts.onError } : {}),
  })
  const iterator = chunks[Symbol.asyncIterator]()
  let finished = false

  /** Terminate once: the frame a client keys its terminal state on, then the close. */
  const finish = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    if (finished) return
    finished = true
    try {
      controller.enqueue(encoder.encode(DONE_FRAME))
      controller.close()
    } catch {
      // The consumer is gone. There is nobody left to tell, and both calls above would be writing
      // to a controller that is already closed.
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    // `pull`, not `async start`. An eager `start` leaves a floating promise: Node drains the
    // microtask queue after the handler returns, and workerd tears down pending work — so the
    // continuation after an `await` is not guaranteed to run, and the terminal frame and the close
    // are precisely what sits there. Measured on two targets with one app and one request, 2026-09-28
    // (B-327): node answered in 1.54s with 14 frames and one `[DONE]`, workerd delivered 13 frames
    // including `finish` and then never ended the request. `pull` is demand-driven, behaves
    // identically across Node, workerd, Deno and Bun, and brings backpressure — one frame per pull
    // rather than a whole turn buffered in the controller — and cancellation with it.
    //
    // The same rewrite landed in `server/agent/durable-ui-message-stream-response.ts` for the same
    // reason and did not reach this file, which is how the pattern survived one module from its fix.
    async pull(controller) {
      if (finished) return
      try {
        const next = await iterator.next()
        if (next.done === true) {
          finish(controller)
          return
        }
        const data = JSON.stringify(next.value)
        controller.enqueue(encoder.encode(`event: ${next.value.type}\ndata: ${data}\n\n`))
      } catch {
        // `presentUIMessageStream` already turns a thrown source into an `error` chunk, so reaching
        // here means the failure was in the ENQUEUE — the consumer is gone. Terminating is still
        // right: `finish` is idempotent and swallows a write to a closed controller.
        finish(controller)
      }
    },

    // A client that navigates away cancels the body. Without this the turn keeps running with
    // nobody reading it, which is the resource leak `start` could not express at all.
    async cancel(reason: unknown) {
      finished = true

      // `reason` is neither forwarded nor discarded, and both halves of that are deliberate.
      //
      // Not forwarded: `presentUIMessageStream` is an `AsyncGenerator<UIMessageChunk, void, unknown>`,
      // so `return()` accepts `void` and nothing else. Passing the reason in would need a cast — a
      // lie about the type — and the generator would discard it anyway, because `TReturn` is where a
      // completion VALUE goes, not where a cancellation cause goes. The sibling in `server/agent`
      // appears to forward one only because it holds an `AsyncIterable`, whose `return` is typed
      // loosely enough to accept it; the value reaches nobody there either.
      //
      // Not discarded: a turn released before it finished is a fact an operator wants, and dropping
      // it silently is the swallow B-322 removed from the error path. It goes to the gated channel
      // rather than to `console` because a client navigating away is NORMAL — unconditional output
      // here would corrupt every stdout consumer for an event that is not a problem.
      debugLog('[theokit] agent stream cancelled before it finished', { reason })

      await iterator.return(undefined)
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      // #383 — proxies buffer a stream that says nothing about buffering. `connection` is
      // deliberately absent: it is hop-by-hop and Node's HTTP/2 rejects it.
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  })
}
