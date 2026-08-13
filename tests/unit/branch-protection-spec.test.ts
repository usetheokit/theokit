import { describe, expect, it } from 'vitest'

import { diffProtection, SPEC } from '../../scripts/protect-branches.mjs'

/**
 * The branch-protection policy, as something the repository can check rather than remember.
 *
 * ## Why this exists
 *
 * `CLAUDE.md` § 4 and `git-safety.md` § 1 say the same thing in different words: the local hook
 * guarantees work is BORN on `workspace`; **branch protection is what makes the PR mandatory**. This
 * repository has the first guarantee and not the second — `git push origin main` works today, and
 * two consecutive releases merged with twelve red checks partly because nothing on the server side
 * said no.
 *
 * The intended policy lived only in the prose of issue #208. Prose cannot be diffed against reality,
 * so nobody could answer "does the repo match what we decided?" without opening a settings page. The
 * spec is now a versioned artifact and this test is what keeps it honest.
 *
 * ## What is deliberately empty
 *
 * `required_status_checks.contexts`. Requiring a check that cannot pass converts a *missing* gate
 * into a *jammed* one, and this repository spent an entire cycle removing gates that were impossible
 * by construction. Contexts get added as checks turn green and stay green.
 */

describe('the spec says what the rules say', () => {
  it('test_main_and_develop_are_the_protected_branches', () => {
    expect(Object.keys(SPEC.branches).sort((a, b) => a.localeCompare(b))).toEqual([
      'develop',
      'main',
    ])
  })

  it('test_workspace_is_deliberately_left_unprotected', () => {
    // Protecting it would break the branch the rules require everyone to use — work is born there.
    expect(SPEC.branches).not.toHaveProperty('workspace')
    expect(SPEC.$unprotected?.workspace).toMatch(/where work is born/i)
  })

  it('test_a_pull_request_is_required_on_both', () => {
    // The single guarantee this policy is bought for.
    for (const branch of ['main', 'develop'] as const) {
      expect(SPEC.branches[branch].required_pull_request_reviews).not.toBeNull()
    }
  })

  it('test_force_push_and_deletion_are_refused_on_both', () => {
    for (const branch of ['main', 'develop'] as const) {
      expect(SPEC.branches[branch].allow_force_pushes).toBe(false)
      expect(SPEC.branches[branch].allow_deletions).toBe(false)
    }
  })

  it('test_no_status_check_is_required_yet', () => {
    // Not an oversight — see the docblock. A jammed gate is worse than a missing one, and this
    // assertion is here so that adding a context is a deliberate, reviewed edit rather than a drift.
    for (const branch of ['main', 'develop'] as const) {
      expect(SPEC.branches[branch].required_status_checks.contexts).toEqual([])
    }
  })

  it('test_administrators_are_NOT_exempt', () => {
    // Measured the day the policy was first applied: both branches came back protected, the
    // comparator printed `✓ matches the spec` — and `enforce_admins` was `false`. In a repository
    // with one maintainer, that maintainer IS the administrator, so the exemption applied to
    // literally every human who could push. The gate was bought to make the PR mandatory and made it
    // mandatory for nobody.
    //
    // This is the same defect shape the rest of this cycle kept finding: a gate whose oracle does not
    // measure what its name promises. It is worse than an absent gate, because `✓` invites everyone
    // to stop looking.
    //
    // The escape hatch is not lost: an admin can still merge PRs (zero approvals, no required
    // contexts), still push tags, and can still turn the policy off in Settings. What they can no
    // longer do is `git push origin main` — which is exactly what `git-safety.md` § 1 forbids in
    // prose and, until now, only in prose.
    for (const branch of ['main', 'develop'] as const) {
      expect(
        SPEC.branches[branch].enforce_admins,
        `${branch}: with enforce_admins false the sole maintainer bypasses the PR requirement, so ` +
          'the policy protects nothing.',
      ).toBe(true)
    }
  })

  it('test_zero_approvals_because_one_would_be_unsatisfiable', () => {
    // A solo-maintainer repo cannot satisfy a 1-approval gate; a gate that can only be bypassed
    // teaches bypassing, which is the habit this whole policy exists to remove.
    for (const branch of ['main', 'develop'] as const) {
      expect(
        SPEC.branches[branch].required_pull_request_reviews?.required_approving_review_count,
      ).toBe(0)
    }
  })
})

describe('diffProtection — comparing the spec against what the server reports', () => {
  const desired = SPEC.branches.main

  it('test_an_unprotected_branch_is_reported_as_entirely_missing', () => {
    // The API answers 404 for an unprotected branch; `null` is how the caller passes that on.
    const diff = diffProtection('main', desired, null)
    expect(diff.matches).toBe(false)
    expect(diff.differences[0]).toMatch(/not protected/i)
  })

  it('test_a_matching_configuration_reports_no_difference', () => {
    const live = {
      required_pull_request_reviews: { required_approving_review_count: 0 },
      enforce_admins: { enabled: true },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_status_checks: { contexts: [] },
    }
    expect(diffProtection('main', desired, live).matches).toBe(true)
  })

  it('test_a_missing_pull_request_requirement_is_named', () => {
    // The one difference that matters most: without it, the PR is convention, not restriction.
    const live = {
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_status_checks: { contexts: [] },
    }
    const diff = diffProtection('main', desired, live)
    expect(diff.matches).toBe(false)
    expect(diff.differences.join(' ')).toMatch(/pull request/i)
  })

  it('test_force_push_left_enabled_is_named', () => {
    const live = {
      required_pull_request_reviews: { required_approving_review_count: 0 },
      allow_force_pushes: { enabled: true },
      allow_deletions: { enabled: false },
      required_status_checks: { contexts: [] },
    }
    const diff = diffProtection('main', desired, live)
    expect(diff.matches).toBe(false)
    expect(diff.differences.join(' ')).toMatch(/force.push/i)
  })

  it('test_an_admin_exemption_left_on_the_server_is_reported', () => {
    // The second half of the same defect. The comparator did not read `enforce_admins` at all, so it
    // reported `✓ matches the spec` against a live policy that exempted administrators. A field the
    // comparator ignores is a field that can drift silently forever — and this one decides whether
    // the policy binds the only person it governs.
    const live = {
      required_pull_request_reviews: { required_approving_review_count: 0 },
      enforce_admins: { enabled: false },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_status_checks: { contexts: [] },
    }
    const diff = diffProtection('main', desired, live)
    expect(diff.matches).toBe(false)
    expect(diff.differences.join(' ')).toMatch(/administrator/i)
  })

  it('test_an_extra_required_context_on_the_server_is_reported_as_drift', () => {
    // Drift in either direction is drift. A context nobody put in the spec is a rule nobody reviewed.
    const live = {
      required_pull_request_reviews: { required_approving_review_count: 0 },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_status_checks: { contexts: ['Some Check'] },
    }
    const diff = diffProtection('main', desired, live)
    expect(diff.matches).toBe(false)
    expect(diff.differences.join(' ')).toMatch(/Some Check/)
  })
})
