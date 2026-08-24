import { describe, it, expect } from 'vitest'

import { SSE_BASE_HEADERS } from '../../packages/theo/src/server/agent/durable-ui-message-stream-response.js'

/**
 * usetheokit/theokit#383 — the agent SSE response said nothing about buffering.
 *
 * It sent two headers, so any intermediary that buffers by default — nginx, a
 * compressing reverse proxy, a CDN edge — was free to hold the whole run and hand
 * the user one block at the end. The server streams correctly and nobody
 * downstream was told.
 *
 * `docs/program/journeys/j03-streaming.md` states the bar this failed: *"A server
 * that streams into a proxy that buffers has not satisfied this journey"*. It
 * breaks exactly where it is hardest to notice — behind someone else's proxy, in
 * production, looking correct.
 *
 * ## Why `connection: keep-alive` is NOT here
 *
 * The Vercel AI SDK sends five headers and this sends four. The missing one is
 * `connection: keep-alive`, and it is missing on measurement rather than on
 * preference.
 *
 * It is a hop-by-hop header. On HTTP/1 Node manages keep-alive itself, so it is
 * redundant; on HTTP/2 it is illegal, and Node drops it with
 *
 *     UnsupportedWarning: The provided connection header is not valid, the value
 *     will be dropped from the header and will never be in use.
 *
 * — measured against `node:http2` on Node 22.22. Sending it would buy nothing on
 * one protocol and print a warning per response on the other. The two headers
 * that carry the meaning are the ones that ship.
 */

describe('the agent SSE response tells the path not to buffer it (#383)', () => {
  const headers = SSE_BASE_HEADERS as Record<string, string>

  it('test_it_declares_the_content_type_that_makes_it_a_stream', () => {
    expect(headers['content-type']).toBe('text/event-stream')
  })

  it('test_it_asks_caches_not_to_store_the_run', () => {
    expect(headers['cache-control']).toBe('no-cache')
  })

  it('test_it_opts_out_of_nginx_buffering_by_name', () => {
    // The one header that speaks to the most common intermediary directly.
    expect(headers['x-accel-buffering']).toBe('no')
  })

  it('test_it_still_identifies_the_wire_protocol_it_mirrors', () => {
    // Unchanged, and asserted so the addition cannot displace it.
    expect(headers['x-vercel-ai-ui-message-stream']).toBe('v1')
  })

  it('test_it_does_not_send_a_hop_by_hop_header_http2_would_drop', () => {
    // Deliberate. See the header comment: measured, not assumed.
    expect(headers.connection).toBeUndefined()
  })
})
