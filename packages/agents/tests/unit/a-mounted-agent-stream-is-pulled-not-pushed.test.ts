/**
 * The stream every mounted agent answers with must be pulled, not pushed.
 *
 * `streamAgentResponse` built its body with `new ReadableStream({ async start })`. That runs eagerly
 * and leaves a floating promise: Node drains the microtask queue after the handler returns, and
 * **workerd tears down pending work**. So the continuation after an `await` is not guaranteed to run,
 * and the two operations at the end of the loop — the terminal `[DONE]` frame and `controller.close()`
 * — are exactly the ones that sit there.
 *
 * ## Measured on two targets, because no mock can reproduce a runtime that stops running
 *
 * The same app, the same request, 2026-09-28 (B-327):
 *
 *     node     POST /api/agents/chat  ->  1.54s   14 frames   1 × [DONE]   curl exit 0
 *     workerd  POST /api/agents/chat  ->  20.0s   13 frames   0 × [DONE]   curl exit 28
 *
 * Every content chunk arrived on both, `finish` included. On workerd the request then never ended: a
 * client keys its terminal state on `[DONE]` — the constant's own docblock says so — so the reply
 * renders and the turn never completes.
 *
 * The code was correct throughout. `presentUIMessageStream` yields `presenter.finish(...)` as its last
 * statement and returns, so the `for await` provably exits; what did not happen is the two lines after
 * it. `agent-sse-handler.test.ts` passes 6/6 against a source that terminates, on Node, and cannot see
 * this.
 *
 * ## Why `pull`
 *
 * It is demand-driven, which is what the Streams standard is for, and it behaves identically on Node,
 * workerd, Deno and Bun. It also brings backpressure — one frame per pull instead of a whole turn
 * buffered in the controller — and cancellation, for free.
 *
 * This is the second file in this repository to assert this property. `B-321` established it for
 * `durableUiMessageStreamResponse` and did not reach the sibling that serves every mounted agent, so
 * the pattern survived one file away from its own fix. The case below is that one's, restated against
 * this encoder.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { streamAgentResponse, type StreamEvent } from '../../src/bridge/agent-sse-handler.js'

/** The encoder's own code, comments stripped, so prose naming a construct is not read as the construct. */
const SOURCE = readFileSync(
  new URL('../../src/bridge/agent-sse-handler.ts', import.meta.url),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const EVENTS: StreamEvent[] = [
  { type: 'text_delta', content: 'it ' },
  { type: 'text_delta', content: 'works' },
]

describe('a mounted agent stream is pulled, not pushed', () => {
  it('test_the_body_is_built_with_pull_and_not_with_an_async_start', () => {
    // Asserted on the DECLARATION, because the behaviour is not observable in-process and pretending
    // otherwise costs more than asserting nothing.
    //
    // The obvious case — "nothing is consumed before the body is read" — was written first and passed
    // WITH the defect in place. `async start` is invoked during construction and runs synchronously
    // only until its first suspension, and that suspension is the first `.next()` of
    // `presentUIMessageStream`, which yields `{ type: 'start' }` before it touches the source. So the
    // source is untouched at construction under BOTH shapes, and a counter read synchronously reports
    // 0 either way. A test that passes before the fix guards nothing.
    //
    // What separates the two shapes is a runtime that stops running a floating continuation, and no
    // in-process mock can be that. The discriminator was two targets; this is the guard that stays
    // behind, and it is falsifiable by a grep on the declaration.

    // Anti-vacuity FIRST: both assertions are about a string, and a string that failed to load
    // satisfies an absence trivially.
    expect(SOURCE).toContain('export function streamAgentResponse')
    expect(SOURCE.length).toBeGreaterThan(500)

    expect(
      SOURCE,
      'the body is built with an eager `async start`, whose continuation workerd tears down — the ' +
        'terminal frame and `controller.close()` are the two operations that sit after the loop',
    ).not.toContain('async start(')
    expect(SOURCE, 'the stream is not demand-driven').toContain('async pull(')
  })

  it('test_the_whole_turn_still_reaches_the_client', async () => {
    // The behaviour the rewrite may not cost: every chunk, in order, once somebody reads.
    let taken = 0
    async function* source(): AsyncGenerator<StreamEvent> {
      for (const event of EVENTS) {
        taken += 1
        yield event
      }
    }

    await streamAgentResponse(source()).text()

    expect(taken).toBe(EVENTS.length)
  })

  it('test_the_terminal_frame_still_closes_the_stream', async () => {
    // COUNTERPROOF: a stream that consumes nothing satisfies the case above perfectly. This is the
    // behaviour the rewrite may not cost, and it is what a client keys its terminal state on.
    const body = await streamAgentResponse(
      (async function* (): AsyncGenerator<StreamEvent> {
        yield* EVENTS
      })(),
    ).text()

    expect(body).toContain('"delta":"it "')
    expect(body).toContain('"type":"finish"')
    expect(body.endsWith('data: [DONE]\n\n')).toBe(true)
  })

  it('test_a_cancelled_turn_is_recorded_and_the_source_is_released', async () => {
    // `cancel` is the half the eager shape could not express at all, and the reason it receives is the
    // half that is easy to drop. It cannot be forwarded — `presentUIMessageStream`'s `TReturn` is
    // `void`, so `return()` takes nothing else — and dropping it silently is the swallow B-322 removed
    // from the error path. It goes to the gated channel, so a client navigating away stays quiet by
    // default and an operator who asks can see it.
    let released = false
    async function* source(): AsyncGenerator<StreamEvent> {
      try {
        yield EVENTS[0]!
        yield EVENTS[1]!
      } finally {
        released = true
      }
    }

    const previous = process.env.THEOKIT_DEBUG
    process.env.THEOKIT_DEBUG = '1'
    const seen: unknown[] = []
    const debug = console.debug
    console.debug = (...args: unknown[]): void => {
      seen.push(args)
    }
    try {
      const body = streamAgentResponse(source()).body
      const reader = body!.getReader()
      // TWO reads, not one. The first chunk out is `{ type: 'start' }`, which
      // `presentUIMessageStream` yields BEFORE it touches the source — so after one read the source's
      // `try` has not been entered and its `finally` could not run either way. Cancelling there would
      // assert nothing, which is what the first version of this case did.
      await reader.read()
      await reader.read()
      await reader.cancel('the client navigated away')
    } finally {
      console.debug = debug
      if (previous === undefined) delete process.env.THEOKIT_DEBUG
      else process.env.THEOKIT_DEBUG = previous
    }

    expect(released, 'the upstream turn kept running after the client went away').toBe(true)
    expect(
      JSON.stringify(seen),
      'the cancellation reason reached nobody, so a turn released early leaves no trace',
    ).toContain('the client navigated away')
  })

  it('test_a_source_that_throws_still_terminates', async () => {
    // NEGATIVE case. A provider failure must not be the one path that hangs — that is the shape the
    // two targets measured, arriving through the error branch instead of the happy one.
    const body = await streamAgentResponse(
      (async function* (): AsyncGenerator<StreamEvent> {
        yield EVENTS[0]!
        throw new Error('Provider rate limited')
      })(),
    ).text()

    expect(body).toContain('"type":"error"')
    expect(body.endsWith('data: [DONE]\n\n')).toBe(true)
  })
})
