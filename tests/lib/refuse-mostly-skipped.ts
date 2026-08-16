/**
 * A mostly-skipped run is a vacuous pass, not a pass.
 *
 * The rule lives in its own module for two reasons, both learned the hard way. It was previously an
 * `it` inside a `describe` at the top of `crossval-gaps.test.ts`, with a comment claiming it "runs
 * last by declaration order" — it did not, it ran 2nd of 33 against an empty list, so a run where
 * every gap assertion skipped still reported 33 passed. And when it was first extracted, the unit
 * test importing it from the `.test.ts` re-executed that whole suite as a side effect.
 *
 * A rule that can only be verified by reasoning about where it sits in a file is a rule nobody can
 * check.
 */

export interface SkipEntry {
  readonly gap: string
  readonly reason: string
}

/**
 * @throws when CI is on and more than one gap skipped. One skip is the designed allowance: a single
 * unbuilt artifact skips a single gap, and failing on that trains people to ignore the suite.
 */
export function refuseMostlySkipped(entries: readonly SkipEntry[], isCI: boolean): void {
  if (!isCI) return
  if (entries.length <= 1) return
  throw new Error(
    `too many gap assertions skipped (${String(entries.length)}); a mostly-skipped run is a ` +
      `vacuous pass, not a pass: ${JSON.stringify(entries)}`,
  )
}
