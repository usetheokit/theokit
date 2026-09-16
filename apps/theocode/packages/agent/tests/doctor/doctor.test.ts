/**
 * B-081 — the diagnostic must be trustworthy in the two ways that matter: it must FAIL when
 * something is broken (so a script can use it), and it must never print a secret (because its whole
 * purpose is to be pasted into an issue).
 */
import { describe, expect, it } from 'vitest'

import { collectChecks, diagnose, renderDiagnosis } from '../../src/doctor/doctor.js'

const base = {
  cwd: '/workspace',
  trustLevel: 'trusted',
  model: 'openai/gpt-5.6-terra',
  effort: 'medium',
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  credential: 'present' as const,
  wired: {
    mcp: { active: ['probe'], suppressedByTrust: false },
    skills: { active: ['daily-briefing'], suppressedByTrust: false },
    hooks: { active: [], suppressedByTrust: false },
  },
}

describe('B-081 — collectChecks', () => {
  it('test_a_healthy_install_has_no_failure', () => {
    // `failed` is a COUNT since the quartet moved to `@theokit/agents/doctor` — `toBe(false)`
    // would now pass on `+0` for the wrong reason, and fail on any real count.
    expect(diagnose(collectChecks(base)).failed).toBe(0)
  })

  it('test_a_missing_credential_is_a_failure_with_the_remedy', () => {
    // FAIL, not warn: without it nothing works, and the exit code is what makes this usable in a
    // support script.
    const d = diagnose(collectChecks({ ...base, credential: 'absent' }))
    expect(d.failed).toBeGreaterThan(0)
    expect(d.exitCode, 'the exit code is what makes this usable in a support script').not.toBe(0)
    expect(d.checks.find((c) => c.name === 'credential')?.detail).toContain('/login')
  })

  it('test_an_expired_credential_is_not_reported_as_present', () => {
    // The defect this state exists for. Measured 2026-08-25: an OAuth token ten days past its
    // expiry produced `✓ credential: present` — a green tick on the one thing about to fail.
    const check = collectChecks({ ...base, credential: 'expired' }).find(
      (c) => c.name === 'credential',
    )

    expect(check?.status, 'an expired credential still reported as ok').not.toBe('ok')
    expect(check?.detail).toContain('EXPIRED')
  })

  it('test_an_expired_credential_warns_rather_than_fails', () => {
    // A refresh token may still renew it on the next turn, so "this will not work" would overstate
    // what is known. `absent` is the state that IS a failure.
    const expired = collectChecks({ ...base, credential: 'expired' }).find(
      (c) => c.name === 'credential',
    )
    const absent = collectChecks({ ...base, credential: 'absent' }).find(
      (c) => c.name === 'credential',
    )

    expect(expired?.status).toBe('warn')
    expect(absent?.status).toBe('fail')
  })

  it('test_an_unreadable_credential_is_distinct_from_an_absent_one', () => {
    // Different remedies: one is "log in", the other is "your credential file is corrupt".
    const detail = collectChecks({ ...base, credential: 'unreadable' }).find(
      (c) => c.name === 'credential',
    )?.detail
    expect(detail).toContain('unreadable')
    expect(detail).not.toContain('/login')
  })

  it('test_trust_suppression_warns_rather_than_fails', () => {
    // Trust-gating is the product working as designed. Failing on it would train users to ignore
    // the exit code, which is the only thing making this scriptable.
    const d = diagnose(
      collectChecks({
        ...base,
        trustLevel: 'untrusted',
        wired: {
          mcp: { active: [], suppressedByTrust: true },
          skills: { active: [], suppressedByTrust: true },
          hooks: { active: [], suppressedByTrust: true },
        },
      }),
    )
    expect(d.failed).toBe(0)
    expect(d.exitCode, 'warnings must not make a green install exit non-zero').toBe(0)
    expect(d.checks.filter((c) => c.status === 'warn').length).toBeGreaterThanOrEqual(3)
  })

  it('test_suppressed_is_not_rendered_as_none', () => {
    // "none" and "yours were withheld" send a user to opposite places — the same distinction
    // B-069/B-070/B-071 each had to make in their own listing.
    const detail = collectChecks({
      ...base,
      wired: { ...base.wired, hooks: { active: [], suppressedByTrust: true } },
    }).find((c) => c.name === 'hooks')?.detail
    expect(detail).toContain('NOT wired')
    expect(detail).not.toBe('none')
  })
})

describe('B-081 — renderDiagnosis', () => {
  it('test_a_failure_is_findable_by_eye', () => {
    // The renderer is the framework's now, so the assertion is on the PROPERTY the test is named
    // for — a failure is visible and counted — not on the glyph the local version happened to use.
    const diagnosis = diagnose(collectChecks({ ...base, credential: 'absent' }))
    const out = renderDiagnosis(diagnosis)
    expect(out).toContain('credential')
    expect(
      out,
      'the summary must state how many failed, or a long paste hides the one that did',
    ).toContain(`${String(diagnosis.failed)} failed of`)
  })

  it('test_it_never_prints_a_secret', () => {
    // The invariant that matters most. `collectChecks` takes presence, never a value, so there is
    // no path by which a token can reach this output — pinned so a future field cannot add one.
    const out = renderDiagnosis(diagnose(collectChecks(base)))
    expect(out).not.toMatch(/sk-|npm_|ghp_|Bearer /)
    expect(JSON.stringify(Object.keys(base))).not.toContain('token')
  })
})
