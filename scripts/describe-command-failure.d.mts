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
