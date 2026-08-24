/**
 * A body that could not be produced in full must not be delivered as a complete one
 * (usetheokit/theokit#391).
 *
 * `pipeWebStreamToResponse` caught a mid-body stream error, logged `stream.error`, ran the
 * `onError` plugin hook — and then the caller reached `res.end()` unconditionally, the same call a
 * successful stream makes. Status 200, chunked encoding terminated correctly, `done: true` at the
 * reader. Nothing on the wire distinguished "the answer finished" from "the answer was cut off".
 *
 * For an agent framework that is the worst shape a truncation can take: the user reads a plausible
 * half-answer, and the product has told them by every available signal that it is complete.
 *
 * It is `docs/adr/0002-an-abnormal-ending-is-never-reported-as-normal.md` at the executor layer, so
 * it reaches EVERY streaming route on EVERY target — the Node server driving a real
 * `ServerResponse`, and the six Web adapters through `createWebShim`. Both are driven here, because
 * "abnormal" means something different on each: a destroyed socket aborts the chunked encoding for
 * a Node consumer, and an errored stream is what a Web consumer can observe.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { describe, expect, it, vi } from 'vitest'

import { createWebShim } from '../../packages/theo/src/adapters/web-shim.js'
import { executeRoute } from '../../packages/theo/src/server/http/execute.js'
import type { ServerRouteNode } from '../../packages/theo/src/server/scan/match.js'

const ROUTE: ServerRouteNode = {
  filePath: '/virtual/truncating.mjs',
  routePath: '/api/test',
  pattern: /^\/api\/test$/u,
  paramNames: [],
}

/** A handler whose body yields one chunk and then fails, the way an upstream dying looks. */
function loaderThatDiesMidBody() {
  return async () => ({
    GET: {
      policy: 'public' as const,
      handler: () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('half an answer'))
            controller.error(new Error('upstream died'))
          },
        })
        return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
      },
    },
  })
}

function nodeResponseSpy() {
  const state = { ended: false, destroyedWith: undefined as unknown }
  return {
    res: {
      writeHead: vi.fn(),
      setHeader: vi.fn(),
      write: vi.fn(() => true),
      end: vi.fn(() => {
        state.ended = true
      }),
      destroy: vi.fn((err?: unknown) => {
        state.destroyedWith = err ?? null
      }),
      headersSent: false,
      writableEnded: false,
    } as unknown as ServerResponse,
    state,
  }
}

const REQ = { method: 'GET', url: '/api/test', headers: {} } as unknown as IncomingMessage

describe('a stream that fails mid-body ends abnormally (#391)', () => {
  it('destroys the Node response instead of ending it cleanly', async () => {
    const { res, state } = nodeResponseSpy()

    await executeRoute({
      route: ROUTE,
      method: 'GET',
      params: {},
      req: REQ,
      res,
      loadModule: loaderThatDiesMidBody(),
    })

    // Destroying the socket aborts the chunked encoding — the only signal left once the head has
    // gone out. The adapters' own generated pumps already do exactly this, citing the same ADR.
    expect(state.destroyedWith, 'the response was not destroyed').toBeDefined()
    expect(state.ended, 'a truncated body was closed as though it were complete').toBe(false)
  })

  it('errors the body stream a Web consumer reads', async () => {
    const request = new Request('http://localhost/api/test')
    const { req, res, toResponse } = createWebShim(request)

    const response = await toResponse(
      executeRoute({
        route: ROUTE,
        method: 'GET',
        params: {},
        req: req as unknown as IncomingMessage,
        res: res as unknown as ServerResponse,
        loadModule: loaderThatDiesMidBody(),
      }),
    )

    // Draining to completion is the honest instrument: what a consumer must never get is a clean
    // `done`, and WHERE the rejection lands is a WHATWG detail rather than a contract. Erroring a
    // stream discards whatever is queued, so the shim rejects on the first read while the Node
    // path has already put those bytes on a socket it cannot unsend — different points, same
    // answer, and asserting a particular one would pin the detail instead of the guarantee.
    const drain = async (): Promise<'ended-cleanly'> => {
      const reader = response.body?.getReader()
      if (!reader) throw new Error('the response carried no body')
      let done = false
      while (!done) done = (await reader.read()).done
      return 'ended-cleanly'
    }

    await expect(drain()).rejects.toThrow(/upstream died/u)
  })
})
