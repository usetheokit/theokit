/**
 * Type declarations for `audit-scopes.mjs` (backlog B-M67-11).
 *
 * Same pattern as `check-licenses.d.mts` and `verify-version-not-published.d.mts`: the script is a
 * plain `.mjs`, and this exists so `tests/unit/audit-scopes.test.ts` imports the decision typed.
 */

export interface SeverityCounts {
  readonly critical: number
  readonly high: number
  readonly moderate: number
  readonly low: number
}

export interface AuditOutcome {
  /** Production critical/high — the only thing that fails the gate. */
  readonly blocking: boolean
  readonly reason: string
  /** Dev-only critical/high: surfaced, never blocking. Not blocking must not mean not knowing. */
  readonly warnings: string[]
}

/** One advisory as `pnpm audit --json` reports it. Only `severity` is read; the rest is context. */
export interface AuditAdvisory {
  readonly severity?: string
  readonly module_name?: string
  readonly title?: string
}

/** Count advisories by severity in a `pnpm audit --json` payload. A clean tree counts zero. */
export function summarizeBySeverity(report: {
  advisories?: Record<string, AuditAdvisory>
}): SeverityCounts

/** Decide the gate from both scopes. Pure — counts are injected (DIP). */
export function decideAuditOutcome(scopes: {
  prod: SeverityCounts
  dev: SeverityCounts
}): AuditOutcome
