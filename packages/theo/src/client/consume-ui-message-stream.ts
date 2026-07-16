import type { UIMessage, UIMessageChunk } from 'ai'

/**
 * M2 (theokit-ai-first) — read a TheoKit agent endpoint's `UIMessageStream` SSE `Response`
 * into reconstructed assistant `UIMessage`s, reusing the `ai` package's own consumer
 * primitives (`parseJsonEventStream` + `readUIMessageStream`) — the exact path
 * `@ai-sdk/react`'s `useChat` runs internally. No reinvented wire parser (Rule 9).
 *
 * `ai` is an OPTIONAL peer dependency, so it is imported dynamically: an app that never
 * calls an agent never pays for it, and importing `theokit/client` does not hard-require
 * `ai` (mirrors how the agent runtime dynamically imports `@theokit/sdk`). An agent app
 * always has `ai` installed (it is the UIMessageStream consumer).
 *
 * `onMessage` is invoked on every reconstruction step with the latest snapshot of the
 * assistant message, so a caller (the `useAgent` hook) can render streaming updates.
 */
export async function consumeUIMessageStream(
  response: Response,
  onMessage: (message: UIMessage) => void,
): Promise<void> {
  const chunkStream = await responseToChunkStream(response)
  await consumeChunkStream(chunkStream, onMessage)
}

/**
 * M41 (ADR-0050 D3) — the reusable middle piece: a UIMessageStream SSE `Response` →
 * `ReadableStream<UIMessageChunk>`, reusing `ai`'s own `parseJsonEventStream` (the exact primitive
 * `useChat` runs). This is precisely what a `ChatTransport.sendMessages` returns, so `HttpTransport`
 * builds on it directly (no reinvented wire parser — Rule 9). A body-less response yields an empty stream.
 */
export async function responseToChunkStream(
  response: Response,
): Promise<ReadableStream<UIMessageChunk>> {
  if (response.body === null) {
    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.close()
      },
    })
  }

  const { parseJsonEventStream, uiMessageChunkSchema } = await import('ai')

  // ai validates each SSE JSON frame against its own strict chunk schema (the exact gate `useChat`
  // runs), then yields `{ success, value }`; forward the valid chunks.
  const parsed = parseJsonEventStream({ stream: response.body, schema: uiMessageChunkSchema })
  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      for await (const result of parsed) {
        if (result.success) controller.enqueue(result.value)
      }
      controller.close()
    },
  })
}

/**
 * M41 (ADR-0050 D6) — read a `ReadableStream<UIMessageChunk>` into reconstructed assistant
 * `UIMessage`s via `ai`'s `readUIMessageStream`. Shared by `consumeUIMessageStream` (Response path)
 * and the framework-agnostic `AgentClient` store (transport path). `onMessage` fires on every
 * reconstruction step so a caller can render streaming updates.
 */
export async function consumeChunkStream(
  stream: ReadableStream<UIMessageChunk>,
  onMessage: (message: UIMessage) => void,
): Promise<void> {
  const { readUIMessageStream } = await import('ai')
  // #136 — a provider failure (401/429/5xx) arrives as a `{ type: 'error', errorText }` chunk, NOT a
  // thrown rejection (the in-process runner and the SSE path both emit it as data). `ai`'s
  // `readUIMessageStream` calls `onError` on that chunk but does NOT throw, so without a hook it is
  // silently swallowed and the stream ends "clean" — the store then settles to 'done' instead of
  // 'error'. Capture the error and `terminateOnError` (stop reconstructing partial messages after it),
  // then rethrow so `AgentClient.#drive`'s existing catch surfaces it (status='error', error set).
  let streamError: Error | undefined
  for await (const message of readUIMessageStream({
    stream,
    onError: (err) => {
      streamError = err instanceof Error ? err : new Error(String(err))
    },
    terminateOnError: true,
  })) {
    onMessage(message)
  }
  if (streamError !== undefined) throw streamError
}
