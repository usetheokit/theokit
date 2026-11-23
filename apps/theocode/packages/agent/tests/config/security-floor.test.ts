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
import { MORE_PERMISSIVE } from '../../src/config/security-floor.js'

const sandbox = (layers: Parameters<typeof resolveConfig>[0]) => resolveConfig(layers).sandbox_mode
const approval = (layers: Parameters<typeof resolveConfig>[0]) =>
  resolveConfig(layers).approval_policy

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

  it('test_a_project_local_file_cannot_widen_the_sandbox', () => {
    expect(
      sandbox({
        user: { sandbox_mode: 'read-only' },
        projectLocal: { sandbox_mode: 'danger-full-access' },
      }),
    ).toBe('read-only')
  })

  it('test_a_project_cannot_stop_the_agent_from_asking', () => {
    expect(
      approval({ user: { approval_policy: 'on-request' }, project: { approval_policy: 'never' } }),
      '`never` means "run without asking" — a repository must not be able to choose that for the user',
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
      approval({ user: { approval_policy: 'never' }, project: { approval_policy: 'untrusted' } }),
    ).toBe('untrusted')
  })
})

describe('B-006 — the operator keeps control', () => {
  it('test_the_cli_may_still_loosen_for_one_session', () => {
    expect(
      sandbox({ user: { sandbox_mode: 'read-only' }, cli: { sandbox_mode: 'danger-full-access' } }),
      'the threat model is a repository or an inherited environment, not the person typing the flag',
    ).toBe('danger-full-access')
  })

  it('test_a_managed_policy_outranks_the_cli', () => {
    expect(
      sandbox({
        user: { sandbox_mode: 'danger-full-access' },
        cli: { sandbox_mode: 'danger-full-access' },
        managed: { sandbox_mode: 'read-only' },
      }),
    ).toBe('read-only')
  })

  it('test_with_no_user_setting_the_lower_layers_still_apply', () => {
    // Anti-vacuity: a resolver that always returned the user value would pass the tests above.
    expect(
      sandbox({ user: { sandbox_mode: 'read-only' }, cli: { sandbox_mode: 'workspace-write' } }),
    ).toBe('workspace-write')
  })
})

describe('B-006 — the ceiling descends and only ever descends', () => {
  it('test_a_hardened_ceiling_binds_the_next_restricted_layer', () => {
    // `project` tightens to read-only, and `projectLocal` must then be measured against read-only
    // rather than against the user's danger-full-access.
    expect(
      sandbox({
        user: { sandbox_mode: 'danger-full-access' },
        project: { sandbox_mode: 'read-only' },
        projectLocal: { sandbox_mode: 'workspace-write' },
      }),
    ).toBe('read-only')
  })

  it('test_an_unknown_value_in_a_restricted_layer_is_refused', () => {
    // A typo in a repository's config must not become the effective setting; the schema refuses it.
    expect(() =>
      sandbox({
        user: { sandbox_mode: 'read-only' },
        project: { sandbox_mode: 'danger_full_access' },
      }),
    ).toThrow(/sandbox_mode/)
  })

  it('test_the_user_may_still_loosen_the_default', () => {
    expect(sandbox({ user: { sandbox_mode: 'danger-full-access' } })).toBe('danger-full-access')
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
