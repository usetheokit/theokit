import { describe, expect, it } from 'vitest'

import {
  resolveSettingSources,
  UntrustedSettingSourceError,
  type SettingSourceCapability,
} from '../../src/bridge/setting-sources-gate.js'
import { TheokitAgentError, resolveTrustPosture } from '../../src/index.js'
import type { TrustPosture } from '../../src/index.js'

/**
 * M68 T3 — the runtime refusal.
 *
 * Type control (`tests/type/setting-sources-gate.test-d.ts`) stops the wrong call from being BORN,
 * but binds TypeScript consumers only — a `.js` caller or an `as any` escapes. That is the residue
 * declared in the `Agent.list` narrowing (M103), and these tests are what covers it.
 *
 * Both lenses of `.claude/rules/testing.md` § 4.1 are here on purpose. The negative one is the heart
 * of the milestone; the positive one exists because a guard that forbade EVERYTHING would pass a
 * suite made only of negative cases, and would be a breaking change disguised as security.
 */

/** Build the posture through the SDK's real path, not an object literal — provenance matters. */
function postureFrom(opts: {
  isTrusted: boolean
  envOverride?: boolean
}): TrustPosture<SettingSourceCapability> {
  return resolveTrustPosture<SettingSourceCapability>({
    capabilities: ['projectSettings'],
    isTrusted: () => opts.isTrusted,
    envOverride: opts.envOverride,
  })
}

describe('M68 T3 — the safe path stays trivial', () => {
  it('test_user_source_needs_no_posture', () => {
    // If refusing demanded ceremony from the safe path, the friction would push the consumer to turn
    // the gate off — the opposite of the intent.
    expect(resolveSettingSources({ user: true })).toEqual(['user'])
  })

  it('test_an_empty_selection_enables_nothing', () => {
    expect(resolveSettingSources({})).toEqual([])
  })

  it('test_an_absent_selection_enables_nothing', () => {
    // Omitting is not enabling, never "enabling without a gate" — the same asymmetry the SDK
    // documents in `TrustPostureInput.envOverride`: `undefined` is "the operator did not turn it
    // on", not "turned it off".
    expect(resolveSettingSources(undefined)).toEqual([])
  })
})

describe('M68 T3 — the refusal', () => {
  it('test_project_source_is_refused_when_the_posture_is_untrusted', () => {
    const untrusted = postureFrom({ isTrusted: false })
    expect(() => resolveSettingSources({ project: { trustedBy: untrusted } })).toThrow(
      UntrustedSettingSourceError,
    )
  })

  it('test_the_refusal_is_a_typed_error_of_the_sdk_hierarchy', () => {
    // An error extending plain `Error` would be invisible to `isTransientError`, which only sees
    // this hierarchy — the defect M67 fixed in five classes.
    const untrusted = postureFrom({ isTrusted: false })
    try {
      resolveSettingSources({ project: { trustedBy: untrusted } })
      expect.unreachable('should have refused')
    } catch (err) {
      expect(err).toBeInstanceOf(TheokitAgentError)
      expect((err as UntrustedSettingSourceError).name).toBe('UntrustedSettingSourceError')
    }
  })

  it('test_the_refusal_names_the_capability_and_the_trust_source', () => {
    // "denied" is not actionable; "denied, and the decision came from `default`" is. The provenance
    // comes for free from the `TrustPosture` — half the reason it is the required evidence (ADR 0063).
    const untrusted = postureFrom({ isTrusted: false })
    try {
      resolveSettingSources({ project: { trustedBy: untrusted } })
      expect.unreachable('should have refused')
    } catch (err) {
      const refusal = err as UntrustedSettingSourceError
      expect(refusal.capability).toBe('projectSettings')
      expect(refusal.trustSource).toBe('default')
      expect(refusal.message).toMatch(/shell-executing hooks/)
      expect(refusal.message).toMatch(/decided by: default/)
    }
  })

  it('test_the_refusal_does_not_silently_downgrade_to_user_only', () => {
    // Downgrading would be "cleverly ignoring": the consumer asked for A, got B, and the difference
    // only shows when a hook it expected does not run (ADR 0064, alternative 3).
    const untrusted = postureFrom({ isTrusted: false })
    expect(() => resolveSettingSources({ user: true, project: { trustedBy: untrusted } })).toThrow()
  })
})

describe('M68 T3 — the grant', () => {
  it('test_project_source_is_wired_when_the_posture_is_trusted_by_the_store', () => {
    const trusted = postureFrom({ isTrusted: true })
    expect(trusted.source).toBe('store')
    expect(resolveSettingSources({ project: { trustedBy: trusted } })).toEqual(['project'])
  })

  it('test_project_source_is_wired_when_trust_came_from_an_env_override', () => {
    const trusted = postureFrom({ isTrusted: false, envOverride: true })
    expect(trusted.source).toBe('env')
    expect(resolveSettingSources({ project: { trustedBy: trusted } })).toEqual(['project'])
  })

  it('test_both_sources_are_wired_in_a_stable_order', () => {
    const trusted = postureFrom({ isTrusted: true })
    expect(resolveSettingSources({ user: true, project: { trustedBy: trusted } })).toEqual([
      'user',
      'project',
    ])
  })

  it('test_an_env_override_of_false_does_not_grant', () => {
    // The SDK is explicit: `false` and `undefined` both mean "the operator did not turn it on",
    // NEVER "turned it off" — an unset variable cannot override a trusted store. The gate inherits
    // that.
    const untrusted = postureFrom({ isTrusted: false, envOverride: false })
    expect(untrusted.level).toBe('untrusted')
    expect(() => resolveSettingSources({ project: { trustedBy: untrusted } })).toThrow(
      UntrustedSettingSourceError,
    )
  })
})
