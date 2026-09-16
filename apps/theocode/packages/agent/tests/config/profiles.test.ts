/**
 * B-041 — a project's profiles table does not erase the user's.
 *
 * The layer fold did `perfis = layer.profiles`: an assignment, not a merge. A user who defines
 * `profiles.fast` globally and selects `profile = "fast"` loses it the moment they open a project
 * whose config defines any profile at all — and the failure is hard, not silent:
 * `chosenProfile` then throws `unknown profile "fast"` for a config the user did not write.
 *
 * Most scalar keys are last-wins, which is the right rule for a scalar. `profiles` is a TABLE of
 * named entries, and last-wins applied to the whole table means an unrelated project deletes
 * definitions it never mentioned.
 */
import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../../src/config/config.js'

describe('B-041 — profiles accumulate across layers, per name', () => {
  it('test_a_user_profile_survives_a_project_that_defines_another', () => {
    const cfg = resolveConfig({
      user: { profile: 'fast', profiles: { fast: { reasoning_effort: 'low' } } },
      project: { profiles: { ci: { reasoning_effort: 'high' } } },
    })

    expect(
      cfg.reasoning_effort,
      'the project profiles table replaced the user one, so the selected profile vanished',
    ).toBe('low')
  })

  it('test_a_project_profile_overrides_a_user_profile_of_the_same_name', () => {
    // Merge is per NAME. A project that redefines `fast` still wins for `fast`, which is the
    // last-wins rule applied at the level it belongs to.
    const cfg = resolveConfig({
      user: { profile: 'fast', profiles: { fast: { reasoning_effort: 'low' } } },
      project: { profiles: { fast: { reasoning_effort: 'high' } } },
    })

    expect(cfg.reasoning_effort).toBe('high')
  })

  it('test_an_unknown_profile_is_still_an_error', () => {
    // Anti-vacuity floor: accepting any name would satisfy the assertions above.
    expect(() =>
      resolveConfig({ user: { profile: 'nope', profiles: { fast: { reasoning_effort: 'low' } } } }),
    ).toThrow(/unknown profile/)
  })
})
