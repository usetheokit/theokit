/**
 * Types for `declared-exports.mjs`. The implementation is plain JS because it is build tooling and
 * runs under `node` with no compile step; this file is the contract its TypeScript consumers read.
 */

// `typeCandidates` is deliberately NOT exported: its only caller is the function below, in the same
// module. An export whose only consumer is its own file is a public promise nobody asked for (G7).

/**
 * Every name declared or re-exported by `text`, following `export *` ONE hop when `resolveFrom` is
 * given. `unresolvedForwards` is non-empty when a forward could not be followed — the answer is then
 * INCOMPLETE, and a caller that ignores it reports absence it did not verify.
 */
export declare function declaredExportsFromText(
  text: string,
  resolveFrom?: string,
): { names: Set<string>; unresolvedForwards: string[] }
