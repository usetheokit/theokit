/**
 * M15 (theokit-ai-first) — A2A client: call a remote A2A agent as a tool.
 *
 * `createA2ATool({ url, name, description })` returns a `CustomTool` whose handler POSTs the input
 * to a remote agent's HTTP endpoint and returns its text response — so a supervisor can delegate to
 * an agent on another system. Uses `fetch` (Web Standards, G8); the URL is a remote AGENT, not an
 * LLM provider (G2 unaffected). `fetch` is injectable for tests.
 *
 * TDD RED-first.
 */
import { describe, expect, it, vi } from 'vitest'

import { createA2ATool } from '../../src/a2a/a2a-client.js'
import { streamAgentResponse, type StreamEvent } from '../../src/bridge/agent-sse-handler.js'

async function* textRun(text: string): AsyncGenerator<StreamEvent> {
  if (text.length > 0) yield { type: 'text_delta', content: text }
}

/** A fake remote that answers the way a served agent route does: a UIMessage event stream. */
function sseFetch(text: string, capture?: (url: string, init: RequestInit) => void) {
  return vi.fn(async (url: string, init: RequestInit) => {
    capture?.(url, init)
    return streamAgentResponse(textRun(text))
  })
}

describe('createA2ATool', () => {
  it('returns a CustomTool with the given name/description and a message input', () => {
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask_remote',
      description: 'Ask remote',
    })
    expect(tool.name).toBe('ask_remote')
    expect(tool.description).toBe('Ask remote')
    expect(tool.inputSchema).toMatchObject({ type: 'object' })
  })

  it('POSTs the message to the remote agent and returns its response text', async () => {
    let seenUrl = ''
    let seenBody: unknown
    const fetchImpl = sseFetch('remote says hi', (url, init) => {
      seenUrl = url
      seenBody = JSON.parse(init.body as string)
    })
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      fetchImpl,
    })

    const out = await tool.handler({ message: 'hello' })

    expect(seenUrl).toBe('https://x/agents/a')
    expect(seenBody).toEqual({ message: 'hello' })
    expect(out).toBe('remote says hi')
  })

  it('sends a Bearer token when auth is configured', async () => {
    let authHeader: string | null = null
    const fetchImpl = sseFetch('ok', (_url, init) => {
      authHeader = new Headers(init.headers).get('authorization')
    })
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      auth: { bearer: 'secret-token' },
      fetchImpl,
    })

    await tool.handler({ message: 'hi' })
    expect(authHeader).toBe('Bearer secret-token')
  })

  it('throws a typed error when the remote returns a non-2xx status', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 502 }))
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      fetchImpl,
    })

    await expect(tool.handler({ message: 'hi' })).rejects.toThrow('A2A call to "ask" failed: 502')
  })

  it('test_two_concurrent_calls_each_return_their_own_reply', async () => {
    const replies: Record<string, string> = { a: 'alpha', b: 'beta' }
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const { message } = JSON.parse(init.body as string) as { message: string }
      return streamAgentResponse(textRun(replies[message] ?? ''))
    })
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      fetchImpl,
    })

    const results = await Promise.all([
      tool.handler({ message: 'a' }),
      tool.handler({ message: 'b' }),
    ])

    expect(results).toEqual(['alpha', 'beta'])
  })

  it('test_a_finished_stream_with_no_text_returns_empty', async () => {
    const fetchImpl = vi.fn(async () =>
      streamAgentResponse(
        (async function* (): AsyncGenerator<StreamEvent> {
          yield {
            type: 'done',
            result: '',
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          }
        })(),
      ),
    )
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      fetchImpl,
    })

    expect(await tool.handler({ message: 'hi' })).toBe('')
  })

  it('test_a_json_answer_rejects_naming_the_content_type', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ response: 'x' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      fetchImpl,
    })

    await expect(tool.handler({ message: 'hi' })).rejects.toThrow(
      /ask.*0 chunks.*application\/json/,
    )
  })

  it('test_an_empty_200_rejects_naming_zero_chunks', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }))
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      fetchImpl,
    })

    await expect(tool.handler({ message: 'hi' })).rejects.toThrow(/ask.*0 chunks/)
  })
})
