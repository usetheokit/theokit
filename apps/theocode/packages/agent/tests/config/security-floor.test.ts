/**
 * B-006 — a security floor for the two keys that decide confinement.
 *
 * `sandbox_mode` and `approval_policy` were ordinary last-wins scalars, so `project` (precedence 30)
 * and `env` (50) both outranked the user's own file (20). A repository could hand itself
 * `danger-full-access`, or an inherited environment variable could, and the user's global setting
 * simply lost.
 *
 * The codebase already reasoned this through once, for hooks, and wrote down why:
 *
 *   > An environment variable injecting hooks would be arbitrary code execution declared outside
 *   > any reviewable file, bypassing the accumulation that stops a project from displacing the
 *   > user's global guard.
 *
 * That argument transfers verbatim to these two keys. It was made for hooks and not applied here.
 *
 * The floor is deliberately narrow: `project` and `env` may only HARDEN what the user chose. `cli`
 * may still loosen, because that is the operator typing an explicit flag for one session — the
 * threat model is a repository or an inherited environment, not the person at the keyboard.
 */
import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../../src/config/config.js'
import { applySecurityFloor, MORE_PERMISSIVE } from '../../src/config/security-floor.js'

describe('B-006 — project and env cannot loosen what the user set', () => {
  it('test_a_project_cannot_widen_the_sandbox', () => {
    expect(
      applySecurityFloor('sandbox_mode', {
        user: 'read-only',
        project: 'danger-full-access',
      }),
      "a cloned repository handed itself full filesystem access over the user's own setting",
    ).toBe('read-only')
  })

  it('test_an_env_var_cannot_widen_the_sandbox', () => {
    expect(
      applySecurityFloor('sandbox_mode', { user: 'workspace-write', env: 'danger-full-access' }),
    ).toBe('workspace-write')
  })

  it('test_a_project_cannot_stop_the_agent_from_asking', () => {
    expect(
      applySecurityFloor('approval_policy', { user: 'on-request', project: 'never' }),
      '`never` means "run without asking" — a repository must not be able to choose that for the user',
    ).toBe('on-request')
  })
})

describe('B-006 — hardening is always allowed', () => {
  it('test_a_project_may_tighten_the_sandbox', () => {
    expect(
      applySecurityFloor('sandbox_mode', { user: 'danger-full-access', project: 'read-only' }),
      'a repository asking for LESS access is not a threat, and refusing it would be theatre',
    ).toBe('read-only')
  })

  it('test_a_project_may_ask_for_more_confirmation', () => {
    expect(applySecurityFloor('approval_policy', { user: 'never', project: 'untrusted' })).toBe(
      'untrusted',
    )
  })
})

describe('B-006 — the operator keeps control', () => {
  it('test_the_cli_may_still_loosen_for_one_session', () => {
    expect(
      applySecurityFloor('sandbox_mode', { user: 'read-only', cli: 'danger-full-access' }),
      'the threat model is a repository or an inherited environment, not the person typing the flag',
    ).toBe('danger-full-access')
  })

  it('test_with_no_user_setting_the_lower_layers_still_apply', () => {
    // Anti-vacuity floor: a function that always returned the user value would pass the tests above.
    expect(applySecurityFloor('sandbox_mode', { project: 'workspace-write' })).toBe(
      'workspace-write',
    )
  })
})

/**
 * Three properties the suite above did not pin. Found by mutation, not by reading: each mutation
 * below left every existing case green, so the behaviour was working by accident rather than by
 * test.
 */
describe('B-006 — the ceiling descends and only ever descends', () => {
  it('test_a_hardened_ceiling_binds_the_next_restricted_layer', () => {
    // Replacing `ceiling = level` with `Math.max(ceiling, level)` survived the whole suite. It only
    // differs once a restricted layer HARDENS and a later one offers something between the old and
    // the new ceiling: here `project` tightens to read-only, and `env` must then be measured against
    // read-only rather than against the user's danger-full-access.
    expect(
      applySecurityFloor('sandbox_mode', {
        user: 'danger-full-access',
        project: 'read-only',
        env: 'workspace-write',
      }),
    ).toBe('read-only')
  })

  it('test_an_unknown_value_in_a_restricted_layer_is_ignored', () => {
    // A typo in a repository's config must neither become the effective setting nor be read as
    // maximally permissive. Accepting out-of-vocabulary values survived the suite too.
    expect(
      applySecurityFloor('sandbox_mode', { user: 'read-only', project: 'danger_full_access' }),
      'a misspelled mode in a repository config became the effective sandbox',
    ).toBe('read-only')
  })

  it('test_defaults_establish_the_ceiling_when_the_user_said_nothing', () => {
    // Most users never write a config file, so this is the common case rather than an edge one: with
    // `defaults` ignored as a baseline, a repository would widen the sandbox for every such user.
    expect(
      applySecurityFloor('sandbox_mode', {
        defaults: 'read-only',
        project: 'danger-full-access',
      }),
    ).toBe('read-only')
  })

  it('test_the_user_may_still_loosen_their_own_defaults', () => {
    // Anti-vacuity: if `defaults` capped everything, the case above would pass while the rule was
    // "nothing may ever exceed the defaults" — which would forbid the user from configuring at all.
    expect(
      applySecurityFloor('sandbox_mode', { defaults: 'read-only', user: 'workspace-write' }),
    ).toBe('workspace-write')
  })
})

describe('B-006 — the permissiveness order is explicit', () => {
  it('test_the_orders_run_from_most_to_least_confined', () => {
    expect(MORE_PERMISSIVE.sandbox_mode).toEqual([
      'read-only',
      'workspace-write',
      'danger-full-access',
    ])
    expect(MORE_PERMISSIVE.approval_policy).toEqual(['untrusted', 'on-request', 'never'])
  })
})

/**
 * The floor has to apply on the REAL merge path, not only in isolation.
 *
 * This is the same class of defect B-003 found in the GC: `hasLiveWriter` was declared, wired and
 * never called, so the guard read as protection while protecting nothing. A unit-tested helper that
 * `resolveConfig` does not consult would be exactly that, one directory over.
 */
describe('B-006 — the floor applies through resolveConfig', () => {
  it('test_a_project_toml_cannot_widen_the_sandbox_end_to_end', () => {
    const cfg = resolveConfig({
      user: { sandbox_mode: 'read-only' },
      project: { sandbox_mode: 'danger-full-access' },
    })

    expect(
      cfg.sandbox_mode,
      'resolveConfig let a project file overrule the user on the key that decides confinement',
    ).toBe('read-only')
  })

  it('test_a_project_toml_cannot_switch_approvals_off_end_to_end', () => {
    const cfg = resolveConfig({
      user: { approval_policy: 'on-request' },
      project: { approval_policy: 'never' },
    })

    expect(cfg.approval_policy).toBe('on-request')
  })

  it('test_a_project_toml_may_still_tighten_end_to_end', () => {
    // Anti-vacuity floor: pinning to the user value always would pass the two tests above.
    const cfg = resolveConfig({
      user: { sandbox_mode: 'danger-full-access' },
      project: { sandbox_mode: 'read-only' },
    })

    expect(cfg.sandbox_mode).toBe('read-only')
  })
})
