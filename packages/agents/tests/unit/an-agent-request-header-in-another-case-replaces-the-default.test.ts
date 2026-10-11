/**
 * Both clients of an agent route send the same request headers for the same overrides.
 *
 * `HttpTransport` and `createA2ATool` POST to the same route and must pass the same strict CSRF
 * gate. A caller header that differs from a default only in letter case is the same HTTP header,
 * so it replaces the default. Spread into a plain object, the two spellings are two keys, and
 * `fetch` sends the joined value `1, 0`, which the gate reads as neither (review finding F-arch-1).
 */
import { describe, expect, it, vi } from 'vitest'

import { createA2ATool } from '../../src/a2a/a2a-client.js'
import { streamAgentResponse, type StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import { HttpTransport } from '../../src/client/http-transport.js'

async function* okRun(): AsyncGenerator<StreamEvent> {
  yield { type: 'text_delta', content: 'ok' }
}

/** A fetch that records the headers of every call and answers like a served agent route. */
function recordingFetch() {
  const seen: Headers[] = []
  const impl = vi.fn(async (_url: string, init: RequestInit) => {
    seen.push(new Headers(init.headers))
    return streamAgentResponse(okRun())
  })
  return { impl, seen }
}

const SEND = {
  trigger: 'submit-message' as const,
  chatId: 'c1',
  messageId: undefined,
  messages: [{ id: 'u1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'hi' }] }],
  abortSignal: undefined,
}

const OVERRIDES = { 'x-theo-action': '0', Accept: 'application/json' }

describe('agent request headers', () => {
  it('test_a_transport_header_in_another_case_replaces_the_default', async () => {
    const { impl, seen } = recordingFetch()
    const transport = new HttpTransport({
      api: '/api/agents/chat',
      headers: { 'x-theo-action': '0' },
      fetch: impl as unknown as typeof fetch,
    })

    await transport.sendMessages(SEND)

    expect(seen[0]?.get('x-theo-action')).toBe('0')
  })

  it('test_an_approve_header_in_another_case_replaces_the_default', async () => {
    const impl = vi.fn(async (_url: string, _init: RequestInit) => new Response(null))
    const transport = new HttpTransport({
      api: '/api/agents/chat',
      headers: { 'x-theo-action': '0' },
      fetch: impl as unknown as typeof fetch,
    })

    await transport.approve('a1', { approved: true })

    expect(new Headers(impl.mock.calls[0]?.[1].headers).get('x-theo-action')).toBe('0')
  })

  it('test_both_clients_send_the_same_headers_for_the_same_overrides', async () => {
    const viaTransport = recordingFetch()
    await new HttpTransport({
      api: '/api/agents/chat',
      headers: OVERRIDES,
      fetch: viaTransport.impl as unknown as typeof fetch,
    }).sendMessages(SEND)
    const viaTool = recordingFetch()
    await createA2ATool({
      url: '/api/agents/chat',
      name: 'ask',
      description: 'd',
      headers: OVERRIDES,
      fetchImpl: viaTool.impl,
    }).handler({ message: 'hi' })

    expect([...(viaTransport.seen[0] ?? new Headers()).entries()]).toEqual([
      ...(viaTool.seen[0] ?? new Headers()).entries(),
    ])
  })
})
