/** The render rate handed to ink as `maxFps` (`main.tsx`). `0` means unthrottled. */
export const TUI_MAX_FPS = 30

/**
 * The coalescing window for a given frame rate — one frame, rounded up.
 *
 * B-010 — the coalescing behaviour now comes from `@theokit/tui`'s `useCoalesced`, whose default
 * window is 34ms. That equals `ceil(1000 / 30)` and would have made this file deletable — but only
 * while `TUI_MAX_FPS` is 30. Taking the default converts ONE derived pair into TWO constants that
 * agree by coincidence, and the next change to the frame rate moves one of them. So the derivation
 * stays here and the window is passed explicitly.
 *
 * `0` maps to `0` rather than to `Infinity`: ink reads `maxFps: 0` as unthrottled, and handing an
 * infinite window to the hook would mean the surface never recomputes again — a frozen UI is not
 * the natural reading of "no frame limit".
 *
 * Screen-reader mode is deliberately NOT handled here. The local copy read `INK_SCREEN_READER` at
 * MODULE LOAD, which a test cannot change; the library reads it per call for exactly that reason,
 * and a zero window there passes every update through (ADR D2).
 */
export function coalesceWindowMs(maxFps: number): number {
  if (maxFps <= 0) return 0
  return Math.max(1, Math.ceil(1000 / maxFps))
}
