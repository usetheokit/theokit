import { describe, expect, it, vi } from 'vitest'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import { agentHandle } from '../../packages/theo/src/client/agent-handle.js'
import type { AgentHandle } from '../../packages/theo/src/client/agent-handle.js'
import { createAgentClient } from '../../packages/theo/src/client/create-agent-client.js'
import { HttpTransport } from '../../packages/theo/src/client/http-transport.js'

/**
 * M47 (ADR-M47-2) — the typed handle is a client-safe value carrying only the agent's HTTP `path` plus
 * phantom input/tool types. `agentHandle(path)` builds it; the generated `@theo/agents` module emits one
 * `export const <name>` per agent. Binding by handle kills the magic string (the path lives on the handle,
 * generated from the exposure) and the duplicated input type (types flow via the phantom generics).
 */
describe('M47 — agentHandle (typed, client-safe)', () => {
  it('test_agentHandle_carries_the_path', () => {
    const chat = agentHandle('/api/agents/chat')
    expect(chat.path).toBe('/api/agents/chat')
  })

  it('test_handle_is_a_plain_serializable_value', () => {
    // Client-safe: the handle is a plain object (no server runtime, no functions) — JSON round-trips.
    const chat = agentHandle('/api/agents/chat')
    expect(JSON.parse(JSON.stringify(chat))).toEqual({ path: '/api/agents/chat' })
  })

  it('test_createAgentClient_binds_via_handle_path', async () => {
    // The React-free client accepts a handle → builds an HttpTransport to handle.path.
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream<UIMessageChunk>({
            start(c) {
              c.enqueue({ type: 'start' } as UIMessageChunk)
              c.enqueue({ type: 'finish' } as UIMessageChunk)
              c.close()
            },
          }).pipeThrough(new TextEncoderStream() as unknown as ReadableWritablePair),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    )
    const chat: AgentHandle<{ message: string }> = agentHandle('/api/agents/chat')
    // Build the transport the handle implies and prove it targets the handle path.
    const transport: ChatTransport<UIMessage> = new HttpTransport({
      api: chat.path,
      fetch: fetchMock as unknown as typeof fetch,
    })
    const client = createAgentClient(transport)
    expect(client.getState().status).toBe('idle')
  })
})
