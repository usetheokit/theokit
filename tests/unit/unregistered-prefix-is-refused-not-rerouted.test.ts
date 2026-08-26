/**
 * A model whose declared provider prefix is NOT registered must be refused, never rerouted.
 *
 * `resolveProvider` already carries the right error — "declares provider X, which is not
 * registered" — and it was unreachable whenever any credentialed provider had a key: `providerOf`
 * returns `undefined` for an unregistered prefix, which is indistinguishable from a bare model id,
 * so the priority walk claimed the turn before the check below it ever ran.
 *
 * The consequence is not a confusing message. With a valid key for the substitute the request
 * SUCCEEDS: a different endpoint, a different account billed, and the prompt delivered to a vendor
 * the operator had explicitly routed away from — announced only by a `console.warn` reading
 * `(by env priority)` that fires at most once per process (#503).
 *
 * #326 settled the principle for a registered provider: the declared provider wins, priority is the
 * fallback for a bare model id. An unregistered prefix is not a bare model id.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  registerProvider,
  resetProviderRegistry,
  resetProviderAnnouncements,
  resolveProvider,
  tryResolveProvider,
} from '../../packages/theo/src/server/agent/provider-resolver.js'

const ENV_KEYS = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test cleanup over fixed env key allowlist
    delete process.env[k]
  }
  resetProviderRegistry()
  resetProviderAnnouncements()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test cleanup over fixed env key allowlist
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  resetProviderRegistry()
  resetProviderAnnouncements()
})

describe('an unregistered provider prefix', () => {
  it('is refused even when another provider holds a key', () => {
    // The exact repro: a real `@theokit/sdk` profile the framework registry does not mirror.
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-placeholder'

    expect(() => resolveProvider('openai-chatgpt/gpt-5.4')).toThrow(/not registered/)
  })

  it('names the prefix and the registered alternatives, so the operator can act', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-placeholder'

    expect(() => resolveProvider('openai-chatgpt/gpt-5.4')).toThrow(/openai-chatgpt/)
    expect(() => resolveProvider('openai-chatgpt/gpt-5.4')).toThrow(/registerProvider/)
  })

  it('does not route the turn to the substitute — the failure this exists to prevent', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-placeholder'

    const resolved = tryResolveProvider('openai-chatgpt/gpt-5.4')
    // `tryResolveProvider` is the non-throwing escape hatch; returning `openrouter` here is the
    // silent substitution itself, wearing a different call site.
    expect(resolved?.name, 'the turn must not be handed to a provider nobody named').not.toBe(
      'openrouter',
    )
  })

  it('still lets a BARE model id fall back to env priority (#326 unchanged)', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-placeholder'

    // No prefix declared → nothing was chosen → priority is the right answer.
    expect(resolveProvider('gpt-5.4').name).toBe('openrouter')
  })

  it('still honours a REGISTERED prefix over env priority (#326 unchanged)', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-placeholder'
    process.env.ANTHROPIC_API_KEY = 'sk-ant-placeholder'
    registerProvider({
      name: 'anthropic',
      envKey: 'ANTHROPIC_API_KEY',
      baseUrl: 'https://api.anthropic.com',
      priority: 50,
    })

    expect(resolveProvider('anthropic/claude').name).toBe('anthropic')
  })
})
