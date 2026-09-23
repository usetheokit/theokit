import { describe, expect, it } from 'vitest'

import {
  assertRateLimitEnforceable,
  findUnappliedConfig,
  UnenforceableRateLimitError,
} from '../../packages/theo/src/adapters/config-support.js'
import type { TheoConfig } from '../../packages/theo/src/config/schema.js'

/**
 * B-257 / T1.4 — the warning and the refusal read different declarations.
 *
 * Before this, `findUnappliedConfig` (`config-support.ts:114`) and `assertRateLimitEnforceable`
 * (`:226`) both read `adapter.appliesConfig`, and `:229` returns before the throw when the list
 * contains `'rateLimit'`. So adding that entry to stop the WARNING also switched off the REFUSAL —
 * on a runtime where the limit still cannot hold.
 *
 * `config-support.ts:213-215` wrote that refusal because *"`rateLimit` is the one whose absence looks
 * exactly like success"*, and `cli/commands/build.ts:275` cites #321 and #322 as that lesson twice.
 * B-027's plan carried a task that added `'rateLimit'` to a list; the PLAN panel returned it in round
 * one and the task was cut rather than shipped.
 *
 * The third value is `'not-ours-to-judge'` and NOT `'never'`. `config-support.ts:105-108` says an
 * adapter emitting no handler answers *"a different fact from saying no"*, `:218-219` repeats it, and
 * `:227` implements it as a `return` rather than a `throw`. A field named `enforcesRateLimit`
 * carrying `'never'` would assert what that code deliberately declines to assert.
 */

const withRateLimit = { rateLimit: { windowMs: 60_000, max: 10 } } as unknown as TheoConfig

describe('the warning list does not disarm the refusal (B-257 T1.4)', () => {
  it('test_silencing_the_warning_does_not_switch_off_the_refusal', () => {
    // An adapter that WARNS about nothing — `rateLimit` is in its applied list — and still cannot
    // enforce, because it emits a per-invocation runtime. Before T1.4 this combination was
    // unrepresentable: one list meant one answer.
    const adapter = {
      appliesConfig: ['rateLimit'] as const,
      enforcesRateLimit: 'with-a-store' as const,
    }

    expect(findUnappliedConfig(withRateLimit, adapter)).not.toContain('rateLimit')
    expect(() => assertRateLimitEnforceable(withRateLimit, adapter, 'cloudflare')).toThrow(
      UnenforceableRateLimitError,
    )
  })

  it('test_a_configured_store_lets_the_same_target_through', () => {
    // AC-012's half: the same adapter, a config that NAMES a store, and the build proceeds.
    const adapter = { appliesConfig: [] as const, enforcesRateLimit: 'with-a-store' as const }
    const withStore = {
      rateLimit: {
        windowMs: 60_000,
        max: 10,
        store: { module: '@upstash/redis', factory: 'Redis' },
      },
    } as unknown as TheoConfig

    expect(() => assertRateLimitEnforceable(withStore, adapter, 'cloudflare')).not.toThrow()
  })

  it('test_a_long_lived_runtime_enforces_without_a_store', () => {
    const adapter = { appliesConfig: ['rateLimit'] as const, enforcesRateLimit: 'always' as const }
    expect(() => assertRateLimitEnforceable(withRateLimit, adapter, 'node')).not.toThrow()
  })

  it('test_an_adapter_that_emits_no_handler_abstains_rather_than_refusing', () => {
    // AC-016. `theo-cloud.ts:29` answers `'runtime-not-emitted-here'` for `appliesConfig`, and this
    // is its counterpart: an ABSTAIN, not a refusal. Refusing here would assert something unmeasured
    // about somebody else's runtime — `config-support.ts:218-219`.
    const adapter = {
      appliesConfig: 'runtime-not-emitted-here' as const,
      enforcesRateLimit: 'not-ours-to-judge' as const,
    }
    expect(() => assertRateLimitEnforceable(withRateLimit, adapter, 'theo-cloud')).not.toThrow()
  })
})
