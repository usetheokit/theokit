/**
 * M41 (ADR-0050 D3) — HttpTransport: `ChatTransport` over the web agent path. Byte-identical wire to
 * the pre-M41 `useAgent` fetch (POST + `X-Theo-Action` + UIMessageStream SSE), plus M37 reconnect
 * (`GET <api>/runs/<runId>/stream`, 404 → null) and out-of-band approve (`POST <api>/approve/<id>`).
 */
import { describe, expect, it, vi } from 'vitest'
import type { UIMessage, UIMessageChunk } from 'ai'

import { HttpTransport } from '../../packages/theo/src/client/http-transport.js'

/** Build a fake UIMessageStream SSE Response from chunks (+ optional headers, e.g. x-theokit-run-id). */
function sseResponse(
  chunks: Array<Record<string, unknown>>,
  headers: Record<string, string> = {},
): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'x-vercel-ai-ui-message-stream': 'v1',
      ...headers,
    },
  })
}

async function collect(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = []
  const reader = stream.getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    out.push(value)
  }
  return out
}

const USER: UIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }
const sendOpts = (abortSignal?: AbortSignal) => ({
  trigger: 'submit-message' as const,
  chatId: 'c1',
  messageId: undefined,
  messages: [USER],
  abortSignal,
})

describe('HttpTransport (M41)', () => {
  it('test_sendMessages_yields_uimessagechunks_from_sse', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        { type: 'start' },
        { type: 'text-start', id: 't0' },
        { type: 'text-delta', id: 't0', delta: 'hello' },
        { type: 'text-end', id: 't0' },
        { type: 'finish' },
      ]),
    ) as unknown as typeof fetch

    const transport = new HttpTransport({ api: '/api/agents/chat', fetch: fetchImpl })
    const stream = await transport.sendMessages(sendOpts())
    const chunks = await collect(stream)

    // The returned stream is the parsed UIMessageChunk stream (the [DONE] sentinel is filtered out).
    expect(
      chunks.some((c) => c.type === 'text-delta' && (c as { delta: string }).delta === 'hello'),
    ).toBe(true)
  })

  it('test_sendMessages_posts_with_csrf_header_and_messages_body', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([{ type: 'start' }, { type: 'finish' }]),
    ) as unknown as typeof fetch
    const transport = new HttpTransport({ api: '/api/agents/chat', fetch: fetchImpl })
    await collect(await transport.sendMessages(sendOpts()))

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/agents/chat')
    expect(init.method).toBe('POST')
    expect(init.headers['X-Theo-Action']).toBe('1')
    expect(init.headers.accept).toBe('text/event-stream')
    expect(JSON.parse(init.body).messages).toHaveLength(1)
  })

  it('test_reconnect_uses_captured_run_id', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('/runs/')) return sseResponse([{ type: 'start' }, { type: 'finish' }])
      return sseResponse([{ type: 'start' }, { type: 'finish' }], { 'x-theokit-run-id': 'run-abc' })
    }) as unknown as typeof fetch

    const transport = new HttpTransport({ api: '/api/agents/chat', fetch: fetchImpl })
    await collect(await transport.sendMessages(sendOpts()))
    const reconnected = await transport.reconnectToStream({ chatId: 'c1' })

    expect(reconnected).not.toBeNull()
    expect(calls[1]).toBe('/api/agents/chat/runs/run-abc/stream')
  })

  it('test_reconnect_returns_null_when_no_prior_run', async () => {
    const transport = new HttpTransport({
      api: '/api/agents/chat',
      fetch: (async () => new Response(null)) as unknown as typeof fetch,
    })
    expect(await transport.reconnectToStream({ chatId: 'c1' })).toBeNull()
  })

  it('test_reconnect_returns_null_on_404', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/runs/'))
        return new Response(JSON.stringify({ error: { code: 'RUN_NOT_FOUND' } }), { status: 404 })
      return sseResponse([{ type: 'start' }, { type: 'finish' }], { 'x-theokit-run-id': 'run-x' })
    }) as unknown as typeof fetch
    const transport = new HttpTransport({ api: '/api/agents/chat', fetch: fetchImpl })
    await collect(await transport.sendMessages(sendOpts()))
    expect(await transport.reconnectToStream({ chatId: 'c1' })).toBeNull()
  })

  it('test_sendMessages_5xx_surfaces_error', async () => {
    const fetchImpl = (async () =>
      new Response('boom', { status: 500, statusText: 'Server Error' })) as unknown as typeof fetch
    const transport = new HttpTransport({ api: '/api/agents/chat', fetch: fetchImpl })
    await expect(transport.sendMessages(sendOpts())).rejects.toThrow(/failed: 500/)
  })

  it('test_approve_posts_to_approve_endpoint_with_csrf', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ resolved: true }), { status: 200 }),
    ) as unknown as typeof fetch
    const transport = new HttpTransport({ api: '/api/agents/chat', fetch: fetchImpl })
    await transport.approve('appr-1', { approved: true })

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/agents/chat/approve/appr-1')
    expect(init.method).toBe('POST')
    expect(init.headers['X-Theo-Action']).toBe('1')
    expect(JSON.parse(init.body)).toEqual({ approved: true })
  })

  it('test_sendMessages_resolves_dynamic_headers_per_request', async () => {
    // HIGH #1 — a headers resolver is evaluated on EVERY request, so a rotating token is never stale.
    let token = 'tok-1'
    const fetchImpl = vi.fn(async () =>
      sseResponse([{ type: 'start' }, { type: 'finish' }]),
    ) as unknown as typeof fetch
    const transport = new HttpTransport({
      api: '/api/agents/chat',
      headers: () => ({ Authorization: token }),
      fetch: fetchImpl,
    })

    await collect(await transport.sendMessages(sendOpts()))
    token = 'tok-2' // rotate between requests
    await collect(await transport.sendMessages(sendOpts()))

    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>
    expect(mock.mock.calls[0][1].headers.Authorization).toBe('tok-1')
    expect(mock.mock.calls[1][1].headers.Authorization).toBe('tok-2')
  })

  it('test_sendMessages_string_input_body_has_no_char_indexed_keys', async () => {
    // MEDIUM #5 — a primitive body must NOT be spread (that would emit {"0":"h","1":"i",…}).
    const fetchImpl = vi.fn(async () =>
      sseResponse([{ type: 'start' }, { type: 'finish' }]),
    ) as unknown as typeof fetch
    const transport = new HttpTransport({ api: '/api/agents/chat', fetch: fetchImpl })
    // A primitive body should never reach here (AgentClient guards it), but the transport is defensive.
    await collect(
      await transport.sendMessages({ ...sendOpts(), body: 'hello' as unknown as object }),
    )

    const body = JSON.parse(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    )
    expect(body).toEqual({
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    })
    expect(Object.keys(body)).not.toContain('0')
  })

  it('test_approve_404_throws', async () => {
    const fetchImpl = (async () =>
      new Response('{}', { status: 404, statusText: 'Not Found' })) as unknown as typeof fetch
    const transport = new HttpTransport({ api: '/api/agents/chat', fetch: fetchImpl })
    await expect(transport.approve('missing', { approved: false })).rejects.toThrow(
      /Approve missing failed: 404/,
    )
  })
})
