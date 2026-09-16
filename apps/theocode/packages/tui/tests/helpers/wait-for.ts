/**
 * Wait for a CONDITION, with a deadline — the replacement for the fixed sleeps this suite used to
 * synchronise on.
 *
 * Four render tests slept a guess: 60 ms between rerenders so `useCoalesced` could close its 34 ms
 * window, 20 ms for an async `/resume`, and a `painted()` of 50 ms in two files so Ink could commit.
 * Every one of those numbers is a bet on the scheduler, taken on a runner this repository configures
 * for `cpus - 4` parallel workers and documents (`vitest.config.ts`) as stretching a 700 ms test to
 * 5 100 ms under load. The bet fails in the honest direction — the frame has not painted yet, so the
 * assertion reads an empty timeline, which looks exactly like the bug under test — but a red that
 * means "the test asked too early" is still a red nobody can act on.
 *
 * Polling removes the bet from both ends. The wait ends the instant the condition holds, so the
 * common case is faster than the sleep it replaces, and the slow case gets a whole second rather
 * than a fixed 50 ms. When the condition never holds, the failure NAMES it: `the timeline to include
 * the restored turn` says what did not happen, where `expected [] to contain 'earlier turn'` sends
 * the reader to look for a rendering bug that is not there.
 *
 * NOT `vi.useFakeTimers`. It is the other remedy for exactly this, and for a pure time-bounded
 * coalescer it would be the better one — but Ink schedules its own frame writes on the same timers,
 * so faking them means driving the renderer's clock by hand from the test. That trades a scheduling
 * dependency for a dependency on the library's internal scheduling, which is the more brittle of the
 * two and the harder to read. No test file in this repository fakes timers today, and this is not
 * the change to make it the first.
 */
export async function waitFor(
  condition: () => boolean,
  /** What is being waited for, phrased so `waiting for <what>` reads as a sentence in the failure. */
  what: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  // A whole second, against frames budgeted at 34 ms: generous enough that contention cannot reach
  // it, short enough that a genuine failure is reported rather than waited out to the 20 s
  // `testTimeout`, where the message would be the runner's rather than this one.
  const timeoutMs = opts.timeoutMs ?? 1_000
  const intervalMs = opts.intervalMs ?? 5
  const deadline = Date.now() + timeoutMs
  // Checked BEFORE the first sleep: a condition that already holds must cost nothing, or the helper
  // is a sleep again with a longer docblock.
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${String(timeoutMs)}ms waiting for ${what} — the condition never held, ` +
          `so nothing downstream of it was ever observed`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
