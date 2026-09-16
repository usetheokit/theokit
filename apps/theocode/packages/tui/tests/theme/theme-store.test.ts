/**
 * #72 — `/theme light` survives the next launch.
 *
 * This reverses a position the code argued: "a durable preference belongs in `THEOCODE_THEME` where
 * it can be reviewed". The reasoning was about REVIEWABILITY, and a file under the operator's own
 * state directory is at least as reviewable as an environment variable — more so, because it is
 * written by the command the operator actually typed, rather than by a line they must first learn
 * exists and then add to a shell profile. A user who types `/theme light`, sees it applied, and
 * finds dark at the next launch has not been protected by that reviewability; they have been told
 * about it in a toast and left to act on it.
 *
 * Precedence is unchanged where it was already decided. `NO_COLOR` still outranks everything — it is
 * an accessibility signal from the environment. `THEOCODE_THEME` outranks the stored value for the
 * same reason `THEOKIT_HOME` outranks `home_dir`: someone who exports a variable for this invocation
 * is addressing this invocation, and a stored preference that silently won would make the variable
 * inert.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveThemeBase } from '../../src/theme/theme-base.js'
import { storeThemeBase, storedThemeBase, themeStorePath } from '../../src/theme/theme-store.js'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-theme-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('#72 — the stored theme', () => {
  it('test_what_was_stored_is_what_comes_back', () => {
    storeThemeBase('light', home, {})

    expect(storedThemeBase(home, {})).toBe('light')
  })

  it('test_it_lives_in_the_unified_state_directory', () => {
    expect(themeStorePath(home, {})).toBe(join(home, '.theokit', 'tui-theme'))
  })

  it('test_it_follows_the_configured_root', () => {
    expect(themeStorePath(home, { THEOKIT_HOME: join(home, '.claude') })).toBe(
      join(home, '.claude', 'tui-theme'),
    )
  })

  it('test_nothing_stored_is_undefined_not_a_default', () => {
    // `undefined` and `'dark'` are different facts: the second would make the resolver report
    // `stored` as the source for a preference nobody expressed.
    expect(storedThemeBase(home, {})).toBeUndefined()
  })

  it('test_a_corrupt_file_is_ignored_rather_than_fatal', () => {
    mkdirSync(join(home, '.theokit'), { recursive: true })
    writeFileSync(join(home, '.theokit', 'tui-theme'), 'drak\n')

    expect(storedThemeBase(home, {})).toBeUndefined()
  })

  it('test_storing_twice_replaces_rather_than_appends', () => {
    storeThemeBase('light', home, {})
    storeThemeBase('no-color', home, {})

    expect(readFileSync(themeStorePath(home, {}), 'utf8').trim()).toBe('no-color')
    expect(storedThemeBase(home, {})).toBe('no-color')
  })
})

describe('#72 — where the stored theme sits in the precedence', () => {
  it('test_it_decides_when_the_environment_is_silent', () => {
    expect(resolveThemeBase({}, 'light')).toEqual({ base: 'light', source: 'stored' })
  })

  it('test_an_explicit_variable_still_wins', () => {
    expect(resolveThemeBase({ THEOCODE_THEME: 'dark' }, 'light').base).toBe('dark')
  })

  it('test_no_color_still_wins_over_everything', () => {
    expect(resolveThemeBase({ NO_COLOR: '1', THEOCODE_THEME: 'light' }, 'light').base).toBe(
      'no-color',
    )
  })

  it('test_a_rejected_variable_is_still_named_and_does_not_fall_through_to_the_store', () => {
    // The typo has to stay visible. Falling back to the stored value would apply a colour the user
    // did not ask for on this run, while the thing they typed wrong disappears from the report.
    const r = resolveThemeBase({ THEOCODE_THEME: 'drak' }, 'light')
    expect(r.invalid).toBe('drak')
    expect(r.base).toBe('light')
    expect(r.source).toBe('stored')
  })

  it('test_nothing_anywhere_is_still_the_default', () => {
    expect(resolveThemeBase({}, undefined)).toEqual({ base: 'dark', source: 'default' })
  })
})
