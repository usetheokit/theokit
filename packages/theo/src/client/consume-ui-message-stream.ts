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
  if (response.body === null) return

  const { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema } = await import('ai')

  // ai validates each SSE JSON frame against its own strict chunk schema (the exact
  // gate `useChat` runs), then yields `{ success, value }`; forward the valid chunks.
  const parsed = parseJsonEventStream({ stream: response.body, schema: uiMessageChunkSchema })
  const chunkStream = new ReadableStream<UIMessageChunk>({
    async start(controller) {
      for await (const result of parsed) {
        if (result.success) controller.enqueue(result.value)
      }
      controller.close()
    },
  })

  for await (const message of readUIMessageStream({ stream: chunkStream })) {
    onMessage(message)
  }
}
