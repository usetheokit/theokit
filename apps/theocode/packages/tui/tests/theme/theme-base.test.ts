/**
 * B-073 — the theme base is resolved, not hardcoded.
 *
 * The base handed to the provider was the literal `'dark'`, while the toolkit's own type admits
 * `'dark' | 'light' | 'no-color'`. A light-terminal user had no recourse, and `no-color` — the
 * value a piped, logged or screen-reader-driven terminal wants — was unreachable from outside the
 * source file.
 *
 * `NO_COLOR` is reused rather than invented: it is an existing cross-tool convention
 * (no-color.org), so honouring it costs one branch and works for users who already set it. It wins
 * over the product's own knob deliberately — it is an accessibility signal from the environment,
 * and a user who wants colour back unsets it rather than fighting two settings.
 *
 * The resolver takes its environment as an argument. Reading `process.env` inside would make every
 * test order-dependent, which `rules/testing.md` § 6 names outright.
 *
 * What this file still owns after `/theme` learned to switch: the DEFAULT. The session override
 * sits in front of this answer and is proved separately (`theme-session.test.tsx`); nothing below
 * should start asserting on it, or the environment's own precedence stops being tested at all.
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_THEME_BASE, resolveThemeBase } from '../../src/theme/theme-base.js'

describe('B-073 — theme base resolution', () => {
  it('test_defaults_to_dark_when_nothing_is_set', () => {
    // The floor: the change must not repaint anybody's terminal on upgrade.
    const r = resolveThemeBase({})
    expect(r.base).toBe('dark')
    expect(r.base).toBe(DEFAULT_THEME_BASE)
    expect(r.source).toBe('default')
  })

  it('test_theocode_theme_selects_light_and_no_color', () => {
    expect(resolveThemeBase({ THEOCODE_THEME: 'light' }).base).toBe('light')
    expect(resolveThemeBase({ THEOCODE_THEME: 'no-color' }).base).toBe('no-color')
    expect(resolveThemeBase({ THEOCODE_THEME: 'light' }).source).toBe('THEOCODE_THEME')
  })

  it('test_theocode_theme_is_case_and_space_insensitive', () => {
    // Matches `parseEffort`, which trims and lowercases. A knob that rejects ` Light` while
    // accepting `light` teaches nothing and only costs the user a support round.
    expect(resolveThemeBase({ THEOCODE_THEME: '  LIGHT ' }).base).toBe('light')
  })

  it('test_no_color_forces_no_color_whatever_its_value', () => {
    // no-color.org: present and non-empty is the signal; the VALUE carries no meaning.
    for (const value of ['1', 'true', 'anything']) {
      expect(resolveThemeBase({ NO_COLOR: value }).base).toBe('no-color')
    }
    expect(resolveThemeBase({ NO_COLOR: '1' }).source).toBe('NO_COLOR')
  })

  it('test_empty_no_color_is_not_the_signal', () => {
    // Also per the convention: an empty value does NOT mean "no colour". Getting this backwards
    // would strip colour from every shell that exports the variable empty.
    expect(resolveThemeBase({ NO_COLOR: '' }).base).toBe('dark')
  })

  it('test_no_color_wins_over_the_product_knob', () => {
    expect(resolveThemeBase({ NO_COLOR: '1', THEOCODE_THEME: 'light' }).base).toBe('no-color')
  })

  it('test_an_invalid_value_is_reported_not_swallowed', () => {
    // Falls back so a typo cannot kill the session, but the typo is RETURNED so the caller can say
    // so. Silently rendering dark after being asked for `drak` is the swallowed error
    // `rules/error-handling.md` forbids.
    const r = resolveThemeBase({ THEOCODE_THEME: 'drak' })
    expect(r.base).toBe(DEFAULT_THEME_BASE)
    expect(r.source).toBe('default')
    expect(r.invalid).toBe('drak')
  })

  it('test_a_valid_value_reports_no_error', () => {
    // Anti-vacuity: a resolver that always reported an error would pass the test above.
    expect(resolveThemeBase({ THEOCODE_THEME: 'light' }).invalid).toBeUndefined()
    expect(resolveThemeBase({}).invalid).toBeUndefined()
  })
})

/**
 * The wiring half. A resolver nothing reads is dead code, and an `invalid` field nothing reports is
 * the swallowed error wearing a struct — so the status panel is asserted here, at the seam where a
 * user actually asks "why is it this colour?".
 */
describe('B-073 — the resolution reaches the user', () => {
  it('test_status_panel_reports_the_theme_and_its_source', async () => {
    const { statusPanel } = await import('../../src/commands/command-content.js')
    const { THEME_RESOLUTION } = await import('../../src/theme/theme.js')

    const panel = statusPanel(
      {
        sessionModel: () => 'gpt-5.4',
        effort: () => 'medium',
        cfg: () => ({
          modelLabel: 'gpt-5.4',
          sandboxLabel: 'sandbox:workspace-write',
          sandboxDetail: 'workspace-write',
          contextWindow: { window: 200_000, source: 'catalogue' },
        }),
      } as never,
      'suggest',
      () => 'session-1',
      { backend: () => ({ activeSessionCount: () => 0 }) } as never,
      // Without a wiring record the panel reads the rules off disk, which makes this file's
      // coverage depend on the machine (B-161). This test is about the theme row.
      {
        agentsMd: { active: [], requested: [], suppressedByTrust: false },
        rules: { count: 0, read: 0 },
      } as never,
    )

    // Matched WITHOUT the padding. The column width is computed from the widest label now, so a
    // literal run of spaces here would turn this test red every time a row is added — which is a
    // fact about alignment, and alignment is `status-panel.test.ts`'s subject, not this file's.
    expect(panel.body).toMatch(new RegExp(`theme: +${THEME_RESOLUTION.base}`))
    expect(panel.body).toContain(THEME_RESOLUTION.source)
  })
})
