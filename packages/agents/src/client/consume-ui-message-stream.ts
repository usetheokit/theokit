import { parseWireStream, readMessageStream } from '@theokit/presenter/wire'
import type { WireChunk, WireMessage } from '@theokit/presenter/wire'

type UIMessage = WireMessage
type UIMessageChunk = WireChunk

/**
 * Read a TheoKit agent endpoint's `UIMessageStream` SSE `Response` into reconstructed assistant
 * messages.
 *
 * ## What changed, and why (plan `remover-dependencia-ai`)
 *
 * This file used to be the ONLY runtime use of `ai` in the whole published surface — two
 * `await import('ai')` calls, measured in `@theokit/agents@7.0.0/dist/chunk-FCGL2PEC.js`. It now
 * uses TheoKit's own wire module, so installing `theokit` no longer pulls the ai-sdk. The FRAME
 * FORMAT is unchanged: an ai-sdk client still understands a TheoKit server and vice versa.
 *
 * The import is static again. It was dynamic only because `ai` was an OPTIONAL peer that an app
 * might not have installed; `@theokit/presenter` is a real dependency, so there is nothing to defer.
 *
 * ## The #136 workaround is gone with the thing it worked around
 *
 * `ai`'s reader swallows an `error` chunk unless the caller passes BOTH `onError` and
 * `terminateOnError` — eight lines of comment used to explain that trap here. Owning the reader
 * makes rejecting on `error` the DEFAULT, so the workaround has nothing left to work around. The
 * behaviour a consumer sees is identical; the regression test for #136 still guards it.
 *
 * `onMessage` is invoked on every reconstruction step with the latest snapshot of the assistant
 * message, so a caller (the `useAgent` hook) can render streaming updates.
 */
export async function consumeUIMessageStream(
  response: Response,
  onMessage: (message: UIMessage) => void,
): Promise<void> {
  const chunkStream = await responseToChunkStream(response)
  await consumeChunkStream(chunkStream, onMessage)
}

/**
 * A UIMessageStream SSE `Response` → `ReadableStream<UIMessageChunk>`. This is precisely what a
 * `ChatTransport.sendMessages` returns, so `HttpTransport` builds on it directly. A body-less
 * response yields an empty stream.
 */
export function responseToChunkStream(response: Response): Promise<ReadableStream<UIMessageChunk>> {
  if (response.body === null) {
    return Promise.resolve(
      new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.close()
        },
      }),
    )
  }
  return Promise.resolve(parseWireStream(response.body))
}

/**
 * Read a `ReadableStream<UIMessageChunk>` into reconstructed assistant messages. Shared by
 * {@link consumeUIMessageStream} (Response path) and the framework-agnostic `AgentClient` store
 * (transport path). `onMessage` fires on every reconstruction step so a caller can render
 * streaming updates.
 *
 * A provider failure (401/429/5xx) arrives as a `{ type: 'error', errorText }` chunk rather than a
 * thrown rejection — both the in-process runner and the SSE path emit it as data. The reader
 * rejects on it, so `AgentClient.#drive`'s existing catch surfaces it (`status='error'`).
 */
export async function consumeChunkStream(
  stream: ReadableStream<UIMessageChunk>,
  onMessage: (message: UIMessage) => void,
): Promise<void> {
  for await (const message of readMessageStream(stream)) {
    onMessage(message)
  }
}
