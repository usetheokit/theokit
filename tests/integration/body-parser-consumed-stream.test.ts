/**
 * theokit#400, second layer — a body somebody else already drank is reported, never awaited.
 *
 * ## Why a second layer exists at all
 *
 * The primary fix is an ordering one: the aux-route dispatcher no longer converts the Node request
 * before deciding whether it owns the path, so nothing eats the body of a request it will not
 * answer. That closes the one occurrence we found. It does not make the next one visible.
 *
 * `parseJsonBody` waited on `'end'` unconditionally. On a stream that had already ended, that event
 * cannot fire a second time, so the request hung: no status, no error, no timeout, nothing in the
 * log. Any future middleware, adapter or dispatcher that reads the stream and forgets to pass the
 * value on would reproduce exactly that silence. `docs/adr/0002` says an abnormal ending is never
 * reported as a normal one; an ending that never arrives is the same failure with even less to read.
 *
 * So the parser now answers instead of waiting — a named `RequestBodyConsumedError`, and a 500,
 * because a body the framework itself drank is not the caller's mistake to fix.
 *
 * ## The stream is real, and that is the point
 *
 * A hand-made stub can be told to be "already ended" and will agree with whatever the code believes
 * (B-022). This drives a real `node:http` server over a real socket and drains the request the way
 * the defect did — `Readable.toWeb()`, the same call inside `incomingMessageToWebRequest` — so
 * `readableEnded` becomes true for the same reason it did in production.
 *
 * Every request is bounded: the failure under test is a hang, so an unbounded assertion would hang
 * with it.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import {
  parseRequestBody,
  RequestBodyConsumedError,
} from '../../packages/theo/src/server/body-parser.js'

/** Long enough that a hang is unmistakable, short enough that the failure arrives promptly. */
const BUDGET_MS = 1500

let server: Server | undefined

afterEach(async () => {
  const running = server
  server = undefined
  if (running) await new Promise<void>((resolve) => running.close(() => resolve()))
})

/**
 * POST `body` to a server that runs `handle(req)` and answers with its outcome as JSON.
 *
 * The parse happens INSIDE the request handler, against the live `IncomingMessage`, because that is
 * the only place the stream is real. The outcome travels back over the wire as data.
 */
async function postThrough(
  handle: (req: IncomingMessage) => Promise<unknown>,
  body: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; value?: unknown; error?: string; ms: number }> {
  const running = createServer((req, res) => {
    void (async () => {
      let payload: Record<string, unknown>
      try {
        payload = { ok: true, value: await handle(req) }
      } catch (err) {
        payload = {
          ok: false,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        }
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    })()
  })
  server = running
  await new Promise<void>((resolve) => running.listen(0, '127.0.0.1', resolve))
  const { port } = running.address() as AddressInfo

  const started = Date.now()
  const response = await fetch(`http://127.0.0.1:${String(port)}/api/probe`, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(BUDGET_MS),
  })
  const parsed = (await response.json()) as { ok: boolean; value?: unknown; error?: string }
  return { ...parsed, ms: Date.now() - started }
}

/** Drain the request the way `incomingMessageToWebRequest` does — this is the production call. */
async function drain(req: IncomingMessage): Promise<void> {
  const stream = Readable.toWeb(req) as ReadableStream
  const reader = stream.getReader()
  for (;;) {
    const { done } = await reader.read()
    if (done) break
  }
}

const JSON_HEADERS = { 'content-type': 'application/json' }

describe('parseRequestBody — a stream consumed upstream fails by name', () => {
  it('test_a_json_body_drained_before_the_parser_runs_rejects_instead_of_hanging', async () => {
    const outcome = await postThrough(
      async (req) => {
        await drain(req)
        return await parseRequestBody(req)
      },
      JSON.stringify({ a: 1 }),
      JSON_HEADERS,
    )

    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('RequestBodyConsumedError')
    // The message has to say WHICH request lost its body — a named error with no coordinates sends
    // the reader back to the same silence it replaced.
    expect(outcome.error).toContain('POST /api/probe')
    expect(outcome.ms).toBeLessThan(BUDGET_MS)
  })

  it('test_a_multipart_body_drained_upstream_rejects_rather_than_reporting_zero_files', async () => {
    // Measured without the guard: busboy rejects with `Unexpected end of form`, which the route
    // pipeline maps to a 400. Not a hang, but a misattribution — the caller is blamed for a body
    // the framework drank. The named error moves it to the 500 it is.
    const boundary = 'tk400boundary'
    const multipart =
      `--${boundary}\r\n` +
      'content-disposition: form-data; name="who"\r\n\r\n' +
      `theokit\r\n--${boundary}--\r\n`

    const outcome = await postThrough(
      async (req) => {
        await drain(req)
        return await parseRequestBody(req)
      },
      multipart,
      { 'content-type': `multipart/form-data; boundary=${boundary}` },
    )

    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('RequestBodyConsumedError')
  })

  it('test_an_untouched_json_body_still_parses_exactly_as_before', async () => {
    // The guard reads `readableEnded`, which is false until somebody consumes the stream — even
    // when Node has already buffered every byte. This is the case that proves it does not fire on
    // an ordinary request.
    const outcome = await postThrough(
      async (req) => await parseRequestBody(req),
      JSON.stringify({ a: 1 }),
      JSON_HEADERS,
    )

    expect(outcome.ok).toBe(true)
    // `raw` joined the shape with #445: the bytes are kept so a route handler's `Request` can carry
    // a readable body. Asserted here rather than loosened away — this test exists to pin the shape
    // an ordinary request produces, and the shape genuinely changed.
    expect(outcome.value).toEqual({ fields: {}, files: [], json: { a: 1 }, raw: '{"a":1}' })
  })

  it('test_a_declared_empty_json_body_is_an_absent_body_not_an_error', async () => {
    // `content-length: 0` is the one case where an ended stream is honestly empty. An empty POST is
    // legal, and turning it into a 500 would trade one defect for a louder one.
    const outcome = await postThrough(
      async (req) => {
        await drain(req)
        return await parseRequestBody(req)
      },
      '',
      JSON_HEADERS,
    )

    expect(outcome.ok).toBe(true)
    expect(outcome.value).toEqual({ fields: {}, files: [], json: undefined })
  })

  it('test_the_error_carries_a_500_because_the_framework_drank_the_body_not_the_caller', () => {
    const err = new RequestBodyConsumedError('POST', '/api/probe')

    expect(err.status).toBe(500)
    expect(err.code).toBe('REQUEST_BODY_CONSUMED')
  })
})
