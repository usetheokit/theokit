import { describe, expect, it } from 'vitest'

import { routedProviderOf } from '../live/routed-provider.js'

/**
 * The live prompt-caching test cannot tell an OpenRouter routing miss from a missing cache
 * directive unless it knows which upstream served each turn (B-523). The SDK drops that field, so
 * the live test reads it from the raw chat-completions stream through these helpers. One
 * `describe` per helper (plan D3).
 */
describe('routedProviderOf', () => {
  it('returns the provider of the first chunk that carries one', () => {
    const stream =
      'data: {"id":"g1","choices":[]}\n\n' +
      'data: {"id":"g1","provider":"Anthropic","choices":[]}\n\n' +
      'data: {"id":"g1","provider":"Google","choices":[]}\n\n'
    expect(routedProviderOf(stream)).toBe('Anthropic')
  })

  it('skips a comment line, a [DONE] line and a truncated JSON line before the provider', () => {
    const stream =
      ': OPENROUTER PROCESSING\n\n' +
      'data: [DONE]\n\n' +
      'data: {"id":"g1","provid\n\n' +
      'data: {"id":"g1","provider":"Amazon Bedrock","choices":[]}\n\n'
    expect(routedProviderOf(stream)).toBe('Amazon Bedrock')
  })

  it('returns undefined when no chunk carries a provider', () => {
    const stream = 'data: {"id":"g1","choices":[]}\n\ndata: [DONE]\n'
    expect(routedProviderOf(stream)).toBeUndefined()
    expect(routedProviderOf('')).toBeUndefined()
  })

  it('does not return a provider that is an empty string or not a string', () => {
    const stream =
      'data: {"provider":""}\n\n' +
      'data: {"provider":42}\n\n' +
      'data: {"provider":null}\n\n' +
      'data: "provider"\n\n'
    expect(routedProviderOf(stream)).toBeUndefined()
  })

  it('reads the provider from a stream with CRLF line endings', () => {
    const stream = 'data: {"id":"g1"}\r\n\r\ndata: {"provider":"Anthropic"}\r\n\r\ndata: [DONE]\r\n'
    expect(routedProviderOf(stream)).toBe('Anthropic')
  })

  it('reads a data line with no space after the colon', () => {
    expect(routedProviderOf('data:{"provider":"Google"}\n')).toBe('Google')
  })
})
