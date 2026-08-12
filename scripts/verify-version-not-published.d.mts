/**
 * Type declarations for `verify-version-not-published.mjs` (backlog B-M67-07).
 *
 * The script is a plain `.mjs` ES module with no TS. This declaration exists so the unit test
 * (`tests/unit/verify-version-not-published.test.ts`) can import `findPublishedCollisions` typed
 * rather than as `any` — the same pattern as `sync-template-versions.d.mts`.
 */

/** A workspace package the versioning step just bumped, as the gate sees it. */
export interface VersionCandidate {
  readonly name: string
  readonly version: string
  /** Private packages are never on the registry, so the gate skips them. */
  readonly private?: boolean
}

/**
 * Whether the registry already has `version` of `name`.
 *
 * Injected so the decision is testable without the network (DIP): the CLI passes a `npm view`
 * wrapper, tests pass a set.
 */
export type RegistryHasVersion = (name: string, version: string) => boolean

/** The candidates naming a version the registry already has. Empty means the release may proceed. */
export function findPublishedCollisions(
  candidates: readonly VersionCandidate[],
  registryHasVersion: RegistryHasVersion,
): { name: string; version: string }[]
