/**
 * Custom themes — Claude Code's `~/.claude/themes/*.json`, read into this product's theme.
 *
 * Format measured against `code.claude.com/docs/en/terminal-config.md` on 2026-09-07:
 * `{ name?, base?, overrides? }`, six documented base names, ~40 flat colour tokens, and colour
 * values in five notations.
 *
 * The two vocabularies do NOT line up, and pretending otherwise is the failure mode here. Theirs is
 * ~40 flat tokens; the toolkit's is a structured `{ accent, status, diff, role, code, toolStatus }`.
 * Six tokens map with confidence. Every other token, and every colour notation this product cannot
 * render, is REPORTED BY NAME rather than dropped — a theme that silently applies a sixth of itself
 * teaches an operator that the rest arrived.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadCustomTheme, listCustomThemes } from '../../src/theme/custom-theme.js'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-theme-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function theme(slug: string, body: unknown): void {
  mkdirSync(join(home, '.claude', 'themes'), { recursive: true })
  writeFileSync(join(home, '.claude', 'themes', `${slug}.json`), JSON.stringify(body))
}

describe('finding themes', () => {
  it('test_the_slug_is_the_filename', () => {
    theme('midnight', { name: 'Midnight' })
    expect(listCustomThemes(home)).toEqual([{ slug: 'midnight', name: 'Midnight' }])
  })

  it('test_a_theme_without_a_name_is_listed_by_its_slug', () => {
    theme('midnight', {})
    expect(listCustomThemes(home)).toEqual([{ slug: 'midnight', name: 'midnight' }])
  })

  it('test_no_themes_directory_is_not_an_error', () => {
    expect(listCustomThemes(home)).toEqual([])
  })

  it('test_malformed_json_is_skipped_rather_than_taking_the_others_with_it', () => {
    mkdirSync(join(home, '.claude', 'themes'), { recursive: true })
    writeFileSync(join(home, '.claude', 'themes', 'broken.json'), '{ not json')
    theme('good', { name: 'Good' })
    expect(listCustomThemes(home).map((t) => t.slug)).toEqual(['good'])
  })
})

describe('the base', () => {
  it('test_dark_and_light_map_straight_across', () => {
    theme('d', { base: 'dark' })
    theme('l', { base: 'light' })
    expect(loadCustomTheme('d', home)?.prop.base).toBe('dark')
    expect(loadCustomTheme('l', home)?.prop.base).toBe('light')
  })

  it('test_a_variant_this_product_lacks_keeps_the_light_dark_axis_and_says_what_was_lost', () => {
    // `dark-daltonized` IS dark; falling back to the default would repaint a light-terminal user's
    // screen over an accessibility variant we cannot reproduce. Keeping the axis and naming the loss
    // is the honest half.
    const loaded = loadCustomTheme('dd', home)
    theme('dd', { base: 'dark-daltonized' })
    const again = loadCustomTheme('dd', home)

    expect(loaded).toBeNull()
    expect(again?.prop.base).toBe('dark')
    expect(again?.notApplied.join(' ')).toContain('dark-daltonized')
  })

  it('test_an_absent_base_defaults_to_dark_as_their_docs_say', () => {
    theme('x', { overrides: { claude: '#ff0000' } })
    expect(loadCustomTheme('x', home)?.prop.base).toBe('dark')
  })
})

describe('the overrides that map', () => {
  it('test_the_six_tokens_with_a_home_reach_the_theme', () => {
    theme('x', {
      overrides: {
        claude: '#111111',
        error: '#222222',
        success: '#333333',
        warning: '#444444',
        diffAdded: '#555555',
        diffRemoved: '#666666',
      },
    })
    const o = loadCustomTheme('x', home)?.prop.override

    expect(o?.accent).toBe('#111111')
    expect(o?.status).toEqual({ error: '#222222', success: '#333333', warning: '#444444' })
    expect(o?.diff).toEqual({ addedBg: '#555555', removedBg: '#666666' })
  })

  it('test_a_token_with_no_home_here_is_named_rather_than_dropped', () => {
    theme('x', { overrides: { rate_limit_fill: '#abcdef', claude: '#111111' } })
    const loaded = loadCustomTheme('x', home)

    expect(loaded?.notApplied.join(' ')).toContain('rate_limit_fill')
    expect(loaded?.notApplied.join(' '), 'a token that DID apply was reported as lost').not.toContain(
      'claude',
    )
  })

  it('test_a_colour_notation_this_product_cannot_render_is_named_rather_than_forwarded', () => {
    // Their docs allow `rgb()`, `ansi256(n)` and `ansi:<name>`. The toolkit takes a string and
    // renders it through ink; forwarding a notation nobody verified would produce a colour that is
    // wrong, or no colour at all, with nothing said. Hex is what is known to work here.
    theme('x', { overrides: { claude: 'ansi256(42)' } })
    const loaded = loadCustomTheme('x', home)

    expect(loaded?.prop.override?.accent).toBeUndefined()
    expect(loaded?.notApplied.join(' ')).toContain('ansi256(42)')
  })

  it('test_short_hex_is_accepted_too', () => {
    theme('x', { overrides: { claude: '#f00' } })
    expect(loadCustomTheme('x', home)?.prop.override?.accent).toBe('#f00')
  })

  it('test_overrides_that_are_not_an_object_apply_nothing_and_crash_nothing', () => {
    // A hand-written file can put anything under `overrides`. An array or a string is not a token
    // map: nothing applies, nothing is reported token-by-token (there are no tokens to name), and
    // the theme still loads on its base.
    theme('x', { overrides: ['#111111'] as unknown as Record<string, string> })
    const loaded = loadCustomTheme('x', home)

    expect(loaded?.prop.override).toBeUndefined()
    expect(loaded?.notApplied).toEqual([])
  })

  it('test_a_theme_that_overrides_nothing_reports_nothing', () => {
    // Anti-vacuity floor for the reporting arms above.
    theme('x', { base: 'light' })
    expect(loadCustomTheme('x', home)?.notApplied).toEqual([])
  })
})
