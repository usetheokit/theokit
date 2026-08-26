/**
 * Provider Resolver tests — Strategy + Registry pattern (FAANG-grade).
 *
 * Mandatory BDD coverage:
 *   - Happy path: each env var resolves to the correct provider
 *   - Priority order: OPENROUTER > OPENAI > ANTHROPIC
 *   - Error path: zero env vars → actionable error message
 *   - Registry: registerProvider() idempotent + listProviders() snapshot
 *   - Escape hatch: tryResolveProvider() does not throw
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  listProviders,
  registerProvider,
  resetProviderRegistry,
  resetProviderAnnouncements,
  resolveProvider,
  tryResolveProvider,
  type ProviderDescriptor,
} from '../../packages/theo/src/server/agent/provider-resolver.js'

// Snapshot original env keys — restore after each test
const ENV_KEYS_TO_CLEAR = [
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'SELF_HOSTED_API_KEY',
] as const

function clearLLMEnv() {
  for (const k of ENV_KEYS_TO_CLEAR) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test cleanup over fixed env key allowlist
    delete process.env[k]
  }
}

describe('Provider Resolver — Strategy + Registry (FAANG-grade)', () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = {}
    for (const k of ENV_KEYS_TO_CLEAR) {
      originalEnv[k] = process.env[k]
    }
    clearLLMEnv()
    resetProviderRegistry()
  })

  afterEach(() => {
    for (const k of ENV_KEYS_TO_CLEAR) {
      if (originalEnv[k] === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test cleanup over fixed env key allowlist
        delete process.env[k]
      } else {
        process.env[k] = originalEnv[k]
      }
    }
    resetProviderRegistry()
  })

  describe('resolveProvider() — env-driven Strategy', () => {
    it('should resolve OpenRouter when OPENROUTER_API_KEY is present', () => {
      // Given: only OPENROUTER_API_KEY is set,
      process.env.OPENROUTER_API_KEY = 'sk-or-test'
      // When: resolveProvider() is called,
      const r = resolveProvider()
      // Then: OpenRouter wins with correct baseUrl.
      expect(r.name).toBe('openrouter')
      expect(r.apiKey).toBe('sk-or-test')
      expect(r.baseUrl).toBe('https://openrouter.ai/api/v1')
    })

    it('should resolve OpenAI when only OPENAI_API_KEY is present', () => {
      process.env.OPENAI_API_KEY = 'sk-test'
      const r = resolveProvider()
      expect(r.name).toBe('openai')
      expect(r.baseUrl).toBe('https://api.openai.com/v1')
    })

    it('should resolve Anthropic when only ANTHROPIC_API_KEY is present', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
      const r = resolveProvider()
      expect(r.name).toBe('anthropic')
      expect(r.baseUrl).toBe('https://api.anthropic.com')
    })

    it('should PRIORITIZE OpenRouter when multiple env vars present', () => {
      // Given: OpenRouter AND OpenAI keys present,
      process.env.OPENROUTER_API_KEY = 'sk-or-test'
      process.env.OPENAI_API_KEY = 'sk-test'
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
      // When: resolve,
      const r = resolveProvider()
      // Then: priority order — OpenRouter wins (gateway > direct).
      expect(r.name).toBe('openrouter')
    })

    it('should throw actionable error when NO env var is set', () => {
      // Given: clean env,
      // When: resolveProvider() called,
      // Then: error message mentions all expected env vars + actionable hint.
      expect(() => resolveProvider()).toThrow(/OPENROUTER_API_KEY/)
      expect(() => resolveProvider()).toThrow(/openrouter\.ai\/keys/)
    })

    it('should treat empty-string env var as absent', () => {
      // Given: the KEY is present but empty,
      process.env.OPENROUTER_API_KEY = ''
      process.env.OPENAI_API_KEY = 'sk-test'
      // When: resolve,
      const r = resolveProvider()
      // Then: OpenAI (next priority) wins — empty string treated como absent.
      expect(r.name).toBe('openai')
    })
  })

  describe('tryResolveProvider() — graceful degradation', () => {
    it('should return null when no env var (does not throw)', () => {
      expect(tryResolveProvider()).toBeNull()
    })

    it('should return resolved when env present', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test'
      const r = tryResolveProvider()
      expect(r).not.toBeNull()
      expect(r?.name).toBe('openrouter')
    })
  })

  describe('Registry — extension point', () => {
    it('listProviders() returns every provider sorted by priority', () => {
      const list = listProviders()

      // The invariant, asserted over whatever the registry holds. This read `length === 3` until
      // #407 added a fourth default, which is the shape of assertion that fails on every
      // legitimate addition while proving nothing about the ordering it is named for.
      const priorities = list.map((p) => p.priority)
      expect(priorities).toStrictEqual([...priorities].sort((a, b) => a - b))

      // The documented cloud order, stated as relative position so a new entry anywhere in the
      // table cannot break it.
      const names = list.map((p) => p.name)
      expect(names.indexOf('openrouter')).toBeLessThan(names.indexOf('openai'))
      expect(names.indexOf('openai')).toBeLessThan(names.indexOf('anthropic'))
    })

    it('registerProvider() adds new provider at specified priority', () => {
      const custom: ProviderDescriptor = {
        name: 'self-hosted',
        envKey: 'SELF_HOSTED_API_KEY',
        baseUrl: 'https://llm.internal.acme.com/v1',
        priority: 0, // highest
      }
      const before = listProviders().length
      registerProvider(custom)
      const list = listProviders()
      expect(list.length).toBe(before + 1)
      expect(list[0]?.name).toBe('self-hosted') // priority 0 wins

      // Resolve respects new priority
      process.env.SELF_HOSTED_API_KEY = 'custom-token'
      process.env.OPENROUTER_API_KEY = 'sk-or-test'
      const r = resolveProvider()
      expect(r.name).toBe('self-hosted')
    })

    it('registerProvider() is IDEMPOTENT — same name replaces, no duplicates', () => {
      const v1: ProviderDescriptor = {
        name: 'custom',
        envKey: 'CUSTOM_KEY',
        baseUrl: 'https://v1.acme.com',
        priority: 5,
      }
      const v2: ProviderDescriptor = { ...v1, baseUrl: 'https://v2.acme.com' }
      registerProvider(v1)
      registerProvider(v2)
      const list = listProviders()
      expect(list.filter((p) => p.name === 'custom').length).toBe(1)
      expect(list.find((p) => p.name === 'custom')?.baseUrl).toBe('https://v2.acme.com')
    })

    it('resetProviderRegistry() restores the defaults exactly', () => {
      const defaults = listProviders().map((p) => p.name)

      registerProvider({
        name: 'temp',
        envKey: 'TEMP_KEY',
        baseUrl: 'https://temp.com',
        priority: 99,
      })
      expect(listProviders().map((p) => p.name)).toContain('temp')

      resetProviderRegistry()

      // Identity with the pre-registration set, not a count: this catches a reset that drops a
      // default alongside the temporary entry, which a length check would call success.
      expect(listProviders().map((p) => p.name)).toStrictEqual(defaults)
    })
  })
})

/**
 * theokit#326 — the model already names its provider, so resolution must honour it.
 *
 * `resolveProvider()` took no argument, so an agent declaring `anthropic/claude-sonnet-4-6`
 * was handed whichever key happened to be set first by priority. On a machine with a stale
 * `OPENROUTER_API_KEY`, every turn died with `auth_failed (HTTP 401)` against a provider the
 * agent never asked for.
 */
describe('resolveProvider(modelId) routes by the provider the model declares', () => {
  beforeEach(() => {
    resetProviderRegistry()
    clearLLMEnv()
  })
  afterEach(clearLLMEnv)

  it('picks the provider named in the model id, not the highest-priority env var', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-stale'
    process.env.ANTHROPIC_API_KEY = 'sk-ant-real'

    const resolved = resolveProvider('anthropic/claude-sonnet-4-6')

    expect(resolved.name).toBe('anthropic')
    expect(resolved.apiKey).toBe('sk-ant-real')
  })

  it('names the exact variable to set when the declared provider has no key', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-something'

    expect(() => resolveProvider('anthropic/claude-sonnet-4-6')).toThrow(/ANTHROPIC_API_KEY/)
  })

  it('treats a gateway prefix as the provider, so the rest of the id stays the upstream model', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-real'

    const resolved = resolveProvider('openrouter/anthropic/claude-haiku-4.5')

    expect(resolved.name).toBe('openrouter')
  })

  it('falls back to priority order when the model declares no provider', () => {
    process.env.OPENAI_API_KEY = 'sk-openai'

    expect(resolveProvider('gpt-4o-mini').name).toBe('openai')
    expect(resolveProvider().name).toBe('openai')
  })

  it('REFUSES a prefix that names no registered provider, instead of falling back (#503)', () => {
    process.env.OPENAI_API_KEY = 'sk-openai'

    // This assertion was inverted. theokit#326 listed `acme/whatever → previous priority order`
    // among its outcomes, so the old behaviour was recorded rather than accidental — but it was
    // recorded without a reason, and the same commit argues the opposite principle two paragraphs
    // on: "refusing to substitute is the load-bearing part ... falling through to another
    // provider's key is precisely what made that 401 unattributable."
    //
    // #503 measured what that costs when the substitute's key is VALID: the turn succeeds against a
    // provider nobody named — different endpoint, different account billed, prompt delivered to a
    // vendor the operator had routed away from. An unregistered prefix is a choice, not a silence,
    // and #326's own reasoning applies to it.
    //
    // `qwen2.5:3b` has no slash and still falls back; that case is asserted above and unchanged.
    expect(() => resolveProvider('acme/whatever')).toThrow(/not registered/)
  })
})

/**
 * theokit#326, the half that routing did not close — a successful resolution is silent.
 *
 * `resolveProvider` returns `{ name, apiKey, baseUrl }` and every call site consumes only the key,
 * so `name` is discarded at the boundary. There is no log, no endpoint and no field on any
 * response that answers "which provider is this server using?". An operator learns it from an
 * error message, which means only when it has already failed — and a stale key that resolves and
 * then 401s is exactly the case where the answer matters most.
 */
describe('resolution announces itself once', () => {
  beforeEach(() => {
    resetProviderRegistry()
    clearLLMEnv()
    resetProviderAnnouncements()
  })
  afterEach(clearLLMEnv)

  it('reports the provider it chose, the variable it came from, and never the key', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-value'
    const lines: string[] = []

    resolveProvider('anthropic/claude-sonnet-4-6', { announce: (line) => lines.push(line) })

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('anthropic')
    expect(lines[0]).toContain('ANTHROPIC_API_KEY')
    expect(lines[0]).not.toContain('sk-ant-secret-value')
  })

  it('says so when the model chose the provider, rather than env priority', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or'
    process.env.ANTHROPIC_API_KEY = 'sk-ant'
    const lines: string[] = []

    resolveProvider('anthropic/claude-sonnet-4-6', { announce: (line) => lines.push(line) })

    expect(lines[0]).toContain('declared by the model')
  })

  it('announces once per provider, not once per request', () => {
    process.env.OPENAI_API_KEY = 'sk-openai'
    const lines: string[] = []
    const announce = (line: string) => lines.push(line)

    resolveProvider('gpt-4o-mini', { announce })
    resolveProvider('gpt-4o-mini', { announce })
    resolveProvider('gpt-4o-mini', { announce })

    expect(lines).toHaveLength(1)
  })
})
