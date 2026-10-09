/**
 * M15 (theokit-ai-first) — A2A client: call a remote A2A agent as a tool.
 *
 * `createA2ATool({ url, name, description })` returns a `CustomTool` whose handler POSTs the input
 * to a remote agent's HTTP endpoint, which answers with a UIMessage event stream, and returns the
 * text of the streamed assistant message — so a supervisor can delegate to an agent on another
 * system. Uses `fetch` (Web Standards, G8); the URL is a remote AGENT, not an
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
  it('test_the_tool_carries_its_name_description_and_a_message_input', () => {
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask_remote',
      description: 'Ask remote',
    })
    expect(tool.name).toBe('ask_remote')
    expect(tool.description).toBe('Ask remote')
    expect(tool.inputSchema).toMatchObject({ type: 'object' })
  })

  it('test_a_call_returns_the_remote_reply_to_the_posted_message', async () => {
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

  it('test_a_configured_bearer_token_is_sent', async () => {
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

  it('test_a_non_2xx_answer_rejects_naming_the_tool_and_the_status', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 502 }))
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      fetchImpl,
    })

    await expect(tool.handler({ message: 'hi' })).rejects.toThrow('A2A call to "ask" failed: 502')
  })

  it('test_a_non_2xx_answer_releases_its_body', async () => {
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled })
    const fetchImpl = vi.fn(async () => new Response(body, { status: 403 }))
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      fetchImpl,
    })

    await expect(tool.handler({ message: 'hi' })).rejects.toThrow('A2A call to "ask" failed: 403')
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('test_a_static_action_header_in_another_case_replaces_the_default', async () => {
    let action: string | null = null
    const fetchImpl = sseFetch('ok', (_url, init) => {
      action = new Headers(init.headers).get('x-theo-action')
    })
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      headers: { 'X-Theo-Action': '0' },
      fetchImpl,
    })

    await tool.handler({ message: 'hi' })

    expect(action).toBe('0')
  })

  it('test_two_concurrent_calls_each_return_their_own_reply', async () => {
    // The first call's stream stays open, its text already read, until the second call has
    // finished. A snapshot shared between calls would then hand the first call the second's reply.
    const frames = (text: string): string =>
      [
        { type: 'start' },
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: text },
        { type: 'text-end', id: 't' },
      ]
        .map((f) => `data: ${JSON.stringify(f)}\n\n`)
        .join('')
    const finish = 'data: {"type":"finish"}\n\n'
    const encoder = new TextEncoder()
    let releaseAlpha: () => void = () => undefined
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const { message } = JSON.parse(init.body as string) as { message: string }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (message === 'b') {
            controller.enqueue(encoder.encode(frames('beta') + finish))
            controller.close()
            return
          }
          controller.enqueue(encoder.encode(frames('alpha')))
          releaseAlpha = () => {
            controller.enqueue(encoder.encode(finish))
            controller.close()
          }
        },
      })
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    })
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      fetchImpl,
    })

    const alpha = Promise.resolve(tool.handler({ message: 'a' }))
    // Let the first call read its buffered text before the second starts. The wait only orders
    // in-memory reads; if it were too short the test could miss the defect, never fail falsely.
    await new Promise((resolve) => setTimeout(resolve, 20))
    const beta = await tool.handler({ message: 'b' })
    releaseAlpha()

    expect([await alpha, beta]).toEqual(['alpha', 'beta'])
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

  it('test_text_parts_on_either_side_of_a_tool_call_are_joined_by_a_newline', async () => {
    const frames = [
      { type: 'start' },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Let me check.' },
      { type: 'text-end', id: 't1' },
      { type: 'tool-input-available', toolCallId: 'c1', toolName: 'calc', input: {} },
      { type: 'tool-output-available', toolCallId: 'c1', output: 4 },
      { type: 'text-start', id: 't2' },
      { type: 'text-delta', id: 't2', delta: 'The answer is 4' },
      { type: 'text-end', id: 't2' },
      { type: 'finish' },
    ]
    const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
    const fetchImpl = vi.fn(
      async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    )
    const tool = createA2ATool({
      url: 'https://x/agents/a',
      name: 'ask',
      description: 'd',
      fetchImpl,
    })

    expect(await tool.handler({ message: 'hi' })).toBe('Let me check.\nThe answer is 4')
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
