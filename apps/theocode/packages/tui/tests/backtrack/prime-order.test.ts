/**
 * B-029 — the rewind arms with the data already set, not before it.
 *
 * `primeBacktrack` called `setRewindPrimed(true)` FIRST and then `setRewindCount` /
 * `setRewindNth` / `setRewindPreviews`. The TUI adapter builds the ladder inside `setRewindPrimed`,
 * so it captured a count of 0 and an empty preview list — the state that existed at the moment the
 * flag was raised, not the state the flag was announcing.
 *
 * The consequence is on live paths and it kills the feature: `BacktrackOverlay` returns null on an
 * empty preview list so nothing draws, and `stepBacktrack(-1, 0)` returns null so the second Esc
 * emits `reset-backtrack`. Esc-rewind was dead.
 *
 * The "armed" flag is the LAST thing to set, because it is what makes the rest observable. This is
 * an ordering contract, so it is asserted as one — a test that only checked the final values would
 * pass on the broken code, since every setter did eventually run.
 */
import { describe, expect, it, vi } from 'vitest'

import { primeBacktrack } from '../../src/backtrack/backtrack.js'

vi.mock('@theocode/agent/session', () => ({
  readUserTurnPreviewsAsync: () => Promise.resolve(['first turn', 'second turn', 'third turn']),
  legacyRootHint: () => undefined,
  forkSessionBeforeUserTurn: () => undefined,
}))

/** Records the order in which the state setters are called, with the value each received. */
function recordingDeps(): { calls: string[]; deps: Parameters<typeof primeBacktrack>[0] } {
  const calls: string[] = []
  const record =
    (name: string) =>
    (v: unknown): void => {
      calls.push(`${name}=${JSON.stringify(typeof v === 'function' ? '<fn>' : v)}`)
    }
  return {
    calls,
    deps: {
      currentSessionId: () => 'tui-1',
      setRewindPrimed: record('primed'),
      setRewindCount: record('count'),
      setRewindNth: record('nth'),
      setRewindPreviews: record('previews'),
      setToast: () => undefined,
    } as unknown as Parameters<typeof primeBacktrack>[0],
  }
}

describe('B-029 — priming sets the data before it announces it is armed', () => {
  it('test_the_armed_flag_is_raised_after_the_window_is_set', async () => {
    const { calls, deps } = recordingDeps()

    await primeBacktrack(deps)

    const primed = calls.findIndex((c) => c.startsWith('primed='))
    const count = calls.findIndex((c) => c.startsWith('count='))
    const previews = calls.findIndex((c) => c.startsWith('previews='))

    expect(primed, 'the armed flag was never raised').toBeGreaterThanOrEqual(0)
    expect(
      primed,
      'armed was announced BEFORE the turn count, so a consumer reading state on that signal saw 0',
    ).toBeGreaterThan(count)
    expect(
      primed,
      'armed was announced BEFORE the previews, so the overlay had an empty list to draw',
    ).toBeGreaterThan(previews)
  })

  it('test_every_setter_still_receives_the_measured_window', async () => {
    // Anti-vacuity floor: never arming at all would satisfy the ordering assertions above.
    const { calls, deps } = recordingDeps()

    await primeBacktrack(deps)

    expect(calls).toContain('count=3')
    expect(calls.some((c) => c.startsWith('previews=') && c.includes('third turn'))).toBe(true)
  })
})
