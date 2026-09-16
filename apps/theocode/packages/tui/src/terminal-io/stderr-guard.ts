import { installStderrGuard as install } from '@theokit/tui/terminal'

/**
 * Redirect `process.stderr.write` to a log file so a warning cannot corrupt the Ink frame (B-104).
 *
 * The implementation moved to `@theokit/tui/terminal`, including the property that matters most and
 * is easiest to lose: a write that FAILS is counted and reported at teardown rather than swallowed.
 * Falling back to the real stderr would corrupt the display, which is the reason the guard exists;
 * staying silent produces a session where every diagnostic is dead and nothing says so — and this is
 * the sole channel for the degradation reports, hook-approval failures and the backtrack fork trace.
 *
 * What stays here is the label. The teardown line reads `[theocode] N diagnostic message(s) …`, and
 * that prefix is this product's, not the framework's.
 */
export function installStderrGuard(logPath: string): () => void {
  return install(logPath, { label: 'theocode' })
}
