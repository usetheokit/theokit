/**
 * A rate limit that cannot be enforced on the chosen target FAILS the build (#461).
 *
 * `findUnappliedConfig` has always noticed — the build prints a warning naming every dropped key.
 * For `rateLimit` a warning is the wrong instrument, and the issue makes the case: the config reads
 * as protective, the deploy is not protected, and nobody finds out until abuse. #321 and #322 are
 * the same lesson twice, both closed: *a rate limit that silently does not apply is worse than one
 * that is absent, because the operator stops looking.*
 *
 * So this one refuses by name, which is what this framework already does when silence would be read
 * as safety — `MissingRoutePolicyError` for an undeclared route policy, and the public-bind refusal
 * shipped in 0.54.0.
 *
 * Deliberately NOT extended to the other concerns. A dropped `cors` or `serialization` degrades
 * visibly and the warning is proportionate; `rateLimit` is the one whose absence looks like
 * success. Escalating all of them would turn a useful warning into a wall people learn to skip.
 *
 * And deliberately NO escape hatch. The honest way past this is to remove the key — a flag that let
 * the config stay while doing nothing is precisely what the issue calls worse than absence.
 */
import { describe, expect, it } from 'vitest'

import {
  assertRateLimitEnforceable,
  UnenforceableRateLimitError,
} from '../../packages/theo/src/adapters/config-support.js'
import type { TheoConfig } from '../../packages/theo/src/config/schema.js'

const withRateLimit = { rateLimit: { max: 100, windowMs: 60_000 } } as unknown as TheoConfig
const withoutRateLimit = { security: { csrf: 'strict' } } as unknown as TheoConfig

/** What the six Web-standards targets declare — no `rateLimit` among them. */
const WEB_ADAPTER = {
  appliesConfig: ['securityHeaders', 'csrf', 'disallowed', 'cors', 'serialization'],
} as const
/** `node` applies it, in `theokit start` rather than an emitted file. */
const NODE_ADAPTER = { appliesConfig: ['rateLimit', 'csrf', 'securityHeaders'] } as const
/** TheoCloud answers for its own runtime, so this build cannot judge it. */
const CLOUD_ADAPTER = { appliesConfig: 'runtime-not-emitted-here' } as const

describe('assertRateLimitEnforceable', () => {
  it('refuses a target that cannot enforce a declared rate limit', () => {
    expect(() => assertRateLimitEnforceable(withRateLimit, WEB_ADAPTER, 'vercel')).toThrow(
      UnenforceableRateLimitError,
    )
  })

  it('names the target and both honest ways out', () => {
    let message = ''
    try {
      assertRateLimitEnforceable(withRateLimit, WEB_ADAPTER, 'vercel')
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('vercel')
    // Build for a target that applies it…
    expect(message).toMatch(/node/)
    // …or stop declaring it, so the file states what runs.
    expect(message).toMatch(/remove/i)
    // The CONSEQUENCE, not just the rule. An operator told only "not supported" reads it as a gap
    // to work around; told that the config reads as protection the deploy will not have, they read
    // it as the control they do not have.
    expect(message).toMatch(/protection the deploy will not have/i)
    // And why it refuses instead of warning — otherwise the refusal itself looks arbitrary.
    expect(message).toMatch(/first sign is abuse/i)
  })

  it('allows a target that applies it', () => {
    expect(() => assertRateLimitEnforceable(withRateLimit, NODE_ADAPTER, 'node')).not.toThrow()
  })

  it('allows any target when no rate limit is declared', () => {
    expect(() => assertRateLimitEnforceable(withoutRateLimit, WEB_ADAPTER, 'vercel')).not.toThrow()
  })

  it('does not judge a runtime this build cannot answer for', () => {
    expect(() =>
      assertRateLimitEnforceable(withRateLimit, CLOUD_ADAPTER, 'theo-cloud'),
    ).not.toThrow()
  })
})
