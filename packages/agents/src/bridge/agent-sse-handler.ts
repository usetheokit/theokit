/**
 * SSE streaming handler — Web Standard Response with ReadableStream.
 *
 * Per ADR D4: SSE is the v1 transport.
 * Per EC-2: uses ReadableStream with controller.enqueue() instead of res.write().
 * Works natively on Node, Bun, Deno, CF Workers.
 */

/** Minimal event shape matching SDK's SDKMessage discriminated union. */
export interface StreamEvent {
  type: string
  [key: string]: unknown
}

const encoder = new TextEncoder()

/**
 * Create a Web Standard Response that streams SSE events.
 * Each event becomes: `event: {type}\ndata: {json}\n\n`
 */
export function streamAgentResponse(
  eventStream: AsyncIterable<StreamEvent>,
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of eventStream) {
          const data = JSON.stringify(event)
          const frame = `event: ${event.type}\ndata: ${data}\n\n`
          controller.enqueue(encoder.encode(frame))
        }
      } catch (err) {
        const errorEvent = {
          type: 'error',
          error: { message: err instanceof Error ? err.message : 'Internal agent error' },
        }
        const frame = `event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`
        controller.enqueue(encoder.encode(frame))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    },
  })
}
