/**
 * Why `node_modules/<pkg>` is absent after an install, in words a reader can act on.
 *
 * `tests/integration/pnpm-11-compat.test.ts` checks the package directory rather than the exit code,
 * because pnpm 11 exits non-zero on `ERR_PNPM_IGNORED_BUILDS` even when the install completed. That
 * check is right and its failure message was written for one case only: the install threw and carried
 * an error. Measured on the v1.2.0-rc.2 cut (CI run 36636655271, 2026-09-29 22:03:57) the install
 * **exited 0**, so nothing was thrown, nothing was captured, and the whole message was the literal
 * `pnpm stderr:` above an empty line.
 *
 * Three outcomes look identical through `existsSync` and call for opposite next steps:
 *
 * | what happened | where to look |
 * |---|---|
 * | pnpm failed and said why | the error it carried |
 * | pnpm exited 0 and installed nothing | the manifest, the store, or the registry — not pnpm |
 * | the symlink exists and its target does not | a store entry linked and never materialised |
 *
 * The third is a property of pnpm's layout: `node_modules/<pkg>` is a symlink into `.pnpm` and
 * `existsSync` FOLLOWS symlinks, so a dangling link reads as nothing installed at all.
 *
 * Pure, and beside `unpublished-pins.ts` for the reason that module's docblock gives: the decision is
 * testable without a network.
 *
 * @module
 */

/** What the caller observed around one install. */
export interface InstallOutcome {
  /** Whether the install command threw (a non-zero exit). */
  readonly threw: boolean
  /** Its stdout, kept because an install that exits 0 says what it did only here. */
  readonly stdout: string
  /** Its stderr, which is empty whenever nothing was thrown. */
  readonly stderr: string
  /** Whether the package path exists as a link, whatever its target. `lstat`, not `existsSync`. */
  readonly linkPresent: boolean
}

/** How much of each stream to carry. Enough to name a cause, short enough to read in a log. */
const TAIL = 2000

/**
 * One sentence naming which of the three outcomes happened, plus the output that supports it.
 *
 * @param outcome what the caller observed
 * @returns the message, for an assertion that already said the directory is absent
 */
export function describeInstallOutcome(outcome: InstallOutcome): string {
  const { threw, stdout, stderr, linkPresent } = outcome

  let cause = 'pnpm install failed'
  if (!threw && linkPresent) {
    cause =
      'pnpm install exited 0 and left a dangling symlink — the entry was linked and its target was ' +
      'never materialised, so the store or the fetch is the subject, not pnpm'
  } else if (!threw) {
    cause =
      'pnpm install exited 0 and installed nothing — the manifest, the store or the registry is the ' +
      'subject, not pnpm'
  }

  const streams = [
    stderr.trim() === '' ? 'stderr: (empty)' : `stderr:\n${stderr.slice(-TAIL)}`,
    stdout.trim() === '' ? 'stdout: (empty)' : `stdout:\n${stdout.slice(-TAIL)}`,
  ]

  return `${cause}.\n${streams.join('\n')}`
}
