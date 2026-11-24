/**
 * Types for `describe-command-failure.mjs`, so the root test imports it without a suppression. The
 * script stays `.mjs` because the release gate that uses it runs through plain `node`, with no build.
 */

/** Describe a failed `execFileSync` call: exit code or signal, then the child's whole stderr. */
export function describeCommandFailure(err: unknown): string

/**
 * Run `attempt`, and once more if it throws. A failure the retry clears is written to `log` in
 * full; a failure that repeats is thrown carrying both descriptions.
 */
export function runWithOneRetry<T>(attempt: () => T, log: (line: string) => void): T

interface PeerManifest {
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

/** The `npm install` specs for the peers a consumer owes a package. */
export function peerSpecs(manifest: PeerManifest, siblings: ReadonlySet<string>): string[]

/** The package a failed import could not find, or undefined for any other failure. */
export function missingPackage(stderr: string): string | undefined

/** What to install so an entry importing `name` can load, or undefined when it is nobody's to supply. */
export function specForMissing(
  name: string,
  manifest: PeerManifest,
  tarballs: ReadonlyMap<string, string>,
): string | undefined
