import { describe, expect, it, vi } from 'vitest'

import {
  capBody,
  capOpenRouterOutput,
  MAX_OUTPUT_TOKENS,
} from '../../scripts/live-openrouter-cap.mjs'

function target() {
  const fetch = vi.fn(async () => new Response('{}'))
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls: fetch }
}

describe('the live OpenRouter output cap', () => {
  it('adds max_tokens to a chat-completions body that has none', () => {
    const out = JSON.parse(capBody(JSON.stringify({ model: 'm' })))
    expect(out).toEqual({ model: 'm', max_tokens: MAX_OUTPUT_TOKENS })
  })

  it('keeps a limit the request already carries', () => {
    const a = JSON.stringify({ max_tokens: 5 })
    const b = JSON.stringify({ max_completion_tokens: 7 })
    expect(capBody(a)).toBe(a)
    expect(capBody(b)).toBe(b)
  })

  it('leaves a body that is not a JSON object alone', () => {
    expect(capBody('nope')).toBe('nope')
    expect(capBody('[1]')).toBe('[1]')
  })

  it('rewrites chat-completions requests only', async () => {
    const t = target()
    const original = t.fetch
    const restore = capOpenRouterOutput(t)
    await t.fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: '{"a":1}',
    })
    await t.fetch('https://openrouter.ai/api/v1/models', { method: 'POST', body: '{"a":1}' })
    const [chat, other] = t.calls.mock.calls as unknown as [string, RequestInit][][]
    expect(
      JSON.parse((chat as unknown as [string, RequestInit])[1].body as string).max_tokens,
    ).toBe(MAX_OUTPUT_TOKENS)
    expect((other as unknown as [string, RequestInit])[1].body).toBe('{"a":1}')
    restore()
    expect(t.fetch).toBe(original)
  })
})
