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

describe('a provider whose catalog says it needs no credential resolves keyless (#585)', () => {
  /**
   * The defect #579 shipped, found by a consumer within an hour of the release.
   *
   * The profile is the SDK's own, verbatim — and it declares BOTH:
   *
   *     { name: 'lmstudio', envVars: ['LMSTUDIO_API_KEY'], authType: 'none' }
   *
   * `#579` derived `envKey` from `envVars[0]` whenever the array was non-empty, treating "an env var
   * is named" as "a credential is required". Those are different claims, and `authType` is the one
   * that answers the second. The result was an error telling the reader to set a variable with
   * nothing behind it — `LMSTUDIO_API_KEY=anything` satisfied it, because there is nothing to
   * authenticate against. A gate on presence, not on access.
   *
   * Three of the SDK's 45 builtins are in this class: `ollama`, `lmstudio`, `llamacpp`. `ollama`
   * escaped only because this project's own registry entry wins before the plugin path is reached,
   * which is exactly why #407's keyless handling did not cover the other two — it was written for a
   * registry of four, and #579 opened forty-five.
   */
  const lmstudio = {
    name: 'lmstudio',
    version: '1.0.0',
    kind: 'model-provider',
    profile: {
      name: 'lmstudio',
      envVars: ['LMSTUDIO_API_KEY'],
      authType: 'none',
      baseUrl: 'http://localhost:1234/v1',
    },
  }

  it('resolves without the env var the profile names', () => {
    const previous = process.env.LMSTUDIO_API_KEY
    delete process.env.LMSTUDIO_API_KEY
    try {
      const resolved = resolveProvider('lmstudio/qwen', { plugins: [lmstudio] })

      expect(resolved.name).toBe('lmstudio')
      expect(resolved.apiKey).toBe('local')
    } finally {
      if (previous !== undefined) process.env.LMSTUDIO_API_KEY = previous
    }
  })

  it('still demands the key for a profile that authenticates by one', () => {
    // The load-bearing negative. Reading `authType` must not degrade into "never require a key" —
    // that would send a turn to a paid endpoint with no credential and a 401 nobody can attribute,
    // which is the failure #326 and #554 are about.
    const paid = {
      name: 'anthropic-direct',
      version: '1.0.0',
      kind: 'model-provider',
      profile: {
        name: 'anthropic-direct',
        envVars: ['ANTHROPIC_DIRECT_KEY'],
        authType: 'api_key',
        baseUrl: 'https://api.anthropic.com',
      },
    }
    const previous = process.env.ANTHROPIC_DIRECT_KEY
    delete process.env.ANTHROPIC_DIRECT_KEY
    try {
      expect(() => resolveProvider('anthropic-direct/claude', { plugins: [paid] })).toThrow(
        /ANTHROPIC_DIRECT_KEY is not set/u,
      )
    } finally {
      if (previous !== undefined) process.env.ANTHROPIC_DIRECT_KEY = previous
    }
  })

  it('uses the key when a keyless profile happens to have the variable set', () => {
    // `authType: 'none'` means the endpoint ignores credentials, so an operator who exported the
    // variable anyway must not change the outcome — and must not have a stray value forwarded as an
    // `authorization` header to a local server.
    const previous = process.env.LMSTUDIO_API_KEY
    process.env.LMSTUDIO_API_KEY = 'left-over-from-something-else'
    try {
      expect(resolveProvider('lmstudio/qwen', { plugins: [lmstudio] }).apiKey).toBe('local')
    } finally {
      if (previous === undefined) delete process.env.LMSTUDIO_API_KEY
      else process.env.LMSTUDIO_API_KEY = previous
    }
  })

  it('treats a profile that declares no authType by its env vars, as before', () => {
    // `authType` is required by the SDK's own type, but this module narrows structurally from
    // `unknown` — a plugin from an older SDK, or a hand-written one, may not carry it. Absent, the
    // previous rule stands: a named env var is required. Silently going keyless on a missing field
    // would be the permissive reading of an absence, which is the #503 mistake in miniature.
    const legacy = {
      name: 'legacy',
      version: '1.0.0',
      kind: 'model-provider',
      profile: { name: 'legacy', envVars: ['LEGACY_KEY'], baseUrl: 'https://legacy.test' },
    }
    const previous = process.env.LEGACY_KEY
    delete process.env.LEGACY_KEY
    try {
      expect(() => resolveProvider('legacy/model', { plugins: [legacy] })).toThrow(
        /LEGACY_KEY is not set/u,
      )
    } finally {
      if (previous !== undefined) process.env.LEGACY_KEY = previous
    }
  })
})
