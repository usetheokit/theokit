/**
 * `/theme custom:<slug>` — selecting a theme from `~/.claude/themes/`.
 *
 * The naming is theirs: their docs say a custom theme "appears as `custom:<slug>` where `<slug>` is
 * the filename without `.json`". Inventing a different spelling for a feature read out of their
 * directory, in their format, would make the two halves disagree for no gain.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { handleTheme } from '../../src/commands/theme-command.js'
import { resetSessionThemeForTest, sessionThemeLabel } from '../../src/theme/theme-session.js'
import type { ToastPayload } from '../../src/screen-types.js'

let home: string
let toasts: ToastPayload[]

const NEVER_PERSISTED = (): boolean => false
const STORE = (): string => '(a store)'

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-theme-cmd-'))
  mkdirSync(join(home, '.claude', 'themes'), { recursive: true })
  toasts = []
})
afterEach(() => {
  resetSessionThemeForTest()
  rmSync(home, { recursive: true, force: true })
})

function theme(slug: string, body: unknown): void {
  writeFileSync(join(home, '.claude', 'themes', `${slug}.json`), JSON.stringify(body))
}

const push = (t: ToastPayload): void => {
  toasts.push(t)
}
const last = (): ToastPayload | undefined => toasts.at(-1)

describe('selecting a custom theme', () => {
  it('test_it_switches_and_the_label_names_the_file', () => {
    theme('midnight', { name: 'Midnight', base: 'dark' })

    handleTheme('custom:midnight', push, NEVER_PERSISTED, STORE, home)

    expect(sessionThemeLabel()).toBe('custom:midnight')
    expect(last()?.variant).toBe('success')
  })

  it('test_a_slug_with_no_file_is_refused_by_name', () => {
    // Never silently falling back to a base: an operator who typed a slug is asking for THAT theme,
    // and repainting to `dark` while reporting success is the shape that gets read as a render bug.
    handleTheme('custom:absent', push, NEVER_PERSISTED, STORE, home)

    expect(sessionThemeLabel()).toBeUndefined()
    expect(last()?.variant).toBe('error')
    expect(last()?.message).toContain('absent')
  })

  it('test_what_the_theme_asked_for_and_did_not_get_is_reported', () => {
    // The whole reason `loadCustomTheme` returns `notApplied`: six of their ~40 tokens map here.
    // A theme that silently applies a sixth of itself teaches an operator that the rest arrived.
    theme('loud', { base: 'dark', overrides: { rate_limit_fill: '#abcdef' } })

    handleTheme('custom:loud', push, NEVER_PERSISTED, STORE, home)

    expect(last()?.message).toContain('rate_limit_fill')
  })

  it('test_a_theme_with_nothing_lost_says_nothing_about_losses', () => {
    // Anti-vacuity for the arm above, and the noise argument: a permanent "0 not applied" suffix is
    // what makes people stop reading the toast.
    theme('clean', { base: 'light', overrides: { claude: '#ff0000' } })

    handleTheme('custom:clean', push, NEVER_PERSISTED, STORE, home)

    expect(last()?.message).not.toContain('not applied')
  })

  it('test_the_no_argument_report_lists_the_custom_themes_on_disk', () => {
    // Otherwise the feature is undiscoverable: nothing else tells an operator which slugs exist.
    theme('midnight', { name: 'Midnight' })

    handleTheme('', push, NEVER_PERSISTED, STORE, home)

    expect(last()?.message).toContain('custom:midnight')
  })

  it('test_the_report_says_nothing_extra_when_there_are_no_custom_themes', () => {
    handleTheme('', push, NEVER_PERSISTED, STORE, home)

    expect(last()?.message).not.toContain('custom:')
  })

  it('test_a_built_in_base_still_switches', () => {
    // Regression floor: the custom path must not have taken the ordinary one with it.
    handleTheme('light', push, NEVER_PERSISTED, STORE, home)

    expect(sessionThemeLabel()).toBe('light')
    expect(last()?.variant).toBe('success')
  })
})
