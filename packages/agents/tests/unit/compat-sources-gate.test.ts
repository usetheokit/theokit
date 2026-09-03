import { describe, expect, it } from 'vitest'

import {
  resolveCompatSources,
  UntrustedSettingSourceError,
} from '../../src/bridge/setting-sources-gate.js'

/**
 * usetheokit/theokit#634 — `compatSources` had no forward, so a consumer on this layer could not
 * opt into `.claude/` discovery at all.
 *
 * ## Why it is not a raw pass-through
 *
 * `settingSources` already refuses to be one, and the reason applies here more sharply.
 * `'project'` authorises `<cwd>/.theokit/hooks.json`, **which executes shell**, so it takes a grant
 * carrying a `TrustPosture` rather than a string. `compatSources: ['claude-code']` authorises
 * `<cwd>/.claude/hooks.json` — the same shell execution, on a directory that is even more likely to
 * have arrived with a cloned repository, written for a different product by somebody who never
 * heard of this one.
 *
 * So it reuses the same asymmetry and the same vocabulary: a member on the existing selection,
 * resolved through the same path, rather than a second concept beside it.
 */
const trusted = {
  level: 'trusted',
  source: 'env',
  allows: { projectSettings: true },
} as never

const untrusted = {
  level: 'untrusted',
  source: 'default',
  allows: { projectSettings: false },
} as never

describe('resolveCompatSources — a foreign root needs the same evidence as our own', () => {
  it('returns nothing when the consumer declared nothing', () => {
    // Omitting is not enabling. Inherited from the SDK, whose `TrustPostureInput.envOverride`
    // documents that `false` and `undefined` both mean "the operator did not turn it on".
    expect(resolveCompatSources(undefined)).toEqual([])
    expect(resolveCompatSources({})).toEqual([])
  })

  it('returns the source once a trusted posture grants it', () => {
    expect(resolveCompatSources({ claudeCode: { trustedBy: trusted } })).toEqual(['claude-code'])
  })

  it('refuses rather than ignores when the posture does not grant it', () => {
    // Refuses rather than ignores (ADR 0064). Ignoring would leave the product running in the
    // belief that the repository's hooks are active — a silent failure on the wrong side.
    expect(() => resolveCompatSources({ claudeCode: { trustedBy: untrusted } })).toThrow(
      UntrustedSettingSourceError,
    )
  })

  it('says WHERE the decision came from, not merely that it was denied', () => {
    // The posture carries `source`, and a refusal that names it is actionable; one that does not
    // sends the reader to guess between an env var, a store and a default.
    try {
      resolveCompatSources({ claudeCode: { trustedBy: untrusted } })
      expect.unreachable('should have refused')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('.claude/')
      expect(message).toContain('default')
    }
  })

  it('names the shell execution it is authorising', () => {
    // The whole reason this is a grant and not a boolean. A refusal that does not say what was at
    // stake reads as bureaucracy, and bureaucracy gets granted reflexively.
    try {
      resolveCompatSources({ claudeCode: { trustedBy: untrusted } })
      expect.unreachable('should have refused')
    } catch (error) {
      expect((error as Error).message).toMatch(/hook|shell/i)
    }
  })
})
