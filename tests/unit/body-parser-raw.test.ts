import type { IncomingMessage } from 'node:http'
import { PassThrough } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { parseRequestBody } from '../../packages/theo/src/server/body-parser.js'

/**
 * The raw bytes of a JSON body, kept rather than discarded.
 *
 * `ctx.request` reaches a route handler with no body at all — `incomingMessageToHandlerRequest`
 * builds it from method and headers, because #117 moved the parsed value onto `ctx.body`. The
 * consequence, found by wiring a real app: `handleChannelWebhook` — the framework's own
 * channel-webhook seam — calls `request.json()` and therefore answers `400 Request body must be
 * JSON` for every request, including ones whose body is valid JSON (usetheokit/theokit#445).
 *
 * The fix needs the RAW bytes, not the parsed value re-serialised. Every platform that signs a
 * webhook — Slack, Stripe, WhatsApp, Plivo — computes the HMAC over the exact bytes it sent, and
 * `JSON.stringify(JSON.parse(x))` is not `x`: key order, whitespace and number formatting all move.
 * A reconstruction from the parsed value would verify against nothing.
 */
function mockRequest(body: string, contentType = 'application/json'): IncomingMessage {
  const stream = new PassThrough() as unknown as IncomingMessage
  stream.method = 'POST'
  stream.headers = { 'content-type': contentType }
  process.nextTick(() => {
    stream.emit('data', Buffer.from(body))
    stream.emit('end')
  })
  return stream
}

describe('parseRequestBody — raw', () => {
  it('keeps the exact bytes of a JSON body', async () => {
    // Whitespace and key order chosen to differ from what JSON.stringify would emit.
    const sent = '{ "b":2,\n  "a" : 1 }'
    const parsed = await parseRequestBody(mockRequest(sent))

    expect(parsed.json).toEqual({ a: 1, b: 2 })
    expect(parsed.raw, 'the bytes a signature would be computed over').toBe(sent)
    expect(JSON.stringify(parsed.json), 'and re-serialising is NOT the same string').not.toBe(sent)
  })

  it('has no raw for a body that was never sent', async () => {
    const parsed = await parseRequestBody(mockRequest(''))
    expect(parsed.raw).toBeUndefined()
  })

  it('has no raw for multipart, where the parsed fields are the interface', async () => {
    const boundary = 'X'
    const multipart = `--${boundary}\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--${boundary}--\r\n`
    const parsed = await parseRequestBody(
      mockRequest(multipart, `multipart/form-data; boundary=${boundary}`),
    )
    expect(parsed.fields.a).toBe('1')
    expect(parsed.raw).toBeUndefined()
  })
})
