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

function jsonFetch(payload: unknown, capture?: (url: string, init: RequestInit) => void) {
  return vi.fn(async (url: string, init: RequestInit) => {
    capture?.(url, init)
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

describe('createA2ATool', () => {
  it('returns a CustomTool with the given name/description and a message input', () => {
    const tool = createA2ATool({ url: 'https://x/agents/a', name: 'ask_remote', description: 'Ask remote' })
    expect(tool.name).toBe('ask_remote')
    expect(tool.description).toBe('Ask remote')
    expect(tool.inputSchema).toMatchObject({ type: 'object' })
  })

  it('POSTs the message to the remote agent and returns its response text', async () => {
    let seenUrl = ''
    let seenBody: unknown
    const fetchImpl = jsonFetch({ response: 'remote says hi' }, (url, init) => {
      seenUrl = url
      seenBody = JSON.parse(init.body as string)
    })
    const tool = createA2ATool({ url: 'https://x/agents/a', name: 'ask', description: 'd', fetchImpl })

    const out = await tool.handler({ message: 'hello' })

    expect(seenUrl).toBe('https://x/agents/a')
    expect(seenBody).toEqual({ message: 'hello' })
    expect(out).toBe('remote says hi')
  })

  it('sends a Bearer token when auth is configured', async () => {
    let authHeader: string | null = null
    const fetchImpl = jsonFetch({ response: 'ok' }, (_url, init) => {
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
    const tool = createA2ATool({ url: 'https://x/agents/a', name: 'ask', description: 'd', fetchImpl })

    await expect(tool.handler({ message: 'hi' })).rejects.toThrow(/A2A|502/i)
  })
})
