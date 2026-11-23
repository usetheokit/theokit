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

import { ENV_BY_KEY, resolveConfig } from '../../src/config/config.js'
import { MORE_PERMISSIVE } from '../../src/config/security-floor.js'

const sandbox = (layers: Parameters<typeof resolveConfig>[0]) => resolveConfig(layers).sandbox_mode

describe('B-006 — project and env cannot loosen what the user set', () => {
  it('test_a_project_cannot_widen_the_sandbox', () => {
    expect(
      sandbox({
        user: { sandbox_mode: 'read-only' },
        project: { sandbox_mode: 'danger-full-access' },
      }),
      "a cloned repository handed itself full filesystem access over the user's own setting",
    ).toBe('read-only')
  })

  it('test_an_env_var_cannot_widen_the_sandbox', () => {
    expect(
      sandbox({
        user: { sandbox_mode: 'workspace-write' },
        env: { [ENV_BY_KEY.sandbox_mode!.env]: 'danger-full-access' },
      }),
    ).toBe('workspace-write')
  })

  it('test_a_project_cannot_stop_the_agent_from_asking', () => {
    expect(
      resolveConfig({
        user: { approval_policy: 'on-request' },
        project: { approval_policy: 'never' },
      }).approval_policy,
    ).toBe('on-request')
  })
})

describe('B-006 — hardening is always allowed', () => {
  it('test_a_project_may_tighten_the_sandbox', () => {
    expect(
      sandbox({
        user: { sandbox_mode: 'danger-full-access' },
        project: { sandbox_mode: 'read-only' },
      }),
    ).toBe('read-only')
  })

  it('test_a_project_may_ask_for_more_confirmation', () => {
    expect(
      resolveConfig({
        user: { approval_policy: 'never' },
        project: { approval_policy: 'untrusted' },
      }).approval_policy,
    ).toBe('untrusted')
  })
})

describe('B-006 — the operator keeps control', () => {
  it('test_the_cli_may_still_loosen_for_one_session', () => {
    expect(
      sandbox({ user: { sandbox_mode: 'read-only' }, cli: { sandbox_mode: 'danger-full-access' } }),
    ).toBe('danger-full-access')
  })

  it('test_with_no_user_setting_the_lower_layers_still_apply', () => {
    expect(sandbox({ project: { sandbox_mode: 'workspace-write' } })).toBe('workspace-write')
  })

  it('test_a_managed_policy_outranks_the_cli', () => {
    expect(
      sandbox({
        cli: { sandbox_mode: 'danger-full-access' },
        managed: { sandbox_mode: 'read-only' },
      }),
    ).toBe('read-only')
  })
})

describe('B-006 — the ceiling descends and only ever descends', () => {
  it('test_a_hardened_ceiling_binds_the_next_restricted_layer', () => {
    expect(
      sandbox({
        user: { sandbox_mode: 'danger-full-access' },
        project: { sandbox_mode: 'read-only' },
        env: { [ENV_BY_KEY.sandbox_mode!.env]: 'workspace-write' },
      }),
    ).toBe('read-only')
  })

  it('test_an_unknown_value_in_a_restricted_layer_is_refused', () => {
    expect(() =>
      sandbox({
        user: { sandbox_mode: 'read-only' },
        project: { sandbox_mode: 'danger_full_access' } as never,
      }),
    ).toThrow()
  })

  it('test_the_default_is_the_ceiling_when_the_user_said_nothing', () => {
    // Most users never write a config file: a repository must not widen the default for them.
    const base = sandbox({})
    expect(sandbox({ project: { sandbox_mode: 'danger-full-access' } })).toBe(base)
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
