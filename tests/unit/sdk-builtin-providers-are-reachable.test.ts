/**
 * A provider the AGENT DECLARED through a model-provider plugin resolves (#579).
 *
 * ## The measurement
 *
 * Reported from an app that called `.plugins(Provider.builtins())` — 44 providers, `openai-chatgpt`
 * among them — and then `.model('openai-chatgpt/gpt-5.4')`. It answered 500:
 *
 *     Model "openai-chatgpt/gpt-5.4" declares provider "openai-chatgpt", which is not registered.
 *     Registered providers: openrouter, openai, anthropic, ollama.
 *
 * The resolver consulted only this project's four-entry literal, and `registerProvider` is called
 * nowhere in the product — so "registered" meant that literal and nothing else, while the app had
 * plainly named the provider one line earlier.
 *
 * ## Why this reads the agent's plugins and not the SDK's catalogue
 *
 * The first version of this fix asked `Provider.forModel`, the SDK's global builtin lookup. The
 * suite refused it within one run, and was right to: `unregistered-prefix-is-refused-not-rerouted`
 * uses THIS EXACT MODEL ID as its example of a prefix that must be refused (#503), because a turn
 * must never succeed against a provider nobody named. A global catalogue makes all 44 builtins
 * nameable by every app — the same permissiveness #503 forbids, one level further down.
 *
 * `.plugins(Provider.builtins())` is the naming. So the two issues do not conflict; they meet at
 * "who declared it". An app that declared nothing still gets the refusal, and #503's test passes
 * unchanged.
 */
import { describe, expect, it } from 'vitest'

import { resolveProvider } from '../../packages/theo/src/server/agent/provider-resolver.js'

/** The shape `Provider.builtins()` returns, structurally — the SDK is an optional peer here. */
const codexPlugin = {
  name: 'openai-chatgpt',
  version: '1.0.0',
  kind: 'model-provider',
  profile: {
    name: 'openai-chatgpt',
    envVars: [] as string[],
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    authType: 'oauth_device_code',
  },
}

describe('a declared model-provider plugin makes its prefix resolvable (#579)', () => {
  it('resolves a model whose provider only the agent declared', () => {
    const resolved = resolveProvider('openai-chatgpt/gpt-5.4', { plugins: [codexPlugin] })

    expect(resolved.name).toBe('openai-chatgpt')
    expect(resolved.baseUrl).toBe('https://chatgpt.com/backend-api/codex')
  })

  it('needs no env var for a provider that does not authenticate by one', () => {
    // Codex is OAuth, refreshed per request inside the profile's own `transform.fetch`, so
    // `envVars` is empty. Demanding a key would refuse it one line after "not registered" stopped
    // doing so. `'local'` is the SDK's own keyless sentinel — the `ollama` class from #407.
    expect(resolveProvider('openai-chatgpt/gpt-5.4', { plugins: [codexPlugin] }).apiKey).toBe(
      'local',
    )
  })

  it('STILL refuses the same prefix when the agent declared nothing (#503 intact)', () => {
    // The load-bearing negative, and the one the suite caught me on. Without it, "ask elsewhere"
    // degrades into "accept anything" and a turn goes to a provider nobody named.
    expect(() => resolveProvider('openai-chatgpt/gpt-5.4')).toThrow(/not registered/u)
    expect(() => resolveProvider('openai-chatgpt/gpt-5.4', { plugins: [] })).toThrow(
      /not registered/u,
    )
  })

  it('refuses a prefix no declared plugin serves', () => {
    // Declaring one provider does not make every prefix resolvable.
    expect(() => resolveProvider('not-a-provider/x', { plugins: [codexPlugin] })).toThrow(
      /not registered/u,
    )
  })

  it('ignores a declared plugin that is not a model provider', () => {
    // `.plugins()` also carries `kind: 'general'` and `kind: 'memory'` plugins. Reading a profile
    // off one of those would resolve a provider out of an object that never described one.
    const general = { name: 'x', version: '1.0.0', kind: 'general', register: () => {} }

    expect(() => resolveProvider('x/model', { plugins: [general] })).toThrow(/not registered/u)
  })

  it('leaves a registered prefix on the registry path, with the registry base URL', () => {
    // A declared plugin must not override what this project declares. The `baseUrl` is what tells
    // the two sources apart: the SDK's `openrouter` builtin points at `https://openrouter.ai/api`,
    // this project's entry at `/api/v1`. A first version asserted only the name and the key, and a
    // reversed lookup order passed — caught by mutation, not by review.
    const previous = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = 'sk-test'
    try {
      const shadow = {
        name: 'openrouter',
        version: '1.0.0',
        kind: 'model-provider',
        profile: {
          name: 'openrouter',
          envVars: ['OPENROUTER_API_KEY'],
          baseUrl: 'https://openrouter.ai/api',
        },
      }
      const resolved = resolveProvider('openrouter/openai/gpt-4o-mini', { plugins: [shadow] })

      expect(resolved.name).toBe('openrouter')
      expect(resolved.apiKey).toBe('sk-test')
      expect(resolved.baseUrl).toBe('https://openrouter.ai/api/v1')
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = previous
    }
  })
})
