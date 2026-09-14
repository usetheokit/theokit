/**
 * Hand-written declarations for `env-verdicts-lib.mjs`.
 *
 * The library is `.mjs` on purpose: `scripts/check-env-verdicts.mjs` runs under plain `node` with no
 * build step and no install — that is FR-006 of B-066, and the CI job has no `pnpm install` for the
 * same reason. Writing the library in TypeScript would make the gate depend on `dist/`, so the gate
 * could only run after a build, which is the opposite of what it promises.
 *
 * Declaring it by hand is the cost of that choice. Without this file the test's import is an
 * implicit `any`, and a test that type-checks against `any` asserts nothing about the shape it
 * consumes — measured 2026-09-14: the isolated run reported "Type Errors: no errors" while the full
 * suite raised `TypeCheckError` on this very import.
 */
export interface EnvScanResult {
  /** Every variable name the tree reads, sorted and de-duplicated. */
  readonly names: string[]
  /** `file:line — why` for each read that could not be resolved to a literal name. */
  readonly unresolved: string[]
}

export interface ListComparison {
  readonly ok: boolean
  readonly readButUndeclared: string[]
  readonly declaredButUnread: string[]
}

/** Throws when a source file cannot be read: a clean tree it did not see is not a clean tree. */
export function scanEnvReads(root: string): EnvScanResult

export function compareAgainstList(
  read: readonly string[],
  declared: readonly string[],
): ListComparison

/** Throws when the section is absent — an absent list is not an empty one. */
export function readDeclaredList(readmePath: string): string[]
