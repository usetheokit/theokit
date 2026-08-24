/**
 * Which first-party pins name a version the registry does not have.
 *
 * This exists to break a release deadlock (#438). `changeset version` bumps the scaffold template's
 * `theokit` pin to the version that the Version Packages PR is what publishes. In the window
 * between the bump and the publish the pin is unresolvable, so any job that installs a scaffolded
 * app fails — and those jobs are REQUIRED checks on `main`. The failure message asked for the
 * impossible: "publish the pending release and re-run", when publishing requires the merge the
 * failing check refuses.
 *
 * A caller uses this to tell that window apart from a real break. The distinction has to be narrow
 * or it becomes a way to skip genuine failures, so:
 *
 * - only first-party names (`theokit`, `@theokit/*`) count — a missing third-party package is
 *   somebody else's outage and should still fail;
 * - only a range that names exactly one version is probed. `workspace:*`, `>=1 <2` and `latest`
 *   have nothing to look up, and treating a range this cannot parse as "missing" would turn every
 *   unusual pin into a skip.
 *
 * @module
 */

/** Ranges of the form `1.2.3` or `^1.2.3` — the only shape that names one version to probe. */
const EXACT_OR_CARET = /^\^?(\d+\.\d+\.\d+)$/

/** Whether a `name@version` spec exists on the registry. */
export type ExistsOnRegistry = (spec: string) => boolean

/**
 * The first-party `name@version` specs that `exists` says are absent.
 *
 * Pure apart from the injected probe, so the decision is testable without a network.
 *
 * @param dependencies the app manifest's `dependencies`, or undefined
 * @param exists probe for one `name@version`
 * @returns the missing specs, in manifest order
 */
export function unpublishedPins(
  dependencies: Record<string, string> | undefined,
  exists: ExistsOnRegistry,
): string[] {
  const missing: string[] = []
  for (const [name, range] of Object.entries(dependencies ?? {})) {
    if (!name.startsWith('theokit') && !name.startsWith('@theokit/')) continue
    const version = EXACT_OR_CARET.exec(range)?.[1]
    if (version === undefined) continue
    if (!exists(`${name}@${version}`)) missing.push(`${name}@${version}`)
  }
  return missing
}
