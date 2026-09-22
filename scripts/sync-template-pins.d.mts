/**
 * Types for `sync-template-pins.mjs`, so its one pure function can be imported without a
 * suppression.
 *
 * The script stays `.mjs` — it runs as a release step through plain `node`, with no build in front
 * of it. A declaration beside it is what gives the test real type checking instead of a
 * `@ts-expect-error`, which would silence any future change to this signature too. It is also what
 * `tests/integration/typecheck-clean-gate.test.ts` is counting: the suppression budget exists so
 * that reaching for one is a decision rather than a reflex, and this is the second time in this
 * repository that the honest answer was a declaration file (see `preview-packages.d.mts`).
 */

/**
 * Does a caret `range` admit `version`?
 *
 * `undefined` — never `false` — when either argument is not a shape this can read. A range it
 * cannot parse is UNKNOWN, and the caller reports it as unverified rather than failing a release
 * on a form nobody taught it.
 *
 * @param range a range as written in the template, e.g. `^12.1.0`
 * @param version a concrete version, e.g. the one npm serves on `latest`
 */
export function caretAdmits(range: string, version: string): boolean | undefined

/**
 * Prepend the entry documenting a bump this script performed.
 *
 * Exported for the same reason `caretAdmits` is: a test that drives it directly is worth more than
 * one that shells out to the script and reads a file afterwards. Declared here rather than inferred
 * from the `.mjs`, because that file is the one TypeScript does NOT read — measured while adding
 * this: `tsc` saw `caretAdmits` and refused the new export, since this declaration is what it
 * resolves.
 *
 * @param changelogPath the shipping package's CHANGELOG
 * @param version the version just written to its manifest
 * @param changed the pin lines, as `main()` already formatted them
 * @returns whether anything was written — `false` when the version already has a heading, so a
 *   second run in one cycle stacks nothing
 */
export function recordTemplatePinBump(
  changelogPath: string,
  version: string,
  changed: string[],
): boolean
