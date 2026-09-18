import { startSessionSweepInBackground } from './auto-runtime.js'
import { startupNoticeFor } from './auto-runtime.js'

/**
 * Start the background sweep so that nothing it touches can take the terminal down.
 *
 * `enabled` is a FUNCTION and not a boolean, and that is the whole design. The value comes from
 * `resolveEffectiveConfig`, which THROWS on a malformed `~/.theocode/config.toml`; reading it at the
 * call site would evaluate it outside this guard, which is exactly where the throw used to escape.
 * A `.catch` could never have helped either — the throw happens while the argument object is being
 * built, before any promise exists.
 *
 * The stakes are the reason this is a named function rather than an inline try. By the time the
 * sweep starts, `render()` has already claimed the terminal, so an escaping throw kills a UI the
 * user is looking at — because of a typo in a config file, on a code path that only does
 * housekeeping. The README states this as a guarantee ("housekeeping never takes the agent down")
 * and until now it was stated in prose and nowhere else: the wrapping try lived in `main.tsx`, a
 * file at 0% coverage.
 *
 * Skipping is reported, never silent. A collector that stops running without saying so is the
 * failure B-138 was about, reached through a different door.
 */
export function guardedSweepStart(opts: {
  /** Read INSIDE the guard — see above. */
  readonly enabled: () => boolean
  readonly onReport: (line: string) => void
  /** Injected in tests; production passes the real starter. */
  readonly start?: (o: {
    enabled: boolean
    onReport: (line: string) => void
    maxAgeDays?: number
  }) => { started: boolean; reason: string }
  /**
   * #736 — the retention window, read INSIDE the guard for the same reason `enabled` is: the config
   * read throws on a malformed file, and a throw here kills the terminal at startup.
   */
  readonly maxAgeDays?: () => number | undefined
}): void {
  try {
    const start = opts.start ?? startSessionSweepInBackground
      const days = opts.maxAgeDays?.()
      const outcome = start({
        enabled: opts.enabled(),
        onReport: opts.onReport,
        ...(days === undefined ? {} : { maxAgeDays: days }),
      })
    const notice = startupNoticeFor(outcome)
    if (notice !== undefined) opts.onReport(notice)
  } catch (err) {
    opts.onReport(
      `[sessions gc] skipped — ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
