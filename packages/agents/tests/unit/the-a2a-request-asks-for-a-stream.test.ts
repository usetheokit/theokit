/**
 * The A2A request asks for the stream the served route answers with, and says it is an action.
 *
 * The HTTP transport sends `accept: text/event-stream` and `X-Theo-Action: 1` before any caller
 * header (`http-transport.ts`). The A2A tool reads the same wire, so it asks for it the same way: a
 * `mountAgent` route under its default strict CSRF mode refuses a POST whose `X-Theo-Action` is not
 * `1`. The auth header is set after the static headers, so a configured bearer wins.
 */
import { describe, expect, it, vi } from 'vitest'

import { createA2ATool } from '../../src/a2a/a2a-client.js'
import { streamAgentResponse, type StreamEvent } from '../../src/bridge/agent-sse-handler.js'

async function* okRun(): AsyncGenerator<StreamEvent> {
  yield { type: 'text_delta', content: 'ok' }
}

function capturingFetch(onHeaders: (headers: Headers) => void) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    onHeaders(new Headers(init.headers))
    return streamAgentResponse(okRun())
  })
}

describe('the A2A request asks for a stream', () => {
  it('test_the_request_asks_for_a_stream_and_carries_the_action_header', async () => {
    let seen = new Headers()
    const tool = createA2ATool({
      url: 'https://remote.example/api/agents/remote/chat',
      name: 'ask_remote',
      description: 'Ask the remote agent',
      fetchImpl: capturingFetch((h) => {
        seen = h
      }),
    })

    await tool.handler({ message: 'hi' })

    expect(seen.get('accept')).toBe('text/event-stream')
    expect(seen.get('x-theo-action')).toBe('1')
  })

  it('test_the_bearer_header_follows_the_static_headers', async () => {
    let seen = new Headers()
    const tool = createA2ATool({
      url: 'https://remote.example/api/agents/remote/chat',
      name: 'ask_remote',
      description: 'Ask the remote agent',
      headers: { authorization: 'Basic x', 'x-custom': 'v' },
      auth: { bearer: 't' },
      fetchImpl: capturingFetch((h) => {
        seen = h
      }),
    })

    await tool.handler({ message: 'hi' })

    expect(seen.get('authorization')).toBe('Bearer t')
    expect(seen.get('x-custom')).toBe('v')
  })
})
