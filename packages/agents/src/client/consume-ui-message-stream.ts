import { parseWireStream, readMessageStream } from '@theokit/presenter/wire'
import type { WireChunk, WireMessage } from '@theokit/presenter/wire'

type UIMessage = WireMessage
type UIMessageChunk = WireChunk

/**
 * Read a TheoKit agent endpoint's `UIMessageStream` SSE `Response` into reconstructed assistant
 * messages.
 *
 * ## What changed, and why (plan `remove-ai-dependency`)
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
): Promise<ChunkStreamOutcome> {
  const chunkStream = await responseToChunkStream(response)
  return consumeChunkStream(chunkStream, onMessage)
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
 * How a chunk stream ENDED — theokit#384.
 *
 * ## Why this exists at all
 *
 * The reader used to return `void`, which left its caller exactly two outcomes to choose between:
 * it threw, or it did not. A stream that simply STOPS — a socket closed mid-run — throws nothing,
 * so `AgentClient` read "did not throw" as "the agent finished" and settled a truncated answer in
 * `status: 'done'` with no error. The information needed to tell the two apart was on the wire and
 * nothing carried it out of the reader.
 *
 * ## What counts as an ending, and what does not
 *
 * The stream's own terminal chunk, `finish`, is the marker — NOT the SSE `[DONE]` sentinel:
 *
 *  - `finish` is emitted by `presentUIMessageStream` on EVERY framework path, including the error
 *    path, so it is the one terminator that exists on all three transports. `[DONE]` is written
 *    only by the durable SSE encoder, so an in-process or channel stream has none to look for.
 *  - `[DONE]` is also the WEAKER claim of the two. `durableUiMessageStreamResponse` flushes it from
 *    a `finally` even when the source aborted mid-run, so a run cut on the SERVER carries `[DONE]`
 *    and no `finish`. Keying on `finish` reports that case too; keying on `[DONE]` would miss it.
 *
 * `finish` also cannot lie in the other direction: nothing can truncate a run after its terminal
 * chunk has been written, so a stream that carried one carried a complete turn even if the socket
 * died a byte later.
 */
export interface ChunkStreamOutcome {
  /**
   * `true` iff the terminal `finish` chunk crossed before the stream ended.
   *
   * `false` means the producer stopped talking mid-run: a dropped connection, a killed server, a
   * proxy timeout. It does NOT mean the run failed — a failure arrives as an `error` chunk, which
   * the reader raises instead of returning.
   */
  readonly terminated: boolean
  /**
   * How many chunks crossed. Diagnostic only, and it earns its place: it separates "the server
   * accepted the request and then said nothing" (`0`) from "the answer was cut mid-sentence"
   * (`n > 0`), which are different failures with different first suspects.
   */
  readonly chunksReceived: number
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
 *
 * theokit#384 — it also RETURNS how the stream ended. See {@link ChunkStreamOutcome}.
 *
 * The observation happens in a `TransformStream` rather than inside `readMessageStream`, because a
 * bare `finish` reconstructs to nothing: the reader yields a snapshot for it only when it carries
 * `messageMetadata`, so the terminal chunk is invisible at the message level by design (measured
 * against the ai-sdk oracle — see `read-message-stream.ts`). Watching the CHUNKS is the only place
 * the terminator is observable without changing what the reader emits. The cost is one queue hop
 * per chunk on a path that already spends 3.274 ms per emit deriving the timeline (M86) — real,
 * and three orders of magnitude below the work it sits next to.
 */
export async function consumeChunkStream(
  stream: ReadableStream<UIMessageChunk>,
  onMessage: (message: UIMessage) => void,
): Promise<ChunkStreamOutcome> {
  let chunksReceived = 0
  let terminated = false
  const watched = stream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        chunksReceived += 1
        if (chunk.type === 'finish') terminated = true
        controller.enqueue(chunk)
      },
    }),
  )
  for await (const message of readMessageStream(watched)) {
    onMessage(message)
  }
  return { terminated, chunksReceived }
}
