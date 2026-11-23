/**
 * B-011 → B-004 — the backtrack window WAS centred by hand; both reasons for that are now gone.
 *
 * The original record (B-011) said the divergence from the library's `windowFor` was deliberate and
 * named the two conditions under which it would end:
 *
 * - `windowFor` was a TRAILING window (active row at the bottom), and this view needs a CENTRED one.
 * - `WindowView` reported overflow as `overflowUp` / `overflowDown` BOOLEANS, and the overlay
 *   renders "N hidden" — a boolean cannot be recovered into a count.
 *
 * Measured in `@theokit/tui@0.67.0`, both now hold: `windowFor(count, selectionIndex, window,
 * "centred")` takes an anchor, and `WindowView` carries `hiddenBefore` / `hiddenAfter` as counts.
 * The record is kept rather than deleted, because it is what turned "two windowings, probably a
 * mistake" into a dated decision with an expiry — and the expiry arrived.
 *
 * These tests moved from the pure `windowAroundSelection` to the RENDERED overlay, because that is
 * what the DoD is about: selection centred, counts on both sides. The window arithmetic now lives
 * upstream and is tested there; what stays here is the composition, which is nobody else's.
 */
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { BacktrackOverlay } from '../../src/backtrack/BacktrackOverlay.js'

const previews = (n: number): string[] => Array.from({ length: n }, (_, i) => `turn-${i}`)

const frameOf = (node: Parameters<typeof render>[0]): string => {
  const instance = render(node)
  const frame = instance.lastFrame() ?? ''
  instance.unmount()
  return frame
}

describe('B-004 — the backtrack overlay windows through the library, and still reads the same', () => {
  it('test_the_selection_sits_mid_window_not_at_the_bottom', () => {
    const frame = frameOf(
      <BacktrackOverlay previews={previews(20)} selected={10} count={20} maxRows={5} />,
    )

    // Trailing would put turn-10 on the last visible line. Centred puts it in the middle.
    const lines = frame.split('\n').filter((l) => l.includes('turn-'))
    expect(lines).toHaveLength(5)
    expect(lines[2]).toContain('turn-10')
    expect(lines.at(-1)).not.toContain('turn-10')
  })

  it('test_it_reports_how_many_are_hidden_not_merely_that_some_are', () => {
    const frame = frameOf(
      <BacktrackOverlay previews={previews(20)} selected={10} count={20} maxRows={5} />,
    )

    // Counts, not "some are hidden". 20 items, 5 visible starting at 8 → 8 above, 7 below.
    expect(frame).toContain('8')
    expect(frame).toContain('7')
    expect(frame).toMatch(/▲\s*8/)
    expect(frame).toMatch(/▼\s*7/)
  })

  it('test_the_window_never_starts_before_the_head', () => {
    const frame = frameOf(
      <BacktrackOverlay previews={previews(20)} selected={0} count={20} maxRows={5} />,
    )

    expect(frame).toContain('turn-0')
    expect(frame).not.toMatch(/▲/)
  })

  it('test_the_window_never_runs_past_the_tail', () => {
    const frame = frameOf(
      <BacktrackOverlay previews={previews(20)} selected={19} count={20} maxRows={5} />,
    )

    expect(frame).toContain('turn-19')
    expect(frame).not.toMatch(/▼/)
  })

  it('test_a_list_that_fits_is_shown_whole', () => {
    const frame = frameOf(
      <BacktrackOverlay previews={previews(3)} selected={1} count={3} maxRows={5} />,
    )

    expect(frame).toContain('turn-0')
    expect(frame).toContain('turn-2')
    expect(frame).not.toMatch(/[▲▼]/)
  })

  it('test_an_empty_list_renders_nothing', () => {
    // Anti-vacuity floor: the guard clause has to survive refactors of everything below it.
    expect(frameOf(<BacktrackOverlay previews={[]} selected={0} count={0} maxRows={5} />)).toBe('')
  })

  it('test_the_rows_stay_numbered_so_the_header_refers_to_something', () => {
    // B-004 — the header says "message 11/20", and the rows carry the numbers it refers to. The
    // library's WindowedList renders row TEXT and no numbering, so the number is formatted into the
    // string the consumer passes. Losing it would break the correspondence the header depends on.
    const frame = frameOf(
      <BacktrackOverlay previews={previews(20)} selected={10} count={20} maxRows={5} />,
    )

    expect(frame).toContain('11. turn-10')
  })

  it('test_the_overlay_keeps_its_border', () => {
    // The library component draws no container, by design. An overlay needs to be visually separate
    // from the conversation behind it, so the consumer keeps its own bordered Box around it.
    const frame = frameOf(
      <BacktrackOverlay previews={previews(20)} selected={10} count={20} maxRows={5} />,
    )

    expect(frame).toMatch(/[╭╮╰╯│─]/)
  })
})
