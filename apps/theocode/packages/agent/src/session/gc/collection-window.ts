/**
 * The collection window, and the one rule both planners obey about it.
 *
 * `sessions gc` has two implementations — `per-session.ts` for the current project and
 * `all-sessions.ts` for `--all-projects` — and the window is the argument the operator actually
 * types. The floor lived inside the all-projects planner, so the SAME number was refused with the
 * flag and executed without it: `--max-age-days 0` made the predicate `ageDays > 0`, which plans
 * every transcript outside the protected set for unlink.
 *
 * It lives in neither planner now, because it belongs to neither: the reason for the floor does not
 * depend on how many projects are being swept. Importing it from a sibling planner would have made
 * one of the two the owner of a rule they share.
 */

/** The smallest window a caller may ask for, in days. */
const FLOOR_DAYS = 1

/** The window used when the caller names none. */
export const DEFAULT_WINDOW_DAYS = 30

/**
 * Refuses a window below the floor, rather than normalising it.
 *
 * Silently raising 0 to 1 would be the more forgiving choice and the wrong one: the operator asked
 * for something destructive, and answering a different question without saying so is how a sweep
 * deletes yesterday's session while reporting success.
 */
export function assertCollectionFloor(maxAgeDays: number): void {
  if (maxAgeDays < FLOOR_DAYS) {
    throw new RangeError(
      `maxAgeDays=${String(maxAgeDays)} is below the floor of ${String(FLOOR_DAYS)} day(s) — ` +
        `refusing: silently normalising would delete yesterday's session`,
    )
  }
}
