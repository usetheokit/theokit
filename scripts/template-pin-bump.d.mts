/**
 * Types for `template-pin-bump.mjs`, so its one pure function can be imported without a suppression.
 *
 * The module stays `.mjs` for the same reason `sync-template-pins.mjs` does — it runs as a release
 * step through plain `node`, with no build in front of it — and this is the fourth time in this
 * repository that the honest answer was a declaration beside the script rather than a
 * `@ts-expect-error`, which would silence every future change to the signature too.
 */

/**
 * The version the package shipping a scaffold template must take, given the pin changes about to be
 * written to that template.
 *
 * @param changed  the pin changes, in `sync-template-pins`' own `name: from -> to` form. Only the
 *   LENGTH is read; the strings are the caller's log.
 * @param current  the shipping package's version as its manifest states it now.
 * @returns the version to write, or `null` when no pin changed.
 * @throws if `current` is a prerelease, or is not `MAJOR.MINOR.PATCH` — both are cases where
 *   choosing a next version would be a guess rather than a derivation.
 */
export function bumpForTemplatePins(changed: readonly string[], current: string): string | null
