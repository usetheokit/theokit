import type { UIMessageChunk } from 'ai'

import type { RunEventCache } from './run-event-cache.js'

/**
 * M37 (ADR-0046) — the DURABLE variant of `uiMessageStreamResponse`. Same
 * `UIMessageStream` wire (`useChat` still consumes it), plus three additions so
 * a dropped client can reconnect without missing chunks:
 *
 * 1. each SSE frame gains a monotonic `id: <seq>\n` line (SSE-native — the
 *    browser echoes it as `Last-Event-ID` on reconnect, ADR-0046 D3);
 * 2. every frame is `append`ed to the {@link RunEventCache} keyed by `runId`
 *    so the reconnect endpoint can replay it;
 * 3. the response carries `x-theokit-run-id: <runId>` so the client learns the
 *    reconnect key (ADR-0046 D2).
 *
 * Fail-clear (error-handling.md): if the source aborts mid-stream, the run is
 * still `end`ed in the cache and `[DONE]` is flushed — never left hanging.
 */

/** The UIMessageStream SSE base headers — shared by the encoder + reconnect handler (DRY). */
export const SSE_BASE_HEADERS = {
  'content-type': 'text/event-stream',
  'x-vercel-ai-ui-message-stream': 'v1',
} as const

/** Header the client reads to obtain the reconnect key. */
export const RUN_ID_HEADER = 'x-theokit-run-id'

export const SSE_DONE_FRAME = 'data: [DONE]\n\n'

/** Format one SSE frame with its sequence id (shared by the encoder + reconnect replay). */
export function formatSseFrame(seq: number, data: string): string {
  return `id: ${seq}\ndata: ${data}\n\n`
}

/** UTF-8 encode an SSE frame for a `ReadableStream<Uint8Array>` (shared). */
export function encodeSse(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

interface DurableStreamDeps {
  readonly runId: string
  readonly cache: RunEventCache
}

export function durableUiMessageStreamResponse(
  chunks: AsyncIterable<UIMessageChunk>,
  deps: DurableStreamDeps,
): Response {
  const { runId, cache } = deps
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of chunks) {
          const data = JSON.stringify(chunk)
          const seq = cache.append(runId, data)
          controller.enqueue(encodeSse(formatSseFrame(seq, data)))
        }
      } catch {
        // Source aborted mid-stream. The upstream translator owns error
        // semantics (surfaces failures as chunks + closes gracefully); this
        // transport guarantees only a terminated, cache-ended stream.
      } finally {
        cache.end(runId)
        controller.enqueue(encodeSse(SSE_DONE_FRAME))
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: { ...SSE_BASE_HEADERS, [RUN_ID_HEADER]: runId },
  })
}
