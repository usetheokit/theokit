import type { WireChunk as UIMessageChunk } from '@theokit/presenter/wire'

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

/**
 * The UIMessageStream SSE base headers — shared by the encoder, the thread route and the reconnect
 * handler (DRY), so a response cannot stream on one path and be buffered on another.
 *
 * `cache-control` and `x-accel-buffering` are what tell the PATH not to hold the run
 * (usetheokit/theokit#383). The server streamed correctly and said nothing downstream, so any
 * intermediary that buffers by default — nginx, a compressing reverse proxy, a CDN edge — was free
 * to deliver the whole run as one block at the end. That breaks where it is hardest to notice:
 * behind someone else's proxy, in production, looking correct.
 *
 * The Vercel AI SDK, whose wire this mirrors, sends a fifth — `connection: keep-alive`. It is
 * deliberately absent, on measurement rather than preference: it is hop-by-hop, Node manages
 * keep-alive itself on HTTP/1, and on HTTP/2 Node drops it with
 * `UnsupportedWarning: The provided connection header is not valid` — so it would buy nothing on
 * one protocol and print a warning per response on the other.
 */
export const SSE_BASE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  'x-accel-buffering': 'no',
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

/**
 * Why this stream is PULLED and not pushed.
 *
 * The first version ran the whole turn inside `new ReadableStream({ async start(controller) { for
 * await (…) } })`. `start` is invoked eagerly at construction, its promise is held by nobody, and the
 * loop enqueued every frame before anything read one.
 *
 * On Node that works — the handler returns and the microtask queue keeps draining. **On workerd it
 * does not.** Once the handler returns a Response, pending work that no consumer is pulling and no
 * `ctx.waitUntil` registered is torn down. Measured on a deployed Cloudflare worker, 2026-09-28
 * (B-321), with the provider secret set:
 *
 *     POST /api/agents/chat  ->  200, content-type: text/event-stream, 0 bytes, 1.68 s
 *     the same request against `theokit start`  ->  200, 29 deltas, complete answer
 *
 * `pull` instead of `ctx.waitUntil`, deliberately. `waitUntil` keeps an isolate alive for work that
 * should never have been detached, and it would mean threading an `ExecutionContext` from six
 * adapters down into a transport. Demand-driven is what the Streams standard is for, and it behaves
 * the same on Node, workerd, Deno and Bun with no per-platform branch.
 *
 * Two guarantees the eager version could not have:
 *
 * - **Backpressure** — one frame per pull rather than a whole turn buffered in the controller.
 * - **Cancellation** — `cancel` releases the upstream iterator, so a client that disconnects stops
 *   the turn. The eager version had no `cancel`, so an abandoned request ran the agent to completion
 *   and billed for a response nobody would read. That was a leak on every platform, not just Workers.
 */
export function durableUiMessageStreamResponse(
  chunks: AsyncIterable<UIMessageChunk>,
  deps: DurableStreamDeps,
): Response {
  const { runId, cache } = deps
  const iterator = chunks[Symbol.asyncIterator]()
  let finished = false

  /**
   * End the run exactly once.
   *
   * `pull` can be re-entered after the terminal frame — a consumer may read again before the close
   * lands — and `cache.end` twice or a second `[DONE]` would corrupt a reconnect replay.
   */
  /**
   * End the cached run WITHOUT letting a bookkeeping failure cost the caller its own work.
   *
   * `cache.end` is bookkeeping BESIDE the terminator, not part of it, and it used to run first with the
   * idempotence flag already set. So a throw skipped the terminal frame and the close, `pull`'s
   * `catch { finish(controller) }` then found `finished` already true and returned, and the flag that
   * exists to prevent a SECOND terminator prevented the ONLY one.
   *
   * Measured end to end on 2026-09-28 (B-329), driving a real turn against a deployed-shape worker:
   *
   *     [PROBE] next resolved done=true
   *     [PROBE] finish: cache.end LANCOU TypeError: buf.evictTimer.unref is not a function
   *
   * Every chunk had arrived, `finish` included, and the client then waited until its own timeout. The
   * trigger is fixed where it was, in `run-event-cache.ts`; this is the property that made a one-line
   * trigger cost the whole stream.
   *
   * REPORTED rather than swallowed, per `rules/error-handling.md`. What the failure costs is a reconnect
   * replay that may be stale — which a reader of the log can act on, while a stream that never ends
   * gives them nothing to act on at all.
   */
  function endCachedRun(): void {
    try {
      cache.end(runId)
    } catch (err) {
      console.error(
        `[theokit] durable run ${runId}: cache.end failed, so a reconnect replay may be stale:`,
        err,
      )
    }
  }

  function finish(controller: ReadableStreamDefaultController<Uint8Array>): void {
    if (finished) return
    finished = true
    endCachedRun()
    try {
      controller.enqueue(encodeSse(SSE_DONE_FRAME))
      controller.close()
    } catch (err) {
      // The consumer is already gone, so both calls above would be writing to a controller that is
      // closed. Distinct from the case above: there the stream is still owed a terminator, here there
      // is nobody left to give one to.
      console.error(
        `[theokit] durable run ${runId}: could not terminate a stream nobody is reading:`,
        err,
      )
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return
      try {
        const next = await iterator.next()
        if (next.done === true) {
          finish(controller)
          return
        }
        const data = JSON.stringify(next.value)
        const seq = cache.append(runId, data)
        controller.enqueue(encodeSse(formatSseFrame(seq, data)))
      } catch {
        // Source aborted mid-stream. The upstream translator owns error semantics (it surfaces
        // failures as chunks and closes gracefully); this transport guarantees only a terminated,
        // cache-ended stream — fail-clear, per `rules/error-handling.md`.
        finish(controller)
      }
    },
    async cancel(reason) {
      // The client went away. Release the turn rather than letting it run to completion, and end the
      // cached run so a reconnect sees a closed stream instead of one that never terminates.
      finished = true
      // Same exposure as `finish` had, and it would have cost the release of the turn rather than the
      // terminator: `cache.end` first, so a throw here meant `iterator.return` never ran and the run
      // kept going with nobody reading it.
      endCachedRun()
      await iterator.return?.(reason)
    },
  })

  return new Response(stream, {
    headers: { ...SSE_BASE_HEADERS, [RUN_ID_HEADER]: runId },
  })
}
