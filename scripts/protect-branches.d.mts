/**
 * Type declarations for `protect-branches.mjs` (backlog B-M67-10).
 */

export interface BranchPolicy {
  readonly required_status_checks: { readonly strict: boolean; readonly contexts: string[] }
  readonly enforce_admins: boolean
  readonly required_pull_request_reviews: {
    readonly required_approving_review_count: number
  } | null
  readonly restrictions: unknown
  readonly allow_force_pushes: boolean
  readonly allow_deletions: boolean
  readonly required_linear_history: boolean
}

export interface ProtectionSpec {
  readonly branches: Record<'main' | 'develop', BranchPolicy>
  readonly $unprotected?: Record<string, string>
}

export interface ProtectionDiff {
  readonly matches: boolean
  readonly differences: string[]
}

/** The intended policy, versioned at `.github/branch-protection.json`. */
export const SPEC: ProtectionSpec

/** Compare one branch's desired policy against the live state. `null` = unprotected (API 404). */
export function diffProtection(
  branch: string,
  desired: BranchPolicy,
  live: Record<string, unknown> | null,
): ProtectionDiff
