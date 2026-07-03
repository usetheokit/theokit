import type { UIMessageChunk } from 'ai'

/**
 * M0 (theokit-ai-first) — serialize a stream of ai-sdk `UIMessageChunk`s into a
 * Web-Standards `Response` on the UIMessageStream wire so `@ai-sdk/react`'s
 * `useChat` consumes it WITHOUT a custom adapter.
 *
 * Wire contract (must match ai-sdk's consumer transport exactly):
 * - `content-type: text/event-stream`
 * - `x-vercel-ai-ui-message-stream: v1` — the version marker `useChat` checks
 * - each chunk framed as `data: ${JSON.stringify(chunk)}\n\n`
 * - a terminal `data: [DONE]\n\n` after the last chunk (ignored by the parser)
 *
 * Web Standards only — `Response` + `ReadableStream` (G8, no node:http). The
 * headers commit before the stream starts (mirrors define-agent-endpoint.ts).
 *
 * Fail-clear (error-handling.md): if the source iterable throws mid-stream, the
 * `[DONE]` terminal is still flushed and the stream is closed — never left
 * hanging. (The translator upstream already closes gracefully; this is defense
 * in depth for any other chunk source.)
 */
const UI_MESSAGE_STREAM_HEADERS = {
  'content-type': 'text/event-stream',
  'x-vercel-ai-ui-message-stream': 'v1',
} as const

const DONE_FRAME = 'data: [DONE]\n\n'

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function uiMessageStreamResponse(chunks: AsyncIterable<UIMessageChunk>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of chunks) {
          controller.enqueue(encode(`data: ${JSON.stringify(chunk)}\n\n`))
        }
      } catch {
        // The source iterable aborted mid-stream. The upstream translator owns
        // error semantics (it surfaces failures as chunks + closes gracefully);
        // this transport's sole guarantee is a terminated stream — fall through
        // to the DONE terminal rather than re-throw and error an open stream.
      } finally {
        controller.enqueue(encode(DONE_FRAME))
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: UI_MESSAGE_STREAM_HEADERS })
}
