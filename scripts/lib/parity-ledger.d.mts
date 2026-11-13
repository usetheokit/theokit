/** Types for `parity-ledger.mjs`, so the root test imports it without a suppression. */

export class ParityEvidencePathError extends Error {
  file: string
  constructor(file: string, reason: string)
}

/** True only when `source` has a runnable it()/test() call titled `name`: not in a comment, not .skip/.todo. */
export function declaresActiveTest(source: string, name: string): boolean

/** Resolves `file` under `repoRoot`; throws `ParityEvidencePathError` when it escapes the root or does not match `allowed`. */
export function resolveEvidenceFile(
  repoRoot: string,
  file: string,
  options?: { allowed?: RegExp },
): string

export interface LedgerRow {
  id: string
  status: string
  evidence?: { file: string; test: string }
  reason?: string
  declared_by?: string
  declared_on?: string
}

export interface CheckLedgerRowsOptions {
  statuses: readonly string[]
  shippedStatus?: string
  /** Reads an absolute path; throws when it is missing. Defaults to `readFileSync(path, 'utf8')`. */
  read?: (absolutePath: string) => string
  repoRoot: string
  /** `YYYY-MM-DD`. When given, non-shipped rows also need a dated `human/<name>` declarer. */
  today?: string
  minReasonWords?: number
  /** Repo-relative POSIX path an evidence file must match. */
  allowedEvidence?: RegExp
}

export function checkLedgerRows(
  rows: readonly LedgerRow[],
  options: CheckLedgerRowsOptions,
): { counts: Record<string, number>; violations: string[] }
