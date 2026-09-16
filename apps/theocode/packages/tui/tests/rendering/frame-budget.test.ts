/**
 * B-010 — the coalescing window is DERIVED from the frame rate, and stays that way.
 *
 * The library's `useCoalesced` defaults to 34ms, which equals `ceil(1000 / 30)` — but only
 * because `TUI_MAX_FPS` happens to be 30 today. Taking that default would turn one derived pair
 * into two constants that agree by coincidence, and the next person to change the frame rate
 * would move one of them.
 *
 * The library owns the coalescing BEHAVIOUR and tests it. This owns the one fact the library
 * cannot know: that the two numbers here are one number.
 */
import { describe, expect, it } from 'vitest'

import { TUI_MAX_FPS, coalesceWindowMs } from '../../src/rendering/frame-budget.js'

describe('B-010 — the window follows the frame rate', () => {
  it('test_the_coalescing_window_is_derived_from_the_frame_rate', () => {
    expect(coalesceWindowMs(TUI_MAX_FPS)).toBe(Math.max(1, Math.ceil(1000 / TUI_MAX_FPS)))
  })

  it('test_a_different_frame_rate_moves_the_window', () => {
    // The anti-coincidence assertion. A hardcoded 34 passes the test above at 30fps and fails
    // here, which is the entire reason this file exists.
    expect(coalesceWindowMs(60)).toBe(17)
    expect(coalesceWindowMs(10)).toBe(100)
  })

  it('test_a_zero_frame_rate_means_no_coalescing', () => {
    // `maxFps: 0` is ink's "unthrottled". Deriving `1000/0 = Infinity` and handing that to the
    // hook would freeze the surface forever, so zero maps to zero — every update passes through.
    expect(coalesceWindowMs(0)).toBe(0)
  })
})
