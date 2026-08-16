/** Types for `changelog-closes.mjs`. */

export interface GapEntry {
  id: string
  /** Paths this gap is answered by. A trailing `/` means everything under it. */
  files: string[]
  summary: string
}

export interface MissingClose {
  id: string
  summary: string
  /** The changed files that matched this gap. */
  files: string[]
}

/**
 * Registered gaps whose files a change touches and whose id `[Unreleased]` does not name. Reads
 * `[Unreleased]` only: released sections are never edited (Rule 6), so a `closes:` in one is history.
 */
export declare function missingCloses(input: {
  changedFiles: string[]
  changelog: string
  registry: GapEntry[]
}): MissingClose[]
