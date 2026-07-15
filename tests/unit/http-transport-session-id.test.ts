/**
 * Regression: a TheoKit agent must keep ONE conversation across turns. The client owns a stable
 * `chatId` (per `AgentClient` instance), but `HttpTransport.sendMessages` used to build the body as
 * `{ ...input, messages }` WITHOUT it — so the server's `parseAgentRequestBody` fell back to a random
 * `crypto.randomUUID()` sessionId per request, and the SDK conversation store (plus any session-scoped
 * tool like `todolist`) reset every turn. The transcript persisted client-side (M46), masking the
 * server-side amnesia. The fix: serialize `chatId` as the top-level `id` the server reads as the session.
 * Found dogfooding the showcase agent's task decomposition across turns.
 */
import { describe, expect, it } from 'vitest'

import { HttpTransport } from '../../packages/theo/src/client/http-transport.js'

describe('HttpTransport — sends a stable session id so the server keeps one conversation across turns', () => {
  it('serializes the transport chatId as the top-level `id` in the POST body', async () => {
    let sentBody: Record<string, unknown> | undefined
    const captureFetch = (async (_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const transport = new HttpTransport({ api: '/api/agents/chat', fetch: captureFetch })
    await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'stable-session-1',
      messageId: undefined,
      messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      abortSignal: undefined,
      body: { message: 'hi' },
    })

    // The top-level `id` is what `parseAgentRequestBody` reads as the sessionId — it must be the stable chatId.
    expect(sentBody?.id).toBe('stable-session-1')
    // The typed input + messages still ride along (no regression to the existing body shape).
    expect(sentBody?.message).toBe('hi')
    expect(Array.isArray(sentBody?.messages)).toBe(true)
  })
})
