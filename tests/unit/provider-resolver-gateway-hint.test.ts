/**
 * The refusal must name the way out the caller already has (usetheokit/theokit#554).
 *
 * A fresh `create-theokit` app given only an `OPENROUTER_API_KEY` answered 500 on its first
 * message. The generated agent declared `openai/gpt-4o-mini`, the resolver read the `openai/`
 * prefix as a hard provider selection, and the error named `OPENAI_API_KEY` — the one key the user
 * was never asked to get, while the key they DID have serves that exact model id.
 *
 * Falling back to the credentialed provider is NOT the fix, and this file asserts that it did not
 * happen. `resolveProvider` reports a key; the SDK picks the endpoint from the model id itself
 * (measured: `openai/gpt-4o-mini` resolves to `api.openai.com`, `openrouter/openai/gpt-4o-mini` to
 * `openrouter.ai`). So substituting the key would send an OpenRouter credential to OpenAI and
 * produce `401` against a provider nobody named — which is #326, the defect the declared-wins rule
 * was written for.
 *
 * What was missing is not a fallback but an ACTIONABLE refusal: the model id that would work,
 * spelled out, when a gateway holding a key is sitting in the registry.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  resetProviderAnnouncements,
  resetProviderRegistry,
  resolveProvider,
} from '../../packages/theo/src/server/agent/provider-resolver.js'

const KEYS = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const

/**
 * Unset over a FIXED allowlist. `delete process.env[dynamic]` is banned by lint for good reason —
 * a computed key is how a test clears something it did not mean to — and the switch keeps the set
 * of keys this file touches visible at the point where it touches them.
 */
function clearKey(key: (typeof KEYS)[number]): void {
  switch (key) {
    case 'OPENROUTER_API_KEY':
      delete process.env.OPENROUTER_API_KEY
      return
    case 'OPENAI_API_KEY':
      delete process.env.OPENAI_API_KEY
      return
    case 'ANTHROPIC_API_KEY':
      delete process.env.ANTHROPIC_API_KEY
  }
}

function messageOf(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    return (err as Error).message
  }
  throw new Error('expected resolveProvider to throw')
}

describe('an uncredentialed prefix names the gateway that would serve it (#554)', () => {
  let original: Record<string, string | undefined>

  beforeEach(() => {
    original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
    for (const k of KEYS) clearKey(k)
    resetProviderRegistry()
    resetProviderAnnouncements()
  })

  afterEach(() => {
    for (const k of KEYS) {
      const previous = original[k]
      if (previous === undefined) clearKey(k)
      else process.env[k] = previous
    }
    resetProviderRegistry()
    resetProviderAnnouncements()
  })

  it('spells out the gateway-prefixed model id the caller can use right now', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test'

    const message = messageOf(() => resolveProvider('openai/gpt-4o-mini'))

    expect(message).toContain('openrouter/openai/gpt-4o-mini')
    expect(message).toContain('OPENROUTER_API_KEY')
  })

  it('still refuses rather than substituting the credential it found', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test'

    // The whole point of #326: the SDK dials the endpoint the model id names, so a substituted key
    // reaches the wrong provider and 401s there.
    expect(() => resolveProvider('openai/gpt-4o-mini')).toThrow(/OPENAI_API_KEY is not set/u)
  })

  it('says nothing about a gateway when no gateway is credentialed', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'

    const message = messageOf(() => resolveProvider('openai/gpt-4o-mini'))

    // Anthropic is a provider, not a gateway — it does not serve OpenAI's catalog, so naming it
    // here would send the reader down a path that fails at the provider instead of at the resolver.
    expect(message).not.toContain('openrouter/')
    expect(message).toContain('OPENAI_API_KEY')
  })

  it('does not offer a gateway to a model the gateway already is', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'

    // `openrouter/...` with no OPENROUTER_API_KEY: suggesting `openrouter/openrouter/...` would be
    // nonsense, and there is no other gateway to offer.
    const message = messageOf(() => resolveProvider('openrouter/openai/gpt-4o-mini'))

    expect(message).not.toContain('openrouter/openrouter/')
    expect(message).toContain('OPENROUTER_API_KEY')
  })

  it('leaves the credentialed happy path exactly as it was', () => {
    process.env.OPENAI_API_KEY = 'sk-test-key-value'

    expect(resolveProvider('openai/gpt-4o-mini')).toMatchObject({
      name: 'openai',
      apiKey: 'sk-test-key-value',
    })
  })
})
