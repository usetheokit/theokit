/**
 * M43 (ADR-0052) — request-context / auth parity across every transport. A `context` on `AgentClient`
 * threads `headers` → HTTP request headers and `metadata` → the in-process runner arg / the channel
 * `start` arg, resolved per request (never stale). Back-compat: no context → today's behavior.
 */
import { describe, expect, it, vi } from 'vitest'
import type { UIMessageChunk } from 'ai'

import { AgentClient } from '../../packages/theo/src/client/agent-client.js'
import {
  ChannelTransport,
  type ChannelPushSource,
} from '../../packages/theo/src/client/channel-transport.js'
import { HttpTransport } from '../../packages/theo/src/client/http-transport.js'
import {
  InProcessTransport,
  type InProcessRunInput,
} from '../../packages/theo/src/client/in-process-transport.js'
import type { RequestContext } from '../../packages/theo/src/client/transport.js'

function sseResponse(
  chunks: Array<Record<string, unknown>>,
  headers: Record<string, string> = {},
): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  })
}

const DONE = [{ type: 'start' }, { type: 'finish' }]

async function waitSettled(client: AgentClient): Promise<void> {
  await new Promise<void>((resolve) => {
    const unsub = client.subscribe(() => {
      if (client.getSnapshot().status !== 'streaming') {
        unsub()
        resolve()
      }
    })
  })
}

describe('request-context parity (M43)', () => {
  it('test_context_headers_reach_http_transport_fetch', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(DONE)) as unknown as typeof fetch
    const transport = new HttpTransport({ api: '/api/agents/chat', fetch: fetchImpl })
    const context: RequestContext = { headers: { Authorization: 'Bearer tok-1' } }
    const client = new AgentClient(transport, () => context)

    client.send({ message: 'hi' })
    await waitSettled(client)

    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(init.headers.Authorization).toBe('Bearer tok-1')
    // metadata must NOT leak into the HTTP body (it is the in-process/channel channel, not HTTP).
    expect(init.body).not.toContain('metadata')
  })

  it('test_context_headers_reach_http_transport_on_reconnect', async () => {
    // Symmetric with send: context headers must reach the reconnect GET too, resolved fresh.
    let token = 'tok-1'
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/runs/')
        ? sseResponse(DONE)
        : sseResponse(DONE, { 'x-theokit-run-id': 'run-r1' }),
    ) as unknown as typeof fetch
    const client = new AgentClient(
      new HttpTransport({ api: '/api/agents/chat', fetch: fetchImpl }),
      () => ({ headers: { Authorization: `Bearer ${token}` } }),
    )

    client.send({ message: 'hi' }) // captures the run id
    await waitSettled(client)
    token = 'tok-2' // rotate before reconnect
    client.reconnect()
    await waitSettled(client)

    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>
    const reconnectCall = mock.mock.calls.find((c) => String(c[0]).includes('/runs/'))
    expect(reconnectCall).toBeDefined()
    expect(reconnectCall?.[1].headers.Authorization).toBe('Bearer tok-2')
  })

  it('test_context_metadata_reaches_in_process_runner', async () => {
    let seenContext: unknown
    const run = (input: InProcessRunInput): AsyncGenerator<UIMessageChunk> =>
      (async function* () {
        seenContext = input.context
        yield { type: 'finish' } as UIMessageChunk
      })()
    const client = new AgentClient(new InProcessTransport({ run }), () => ({
      metadata: { tenant: 'acme', provider: 'openrouter' },
    }))
    client.send({ message: 'hi' })
    await waitSettled(client)
    expect(seenContext).toEqual({ tenant: 'acme', provider: 'openrouter' })
  })

  it('test_context_metadata_reaches_channel_start', async () => {
    let seenContext: unknown
    const source: ChannelPushSource = {
      start(turn, handlers) {
        seenContext = turn.context
        handlers.onClose()
        return () => undefined
      },
    }
    const client = new AgentClient(new ChannelTransport({ source }), () => ({
      metadata: { region: 'eu' },
    }))
    client.send({ message: 'hi' })
    await waitSettled(client)
    expect(seenContext).toEqual({ region: 'eu' })
  })

  it('test_context_resolver_is_evaluated_per_request_never_stale', async () => {
    let token = 'tok-1'
    const fetchImpl = vi.fn(async () => sseResponse(DONE)) as unknown as typeof fetch
    const client = new AgentClient(
      new HttpTransport({ api: '/api/agents/chat', fetch: fetchImpl }),
      () => ({ headers: { Authorization: `Bearer ${token}` } }),
    )

    client.send({ message: '1' })
    await waitSettled(client)
    token = 'tok-2' // rotate between requests
    client.send({ message: '2' })
    await waitSettled(client)

    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>
    expect(mock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-1')
    expect(mock.mock.calls[1][1].headers.Authorization).toBe('Bearer tok-2')
  })

  it('test_no_context_is_backward_compatible', async () => {
    // Without a context resolver, sendMessages carries no headers/metadata — today's behavior.
    let seenContext: unknown = 'unset'
    const run = (input: InProcessRunInput): AsyncGenerator<UIMessageChunk> =>
      (async function* () {
        seenContext = input.context
        yield { type: 'finish' } as UIMessageChunk
      })()
    const client = new AgentClient(new InProcessTransport({ run })) // no resolver
    client.send({ message: 'hi' })
    await waitSettled(client)
    expect(seenContext).toBeUndefined()
  })
})
