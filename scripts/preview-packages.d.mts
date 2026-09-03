/**
 * Types for `preview-packages.mjs`, so a consumer of its one pure function does not need a
 * `@ts-expect-error` to import it (usetheokit/theokit#632).
 *
 * The script stays `.mjs` — it runs as a workflow step through plain `node`, with no build in front
 * of it. A declaration beside it is what gives the test real type checking instead of a suppression:
 * `@ts-expect-error` would have silenced any future mismatch in this signature too, and
 * `tests/integration/typecheck-clean-gate.test.ts` caps how many of those may exist for exactly
 * that reason.
 */

/** Why this set of packages was selected — `touched` is the scoped case, the rest are fallbacks. */
export type PreviewSelectionReason = 'touched' | 'no-package-touched' | 'no-diff'

export interface PreviewSelection {
  /** Package directories to publish, as `./packages/foo`. */
  readonly packages: readonly string[]
  readonly reason: PreviewSelectionReason
}

/**
 * Decide which packages a preview publishes.
 *
 * @param all every publishable package directory, as `./packages/foo`
 * @param changed changed paths, or `null` when the diff could not be read at all
 */
export function selectPreviewPackages(
  all: readonly string[],
  changed: readonly string[] | null,
): PreviewSelection
