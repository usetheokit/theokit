/**
 * B-011 — the welcome banner is the SDK's, not a hand-rolled copy of it.
 *
 * This component rebuilt the two-column welcome box by hand: the bordered frame, the fixed-width
 * left column, the gutter, and the right-hand panel. `WelcomeBanner` does all of that, and the
 * docstring of its `aside` prop names the two headings written out here — "Tips for getting started"
 * and "What's new" — because that prop was built for this layout.
 *
 * It could not be adopted before: `WelcomeBanner` had `aside` but no `art`, and `Banner` had `art`
 * but no `aside`, so neither could draw ASCII art beside a hints panel. Fixed upstream and released
 * as `@theokit/tui@0.50.0`.
 *
 * These tests assert what the user sees, not which component draws it — so the migration is provable
 * rather than assumed, and a future upstream change that drops one of these turns red here.
 */
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { Banner, fittedCwd } from '../../src/components/Banner.js'
import { AGENT } from '@theocode/shared/agent'
import { BANNER_TIPS, centred, LOGO, LOGO_COLUMNS, WIDE_COLS } from '../../src/theme/theme.js'

/**
 * The state of `process.stdout.columns` BEFORE any test in this file touched it. Captured at module
 * load because that is the only vantage point that can see the leak: the old cleanup leaked exactly
 * ONCE, on the first probe in the worker, and every later restore then looked correct. A test that
 * captured its own `before` compared the leaked value to itself and passed on the defect — measured
 * with a standalone probe rather than assumed (B-048).
 */
const PRISTINE_COLUMNS = Object.getOwnPropertyDescriptor(process.stdout, 'columns')

// eslint-disable-next-line no-control-regex -- the literal ESC below opens every ANSI sequence; matching it is the point
const ANSI = /\[[0-9;]*m/g
const strip = (s: string): string => s.replace(ANSI, '')

/**
 * Render at a chosen width.
 *
 * `ink-testing-library` builds its own stdout and hard-codes 100 columns; `WelcomeBanner` sizes its
 * box from that, and the gate in `Banner` now reads the same source. So the width has to be set on
 * the INSTANCE Ink was given, not only on the global — setting the global alone is what let a
 * 120-column gate decision be drawn into a 100-column box, which is the defect the containment
 * assertion below caught.
 *
 * The global is still set, because it is what a stale reader would reach for and leaving the two
 * disagreeing under test is how the original divergence hid.
 */
function frame(columns = WIDE_COLS): string {
  const original = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
  Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true })
  try {
    const instance = render(<Banner />)
    Object.defineProperty(instance.stdout, 'columns', { value: columns, configurable: true })
    instance.rerender(<Banner />)
    const out = strip(instance.lastFrame() ?? '')
    instance.unmount()
    return out
  } finally {
    // B-048 — restore BOTH ways. Under a non-TTY `process.stdout.columns` is undefined, so
    // `getOwnPropertyDescriptor` returns undefined and the old restore was skipped entirely: the
    // property stayed defined at 120 for whatever ran next in the same worker. Vitest runs files
    // concurrently in one process, so that leaks across files.
    if (original === undefined) delete (process.stdout as { columns?: number }).columns
    else Object.defineProperty(process.stdout, 'columns', original)
  }
}

describe('B-011 — the banner still shows everything it showed before', () => {
  it('test_the_ascii_logo_is_rendered', () => {
    const firstArtLine = LOGO.split('\n').find((l) => l.trim().length > 0) ?? ''

    expect(frame(), 'the ASCII wordmark disappeared from the welcome box').toContain(
      firstArtLine.trim().slice(0, 8),
    )
  })

  it('test_the_product_name_is_rendered', () => {
    expect(frame()).toContain(AGENT.name)
  })

  it('test_the_welcome_line_keeps_its_glyph', () => {
    // Caught by a render probe, not by this suite: migrating to WelcomeBanner I typed the wrong
    // Unicode escape and ✻ (U+273B) silently became ✛ (U+271B). Every presence assertion still
    // passed, because "Welcome to TheoCode" was there — the glyph is part of the identity too.
    expect(frame()).toContain('✻ Welcome to')
  })

  it('test_no_row_runs_past_the_border', () => {
    // Containment, not presence. The previous migration attempt passed every presence test while
    // the aside overflowed the right border — the text was there, just outside the frame.
    const rows = frame()
      .split('\n')
      .filter((l) => l.trim().length > 0)
    const border = rows.find((l) => l.includes('╭')) ?? ''

    expect(Math.max(...rows.map((l) => l.length))).toBeLessThanOrEqual(border.length)
  })

  it('test_the_model_is_rendered', () => {
    expect(frame()).toContain(AGENT.model)
  })

  it('test_the_tips_panel_is_rendered_on_a_wide_terminal', () => {
    const out = frame()

    expect(out).toContain('Tips for getting started')
    expect(out).toContain(BANNER_TIPS[0] ?? '')
  })

  it('test_the_whats_new_panel_is_rendered', () => {
    expect(frame()).toContain("What's new")
  })
})

describe('B-048 — the narrow branch is exercised, and the width probe leaves no trace', () => {
  it('test_the_threshold_is_the_narrowest_width_that_actually_fits', () => {
    // The gate and the box are sized from ONE source now, so the boundary is assertable rather
    // than eyeballed: at exactly `WIDE_COLS` the panel is drawn and nothing overflows; one column
    // below it, the panel is dropped instead of being squeezed past the border.
    const atThreshold = frame(WIDE_COLS)
    const border = atThreshold.split('\n').find((l) => l.includes('╭')) ?? ''

    expect(atThreshold).toContain(BANNER_TIPS[0] ?? '@@no-tips@@')
    expect(
      Math.max(...atThreshold.split('\n').map((l) => l.length)),
      'the panel is drawn at the threshold but does not fit inside it',
    ).toBeLessThanOrEqual(border.length)
    expect(frame(WIDE_COLS - 1)).not.toContain(BANNER_TIPS[0] ?? '@@no-tips@@')
  })

  it('test_a_narrow_terminal_drops_the_side_panel', () => {
    // The branch this file exists to keep visible, and the one that broke three times during the
    // 2026-08-07 remediation. Every other test here sets a WIDE terminal, so the narrow path was
    // never rendered at all.
    const narrow = frame(60)

    expect(narrow, 'the narrow terminal rendered nothing').not.toBe('')
    expect(
      narrow,
      'the tips panel was drawn on a 60-column terminal, where it cannot fit beside the art',
    ).not.toContain(BANNER_TIPS[0] ?? '@@no-tips@@')
  })

  it('test_a_wide_terminal_still_draws_the_side_panel', () => {
    // Anti-vacuity floor: never drawing the panel would satisfy the assertion above.
    expect(frame(WIDE_COLS)).toContain(BANNER_TIPS[0] ?? '@@no-tips@@')
  })

  it('test_the_width_probe_leaves_no_trace_in_the_worker', () => {
    frame(200)

    // Captured at MODULE LOAD, before any frame() call — which is the only vantage point that can
    // see this. The old cleanup leaked exactly ONCE, on the first probe in the worker: after that
    // `original` was the leaked value and every later restore looked correct. A test that captured
    // its own `before` therefore compared 120 to 120 and passed on the defect. Measured with a
    // standalone probe rather than assumed.
    expect(
      Object.getOwnPropertyDescriptor(process.stdout, 'columns'),
      'the probe left process.stdout.columns defined for whatever runs next in this worker',
    ).toEqual(PRISTINE_COLUMNS)
  })
})

describe('the banner carries what both reference agents put on screen', () => {
  it('test_the_build_version_is_shown', () => {
    // Codex prints `>_ OpenAI Codex (v0.147.0)`, Claude Code prints it in the top border
    // (`╭─── Claude Code v2.1.236 ───`). This showed it nowhere, so the only way to tell which
    // build you were running was to leave the TUI.
    expect(frame(), 'the banner does not say which build this is').toContain(`v${AGENT.version}`)
  })

  it('test_the_build_version_is_shown_on_a_NARROW_terminal_too', () => {
    // The branch that needs its own test. `WelcomeBanner` renders art OR name+version and never
    // both, so the two branches carry the version by different means — the tagline when the art is
    // drawn, the `version` prop when it is not. Either one alone shows the build at one width and
    // hides it at the other, and only a test at both widths can tell.
    expect(frame(WIDE_COLS - 1)).toContain(`v${AGENT.version}`)
  })

  it('test_the_wordmark_spells_the_PRODUCT_name', () => {
    // It used to spell `THEO` — the name of neither the product nor the framework. B-002 is the
    // item about this repository stating facts about itself that are not true, and a wordmark on
    // the first screen a user sees is the largest of them.
    const art = LOGO.split('\n')

    expect(art, 'the wordmark lost rows').toHaveLength(6)
    expect(
      art.every((row) => [...row].length === LOGO_COLUMNS),
      'the wordmark rows are ragged, so the art column is narrower than LOGO_COLUMNS and the ' +
        'centring computed against it is off',
    ).toBe(true)
  })

  it('test_the_two_columns_are_separated_by_a_rule', () => {
    const out = frame()
    const tipsRow = out.split('\n').find((l) => l.includes('Tips for getting started')) ?? ''

    // The divider is drawn by the aside's `borderLeft`, so it appears on the row the panel starts
    // on. Asserting on THAT row rather than anywhere in the frame keeps the box's own `│` borders
    // from satisfying it.
    expect(
      tipsRow.indexOf('│', 1),
      'no column divider between the art and the panel — the two columns run together',
    ).toBeGreaterThan(0)
  })

  it('test_the_aside_sections_are_separated_by_a_rule', () => {
    expect(
      frame(),
      'nothing separates "Tips for getting started" from "What\'s new"',
    ).toMatch(/─{10,}/)
  })
})

describe('the working directory survives the column it is drawn in', () => {
  it('test_a_path_that_fits_is_left_alone', () => {
    expect(fittedCwd(LOGO_COLUMNS, '~/work/app')).toBe('cwd: ~/work/app')
  })

  it('test_a_path_too_long_keeps_its_TAIL', () => {
    // The half that answers "which checkout am I in". `truncate-end` — what the SDK applies to a
    // hint — drops exactly this half, which is how the banner read `~/Projetos/theo/theokit-fram…`
    // on a machine holding five sibling checkouts.
    const narrow = fittedCwd(24, '~/src/theo/theokit-framework/usetheo-labs/TheoCode')

    expect(narrow, 'the truncation dropped the leaf instead of the ancestry').toContain('TheoCode')
    expect(narrow.startsWith('cwd: …'), 'the row stopped saying what it is').toBe(true)
    expect([...narrow].length).toBeLessThanOrEqual(24)
  })

  it('test_an_available_width_too_small_to_truncate_returns_the_label', () => {
    // Anti-vacuity: with no room for `cwd: ` plus an ellipsis there is nothing to shorten TO, and
    // returning an empty or malformed row would be worse than an overlong one.
    expect(fittedCwd(3, '~/work/app')).toBe('cwd: ~/work/app')
  })
})

describe('centred', () => {
  it('test_it_pads_both_sides_so_the_column_keeps_its_width', () => {
    // The right-hand padding is what `bannerArtWidth` measures. Padding only the left produced a
    // 32-wide column from a 46 request, and the cwd was truncated anyway.
    expect([...centred('x')].length).toBe(LOGO_COLUMNS)
  })

  it('test_a_line_wider_than_the_column_is_returned_unchanged', () => {
    const long = 'y'.repeat(LOGO_COLUMNS + 10)

    expect(centred(long)).toBe(long)
  })
})
