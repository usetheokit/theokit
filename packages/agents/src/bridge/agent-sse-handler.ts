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
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return
        try {
          controller.enqueue(chunk)
        } catch {
          closed = true
        }
      }

      const chunks = presentUIMessageStream(eventStream as AsyncIterable<AgentStreamEvent>, {
        textId: crypto.randomUUID(),
        ...(opts.onError !== undefined ? { onError: opts.onError } : {}),
      })

      try {
        for await (const chunk of chunks) {
          if (closed) break // eslint-disable-line @typescript-eslint/no-unnecessary-condition -- mutated by safeEnqueue catch
          const data = JSON.stringify(chunk)
          safeEnqueue(encoder.encode(`event: ${chunk.type}\ndata: ${data}\n\n`))
        }
        safeEnqueue(encoder.encode(DONE_FRAME))
      } catch {
        // `presentUIMessageStream` already turns a thrown source into an `error` chunk, so reaching
        // here means the failure was in the ENQUEUE — the consumer is gone. There is nobody left to
        // tell, and a terminal frame would be written to a closed controller.
      } finally {
        controller.close()
      }
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
