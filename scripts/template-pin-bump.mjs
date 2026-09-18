/**
 * Decide whether syncing a template pin obliges a version bump on the package that ships it.
 *
 * `create-theokit` pins the framework inside `templates/default/package.json.tmpl` — a template
 * file, not a dependency. Changesets reads dependencies, so the edge is invisible to it: the pin is
 * corrected in the repository and the CLI is not republished, and every app scaffolded afterwards
 * installs the line the pin used to name.
 *
 * Measured 2026-09-18: minutes after `theokit@0.67.0` published a security fix,
 * `npm create theokit@latest` installed `theokit@0.66.1` — inside the advisory's affected range —
 * because the published CLI still carried `^0.66.0`.
 *
 * Kept as its own module, and pure, for the reason `unpublished-pins.js` is: a decision that lives
 * inside a script's `main()` is a decision nothing can test without running a release.
 */

/** `1.2.3` and nothing else. A prerelease is deliberately not matched — see below. */
const STABLE = /^(\d+)\.(\d+)\.(\d+)$/u

/**
 * @param {readonly string[]} changed  the pin changes `sync-template-pins` is about to write, in its
 *   own `name: from -> to` form. Only its LENGTH is read; the strings are for the caller's log.
 * @param {string} current  the shipping package's version as its manifest states it now.
 * @returns {string | null}  the version to write, or `null` when nothing changed.
 */
export function bumpForTemplatePins(changed, current) {
  if (changed.length === 0) return null

  const match = STABLE.exec(current)
  if (match === null) {
    // Two different refusals, because they need different answers from a person.
    if (current.includes('-')) {
      throw new Error(
        `refusing to bump the prerelease version "${current}": the next patch of a prerelease is ` +
          'ambiguous (another rc, or the stable it leads to?), and answering it here would be a ' +
          'guess about a release shape this script does not drive.',
      )
    }
    throw new Error(`cannot parse the version "${current}" as MAJOR.MINOR.PATCH`)
  }

  const [, major, minor, patch] = match
  return `${major}.${minor}.${String(Number(patch) + 1)}`
}
