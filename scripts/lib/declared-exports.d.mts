/**
 * Types for `declared-exports.mjs`.
 *
 * Hand-written rather than generated because the module must stay importable BOTH from `tsc`-checked
 * TypeScript (`tests/integration/crossval-gaps.test.ts`) and from plain-node `.mjs` gates
 * (`scripts/check-invention-reachability.mjs`, T4.1). Authoring it in TypeScript would give the
 * first consumer types and take the second one away.
 */
export interface DeclaredExports {
  /** Every name the surface declares or re-exports, including one hop through `export *`. */
  names: Set<string>
  /** Star-forward specifiers whose target could not be read — unverified coverage, never silent. */
  unresolvedForwards: string[]
}

export interface PackageDeclaredExports extends DeclaredExports {
  /** False when `dist/` is absent or holds no `.d.ts` — the caller must not read a skip as a pass. */
  built: boolean
}

export function declaredExportsFromText(text: string, resolveFrom?: string): DeclaredExports
export function declaredExportsOfPackage(packageDir: string): PackageDeclaredExports
export function rootSymbol(cited: string): string
