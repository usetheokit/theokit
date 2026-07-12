/**
 * M41 (ADR-0050 D3) — integration: HttpTransport ↔ the REAL M37 durable-reconnect machinery
 * (`handleAgentRunReconnect` + `RunEventCache`). Proves the wire contract end-to-end: the transport
 * captures the server-minted `x-theokit-run-id` from the POST, then `reconnectToStream` GETs
 * `/runs/<runId>/stream`, which the real handler serves by replaying the cached frames.
 */
import { describe, expect, it } from 'vitest'
import type { UIMessageChunk } from 'ai'

import { HttpTransport } from '../../packages/theo/src/client/http-transport.js'
import {
  handleAgentRunReconnect,
  isAgentRunStreamPath,
} from '../../packages/theo/src/server/agent/handle-agent-run-reconnect.js'
import { createInMemoryRunEventCache } from '../../packages/theo/src/server/agent/run-event-cache.js'

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

describe('HttpTransport ↔ M37 reconnect (integration, M41)', () => {
  it('captures the run id from the POST and reconnect replays the real cached frames', async () => {
    const cache = createInMemoryRunEventCache()
    const RUN_ID = 'run-int-1'

    // An in-memory fetch that mirrors the framework routing: POST mounts a run (produces SSE + the
    // x-theokit-run-id header, and records the run in the cache); GET .../runs/<id>/stream is served
    // by the REAL reconnect handler over the REAL cache.
    const fetchImpl = (async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const pathname = new URL(String(url), 'http://x').pathname
      const match = isAgentRunStreamPath(pathname)
      if (match) {
        const headers = new Headers(init?.headers as HeadersInit | undefined)
        return handleAgentRunReconnect(
          match.runId,
          new Request(`http://x${pathname}`, { headers }),
          cache,
        )
      }
      // POST /api/agents/chat — record the run frames, then return the initial SSE + run-id header.
      cache.append(RUN_ID, '{"type":"start"}')
      cache.append(RUN_ID, '{"type":"text-start","id":"t0"}')
      cache.append(RUN_ID, '{"type":"text-delta","id":"t0","delta":"Hi"}')
      cache.append(RUN_ID, '{"type":"text-end","id":"t0"}')
      cache.append(RUN_ID, '{"type":"finish"}')
      cache.end(RUN_ID)
      return new Response('data: {"type":"start"}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'x-theokit-run-id': RUN_ID },
      })
    }) as unknown as typeof fetch

    const transport = new HttpTransport({ api: '/api/agents/chat', fetch: fetchImpl })

    // Initial turn — the transport captures the run id.
    await collect(
      await transport.sendMessages({
        trigger: 'submit-message',
        chatId: 'c1',
        messageId: undefined,
        messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        abortSignal: undefined,
      }),
    )

    // Reconnect — the real handler replays the cached frames for the captured run id.
    const resumed = await transport.reconnectToStream({ chatId: 'c1' })
    expect(resumed).not.toBeNull()
    const chunks = await collect(resumed!)

    // The reconnect stream carries the run's real frames (the text delta 'Hi' among them).
    expect(
      chunks.some((c) => c.type === 'text-delta' && (c as { delta: string }).delta === 'Hi'),
    ).toBe(true)
  })
})
