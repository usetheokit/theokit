import { describe, expect, it } from 'vitest'

import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'

/**
 * B-257 — `options` is declared `Record<string, string | number | boolean>` and nothing checked it.
 *
 * The type is erased at runtime and the config arrives from a file, so the declaration protects
 * nobody. Measured before the fix, three values reached `JSON.stringify` and failed three ways:
 *
 * | value | what happened |
 * |---|---|
 * | `10n` | raw `TypeError: Do not know how to serialize a BigInt` |
 * | a cycle | raw `TypeError: Converting circular structure to JSON` |
 * | `() => {}` | **no error at all** — `JSON.stringify` omits functions |
 *
 * The first two are loud in the wrong voice: a `TypeError` naming JSON, where every other refusal
 * in this emitter is an `UnserialisableRateLimitError` naming the target, the config key and the
 * alternatives. An operator reads it as a bug in the build.
 *
 * The third is the one worth the test. A callback in `options` is a plausible thing to write, and
 * it was emitted as `{}` — the option silently absent, the store constructed without it, and
 * nothing anywhere saying so. A limit configured and not applied is what this whole item exists to
 * prevent, arriving one field further in.
 */
describe('baked store options are validated (B-257)', () => {
  const render = (options: unknown): string =>
    renderCloudflareWorkerEntry({
      ssrStreaming: false,
      rateLimit: {
        windowMs: 1000,
        max: 1,
        store: { module: '@x/store', factory: 'createStore', options: options as never },
      },
    })

  it('test_a_function_option_is_refused_instead_of_silently_dropped', () => {
    // The silent one. `JSON.stringify` omits it, so before this the entry was emitted with the
    // option missing and no diagnostic anywhere.
    expect(() => render({ onHit: () => {} })).toThrow(/options/i)
  })

  it('test_a_bigint_option_is_refused_by_name', () => {
    expect(() => render({ ttl: 10n })).toThrow(/options/i)
  })

  it('test_a_circular_option_is_refused_by_name', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => render(cyclic)).toThrow(/options/i)
  })

  it('test_the_declared_scalar_types_are_still_accepted', () => {
    // The refusal must be the value and not the field: a guard refusing everything passes every
    // case above and makes `options` unusable.
    const source = render({ url: 'redis://x', retries: 3, analytics: true })
    expect(source).toContain('redis://x')
    expect(source).toContain('3')
  })

  it('test_an_omitted_options_key_is_still_fine', () => {
    expect(() => render(undefined)).not.toThrow()
  })
})
