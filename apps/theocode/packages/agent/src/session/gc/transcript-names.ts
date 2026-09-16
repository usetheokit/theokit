/**
 * The naming vocabulary of the all-projects sweep: how a transcript, and the lock that guards it,
 * map between file names and ids.
 *
 * One definition, because the plan phase and the apply phase both strip these suffixes and a
 * divergence between them would let the apply phase delete a lock whose transcript the plan phase
 * believed was still on disk (B-020). Split out of `all-sessions.ts` when that file re-crossed the
 * 400-line gate that motivated its own split — the guards and the planner both need these names,
 * and a shared leaf module is what keeps the extraction acyclic.
 */

export function transcriptId(name: string): string {
  return name.slice(0, -'.jsonl'.length)
}

/** The suffix a lock adds to the transcript it guards. */
export const LOCK_SUFFIX = /\.jsonl(\.writer)?\.lock$/

export function lockId(name: string): string {
  return name.replace(LOCK_SUFFIX, '')
}
