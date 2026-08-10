/**
 * Declarations for the publish guard's testable surface.
 *
 * The script itself is plain `.mjs` — it runs in CI and in `prepublishOnly`, where a build step
 * would be a liability. Its helpers still need types to be exercised from a `.ts` test, and stating
 * them here is better than silencing the import: a change to any signature below breaks the test
 * that depends on it, which is the point.
 */

/** Which file `pnpm pack` just wrote, from a diff of the destination directory. */
export function newTarball(before: readonly string[], after: readonly string[]): string

/** Workspace-protocol ranges still present in the on-disk manifests. */
export function workspaceRangesOnDisk(packages: readonly { name: string; dir: string }[]): string[]

/** True when the current publish is being driven by npm rather than pnpm. */
export function publishingWithNpm(userAgent?: string): boolean
