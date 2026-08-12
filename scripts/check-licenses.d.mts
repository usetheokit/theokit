/**
 * Type declarations for `check-licenses.mjs` (backlog B-M67-13).
 *
 * The script is a plain `.mjs` ES module with no TS. This declaration exists so the unit test
 * (`tests/unit/check-licenses.test.ts`) imports the decision functions typed rather than as `any` —
 * the same pattern as `sync-template-versions.d.mts` and `verify-version-not-published.d.mts`.
 */

/** A package as `pnpm licenses list --json` reports it, grouped under its SPDX expression. */
export interface LicensedPackage {
  readonly name: string
  readonly versions?: readonly string[]
}

/** One package sitting under a license the policy refuses. */
export interface Violation {
  readonly name: string
  readonly version: string
  readonly license: string
}

export interface LicenseReport {
  readonly violations: Violation[]
  readonly total: number
}

/** Licenses compatible with permissive redistribution. */
export const ALLOWLIST: ReadonlySet<string>

/** A package whose manifest omits `license`, with the SPDX id verified elsewhere and how. */
export interface LicenseOverride {
  readonly spdx: string
  readonly evidence: string
}

/** Keyed by exact `name@version` — a bump re-opens the question rather than inheriting the check. */
export const KNOWN_LICENSE_OVERRIDES: ReadonlyMap<string, LicenseOverride>

/** Does this SPDX expression satisfy the policy? `OR` needs one branch; `AND` needs every term. */
export function isLicenseAllowed(spdx: string | undefined | null): boolean

/** Which packages sit under a refused license. Pure — the package set is injected (DIP). */
export function findLicenseViolations(
  byLicense: Record<string, readonly LicensedPackage[]>,
): LicenseReport
