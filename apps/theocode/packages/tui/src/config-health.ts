/**
 * Whether the project configuration could be read, as something to show the operator.
 *
 * ## The defect this closes (#827)
 *
 * The warning lived inside the branch that runs when trust is GRANTED
 * (`ConsentGates.tsx`), so it appeared once, in the turn the operator approved the directory.
 * Every boot after that: nothing on screen, nothing in `.theokit/tui-stderr.log`, and a status bar
 * showing defaults that look like a choice. `theocode doctor`, on the same file, exits 1 with the
 * path — so the two surfaces of one product disagreed, and the loud one is the one nobody opens
 * until something is already wrong.
 *
 * Measured 2026-09-17 with the log file moved aside first, so the absence was a fresh absence rather
 * than a stale file being re-read.
 *
 * `sandbox_mode` and `approval_policy` live in that file. A confinement setting dropped without a
 * word is the failure this product's own `doctor` names one surface over — and the reason this is a
 * notice rather than a log line.
 *
 * ## Why a function over a reader
 *
 * The caller supplies the read, so the decision is testable without a filesystem and without React.
 * What is asserted here is the MESSAGE, which is the whole deliverable: an operator who cannot see
 * which file failed, or that the session fell back to defaults, has been told nothing useful.
 */
export function configHealthNotice(read: () => unknown): string | undefined {
  try {
    read()
    return undefined
  } catch (err) {
    // The previous message named `config.toml` — the format `settings.json` replaced — which sent a
    // reader to a file that was not the one that failed.
    return (
      `the project settings.json could not be read: ${(err as Error).message}. ` +
      'This session is running on DEFAULTS, so anything you configured there — including ' +
      '`sandbox_mode` and `approval_policy` — is not in force. Fix the file and restart.'
    )
  }
}

/**
 * The posture a session takes when its configuration could not be read.
 *
 * NOT "the defaults". A default is what the product picks when the operator expressed no preference;
 * this is the case where they expressed one and it could not be read, which is a different fact. The
 * safe reading of unknown confinement is the narrow one — `read-only`, and approval on every request.
 *
 * Running on `workspace-write` here would hand a session write authority that nobody granted, on the
 * strength of a file the product just failed to parse.
 */
export function fallbackConfigPosture(): { sandbox_mode: 'read-only'; approval_policy: 'untrusted' } {
  return { sandbox_mode: 'read-only', approval_policy: 'untrusted' }
}
