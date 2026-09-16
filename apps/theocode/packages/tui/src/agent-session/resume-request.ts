/**
 * Whether this launch asked to continue the previous conversation.
 *
 * The decision used to be `existsSync(sessionPointer)` alone, and nothing ever removes that file:
 * a directory used once resumed on every later launch, forever, with no flag to opt out. The escape
 * — `/new` — only exists after the screen is up, by which point the old context has already been
 * loaded. Measured 2026-09-15 on a restart whose purpose was to clear a session already over its
 * context window.
 *
 * Presence of the pointer answers "is there something to continue"; this answers "was continuing
 * asked for". Both must hold, and keeping them separate is what lets the pointer keep being written
 * on every launch so that a later `--continue` can find it.
 *
 * Exact matches only. `--continuous` and `--config` share a prefix with these flags and mean
 * nothing like them; a `startsWith` here would resume on an unrelated argument.
 */
const RESUME_FLAGS = new Set(['--continue', '-c'])

export function resumeRequested(argv: readonly string[] = process.argv): boolean {
  return argv.some((arg) => RESUME_FLAGS.has(arg))
}
