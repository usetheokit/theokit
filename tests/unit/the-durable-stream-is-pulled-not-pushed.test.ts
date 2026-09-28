/**
 * The SSE body must be driven by the consumer reading it, not by a floating promise.
 *
 * `durableUiMessageStreamResponse` ran the whole agent turn inside `new ReadableStream({ async
 * start(controller) { for await (…) } })`. `start` is invoked EAGERLY at construction, its returned
 * promise is held by nobody, and the loop enqueues every frame of the turn before anything reads one.
 *
 * On Node that works: `fetch` returns, the microtask queue keeps draining, the loop finishes. On
 * **workerd it does not** — once the handler returns a Response, pending work that no consumer is
 * pulling and no `ctx.waitUntil` registered is torn down.
 *
 * Measured on a deployed Cloudflare worker, 2026-09-28 (B-321), with the provider secret set:
 *
 *     POST /api/agents/chat  ->  200, content-type: text/event-stream, 0 bytes, 1.68 s
 *     the identical request against `theokit start`  ->  200, 29 deltas, complete answer
 *
 * Not the key (a missing one returns a named 500, which is what local workerd returns because
 * `wrangler dev --local` populates `process.env` from bindings and not from the shell). Not curl
 * buffering (0 bytes with and without `-N`). 1.68 s is long enough that the turn ran.
 *
 * ## Why `pull`, and not `ctx.waitUntil`
 *
 * `waitUntil` keeps an isolate alive for work that should not have been detached in the first place.
 * Moving the work into `pull` makes the stream demand-driven, which is what the Streams standard is
 * for and which behaves identically on Node, workerd, Deno and Bun — no per-platform branch, and no
 * `ExecutionContext` threaded through six call sites to reach a transport.
 *
 * It also buys two things the eager version could not have:
 *
 * - **Backpressure.** One frame per pull instead of the whole turn buffered in the controller.
 * - **Cancellation.** A client that disconnects now releases the upstream iterator. The eager
 *   version had no `cancel`, so an abandoned request kept the agent turn running to completion —
 *   a leak on every platform, not just Workers.
 */
import { describe, expect, it } from 'vitest'

import type { WireChunk } from '@theokit/presenter/wire'

import type { RunEventCache } from '../../packages/theo/src/server/agent/run-event-cache.js'

import { durableUiMessageStreamResponse } from '../../packages/theo/src/server/agent/durable-ui-message-stream-response.js'

/**
 * The cache contract, recording what it was told so a case can assert the tee still happens.
 *
 * Implements `RunEventCache` in full rather than the two methods this transport calls. A partial
 * object cast into place would compile and would stop compiling the day the transport starts using
 * `begin` or `attach` — silently, because a cast is exactly the thing that hides that.
 */
function recordingCache(): RunEventCache & {
  readonly ended: string[]
  readonly appended: string[]
} {
  const appended: string[] = []
  const ended: string[] = []
  let seq = 0
  return {
    begin: () => undefined,
    append: (_runId, data) => {
      appended.push(data)
      seq += 1
      return seq
    },
    end: (runId) => {
      ended.push(runId)
    },
    has: (runId) => !ended.includes(runId),
    // The real shape, not a cast. A cast would compile over a wrong value and stop being checked
    // the day `AttachResult` changes — which is the one thing a stub must not do.
    attach: () => ({ known: false, replay: [], ended: true, unsubscribe: () => undefined }),
    appended,
    ended,
  }
}

/**
 * Real wire chunks. Typing these structurally as `{ type: string }` does not compile — the transport
 * is generic over `WireChunk`, and a looser fixture would be asserting against a shape the production
 * caller can never hand it.
 */
const CHUNKS: readonly WireChunk[] = [
  { type: 'start' },
  { type: 'text-delta', id: 'd1', delta: 'ok' },
  { type: 'finish' },
]

describe('the durable stream is pulled, not pushed', () => {
  it('test_nothing_is_consumed_before_the_body_is_read', async () => {
    // THE case. An eager `start` calls `.next()` on the source synchronously during construction, so
    // this counter is already non-zero before `new Response` returns — which is the shape workerd
    // tears down. A pull-driven stream touches the source only when someone reads.
    let taken = 0
    async function* source(): AsyncGenerator<WireChunk> {
      for (const chunk of CHUNKS) {
        taken += 1
        yield chunk
      }
    }
    const cache = recordingCache()

    const response = durableUiMessageStreamResponse(source(), { runId: 'r1', cache })

    expect(
      taken,
      'the source was consumed at construction time, so the turn runs in a promise nobody holds — ' +
        'workerd discards it the moment the handler returns and the client gets 0 bytes',
    ).toBe(0)

    // And reading DOES drive it, or the fix would be "never run the turn".
    await response.text()
    expect(taken).toBe(CHUNKS.length)
  })

  it('test_the_whole_turn_still_reaches_the_client', async () => {
    // COUNTERPROOF for the case above: a stream that consumes nothing satisfies it perfectly and
    // delivers nothing. This is the behaviour the pull rewrite must not cost.
    async function* source(): AsyncGenerator<WireChunk> {
      yield* CHUNKS
    }
    const cache = recordingCache()

    const body = await durableUiMessageStreamResponse(source(), { runId: 'r2', cache }).text()

    expect(body).toContain('"type":"start"')
    expect(body).toContain('"delta":"ok"')
    expect(body).toContain('"type":"finish"')
    expect(body).toContain('[DONE]')
    expect(cache.ended).toEqual(['r2'])
    expect(cache.appended).toHaveLength(CHUNKS.length)
  })

  it('test_the_frame_ids_stay_monotonic_across_pulls', async () => {
    // One `pull` per frame is a different control flow from one loop over all of them, and the `id:`
    // line is what lets a dropped client resume with Last-Event-ID. Off-by-one here is silent.
    async function* source(): AsyncGenerator<WireChunk> {
      yield* CHUNKS
    }

    const body = await durableUiMessageStreamResponse(source(), {
      runId: 'r3',
      cache: recordingCache(),
    }).text()

    expect([...body.matchAll(/^id: (\d+)$/gmu)].map((m) => Number(m[1]))).toEqual([1, 2, 3])
  })

  it('test_a_source_that_throws_still_ends_the_run', async () => {
    // The pre-existing fail-clear contract (`durable-ui-message-stream-response.test.ts` asserts it
    // for the eager version): a mid-stream throw must still end the cached run and terminate the
    // body. A `pull` rewrite has a second place to get this wrong, so it is re-asserted here.
    async function* source(): AsyncGenerator<WireChunk> {
      yield { type: 'start' }
      throw new Error('upstream died')
    }
    const cache = recordingCache()

    const body = await durableUiMessageStreamResponse(source(), { runId: 'r4', cache }).text()

    expect(body).toContain('"type":"start"')
    expect(body).toContain('[DONE]')
    expect(cache.ended).toEqual(['r4'])
  })

  it('test_a_cancelled_body_releases_the_upstream_turn', async () => {
    // NEW guarantee, and a leak the eager version had on every platform: with no `cancel`, a client
    // that disconnects left the agent turn running to completion — tokens billed for a response
    // nobody would read. `AsyncGenerator.return()` is what runs the generator's `finally`.
    let released = false
    async function* source(): AsyncGenerator<WireChunk> {
      try {
        yield { type: 'start' }
        yield { type: 'text-delta', id: 'd2', delta: 'more' }
        yield { type: 'finish' }
      } finally {
        released = true
      }
    }

    const response = durableUiMessageStreamResponse(source(), {
      runId: 'r5',
      cache: recordingCache(),
    })
    const reader = response.body?.getReader()
    if (reader === undefined) throw new Error('the response carries no body')

    await reader.read()
    await reader.cancel()

    expect(
      released,
      'cancelling the body did not release the upstream iterator, so an abandoned request keeps ' +
        'the agent turn running and billing to completion',
    ).toBe(true)
  })
})

/**
 * The terminal frame must survive a failure in the bookkeeping beside it.
 *
 * `finish()` set its idempotence flag FIRST, then called `cache.end(runId)`, then enqueued `[DONE]` and
 * closed. A throw from `cache.end` therefore skipped both terminal operations — and `pull`'s own
 * `catch { finish(controller) }` then found `finished` already true and returned. The flag that exists to
 * prevent a double terminator prevented the ONLY one.
 *
 * Measured end to end on 2026-09-28 (B-329), on a deployed-shape worker driving a real turn:
 *
 *     [PROBE] next resolved done=true
 *     [PROBE] finish: entrou
 *     [PROBE] finish: cache.end LANCOU TypeError: buf.evictTimer.unref is not a function
 *
 * Every content chunk had arrived, `finish` included. The client then waited until its own timeout: no
 * `[DONE]`, no close, `curl --max-time 25` exiting 28, three runs. A browser renders the reply and the
 * turn never completes, because the client keys its terminal state on that frame.
 *
 * ## What this case is NOT
 *
 * It is not about `unref`. That was the trigger and it is fixed next door in `run-event-cache.ts`, where
 * a Node-only API was called on a value that is a number under `nodejs_compat`. This asserts the
 * property that made a one-line trigger cost the whole stream: the terminator does not depend on the
 * bookkeeping succeeding.
 */
describe('the terminal frame survives a failing cache', () => {
  /**
   * A cache whose `end` throws, with the exact error the real one threw on workerd.
   *
   * Built from `recordingCache()` above rather than as a partial object, for the reason that helper
   * already states: a cast compiles over a wrong shape and stops being checked.
   */
  function throwingCache(): RunEventCache {
    return {
      ...recordingCache(),
      end: (): never => {
        throw new TypeError('buf.evictTimer.unref is not a function')
      },
    }
  }

  async function* twoChunks(): AsyncGenerator<WireChunk> {
    yield { type: 'start' } as WireChunk
    yield { type: 'finish' } as WireChunk
  }

  it('test_the_done_frame_is_sent_even_when_cache_end_throws', async () => {
    const body = await durableUiMessageStreamResponse(twoChunks(), {
      runId: 'throwing-1',
      cache: throwingCache(),
    }).text()

    expect(
      body.trimEnd().endsWith('data: [DONE]'),
      'the terminator was lost because the bookkeeping beside it threw — the client waits forever',
    ).toBe(true)
  })

  it('test_the_stream_closes_even_when_cache_end_throws', async () => {
    // `text()` above resolving already implies a close, so this asserts the reader side directly: the
    // failure mode was a body that stays open, which a hanging `read()` is the only way to observe.
    const response = durableUiMessageStreamResponse(twoChunks(), {
      runId: 'throwing-2',
      cache: throwingCache(),
    })
    const reader = response.body!.getReader()

    let closed = false
    for (let i = 0; i < 20; i++) {
      const { done } = await reader.read()
      if (done) {
        closed = true
        break
      }
    }

    expect(closed, 'the stream never reported done, so a client would hang on it').toBe(true)
  })

  it('test_the_content_still_reaches_the_client', async () => {
    // COUNTERPROOF: swallowing the failure must not cost the frames. A terminator with no turn in
    // front of it would satisfy both cases above.
    const body = await durableUiMessageStreamResponse(twoChunks(), {
      runId: 'throwing-3',
      cache: throwingCache(),
    }).text()

    expect(body).toContain('"type":"start"')
    expect(body).toContain('"type":"finish"')
  })
})
