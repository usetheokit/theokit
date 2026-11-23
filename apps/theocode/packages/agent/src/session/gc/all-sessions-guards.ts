/**
 * The GUARDS of the all-projects sweep — what must never be collected, and why.
 *
 * Split from `all-sessions.ts` along the seam its own history named: guards
 * (`resolveGuards`/`registryNames`) versus planning (`planOneProject` and the per-kind planners).
 * That file re-crossed the 400-line budget that motivated its first split, and its history shows
 * size here correlating with unexercised delete paths — a module boundary makes "which half does
 * this test drive?" answerable from the import line, the same argument `all-sessions-apply.ts`
 * records for the plan/apply split.
 */
import { basename } from 'node:path'

import { transcriptPath, transcriptRoot } from '@theokit/agents/persistence'

import { transcriptId } from './transcript-names.js'

/**
 * The GC's own verdict vocabulary.
 *
 * Moved from `liveness-oracle.ts` when that file was deleted in favour of `classifyProjects`
 * from `@theokit/agents/session`. The ALGORITHM was absorbed; this TYPE was not, and should not be:
 * it is a discriminated union that guarantees a `cwd` on ALIVE, which is what lets `resolveGuards`
 * consult the registry and the pointer without a null check on every line. The framework's
 * `LivenessVerdict` carries `cwd` as optional because `undetermined` has none — correct there,
 * weaker here. The adapter that bridges the two lives at the seam, in `filesystem.ts`.
 */
export type Liveness =
  | { state: 'ALIVE'; cwd: string }
  | { state: 'DEAD'; cwd?: string }
  | { state: 'UNDETERMINED'; reason: string }

export interface RegistryEntry {
  agentId: string
  archived?: boolean
  lastModified?: number
}

/** The two reads the guards perform — the only slice of the planner's options they need. */
export interface GuardReads {
  readPointer: (cwd: string) => string | undefined
  listRegistry: (cwd: string) => Promise<RegistryEntry[]>
}

/**
 * Either the guards, or WHICH read failed.
 *
 * B-143 moved the pointer read inside the guard that already wrapped the registry read, and left the
 * caller reporting `registry unavailable` for both. A widened catch with an unwidened message sends
 * the operator to the wrong file, so the failure carries its own name.
 */
export type GuardResult =
  | { protectedIds: Set<string>; registry: RegistryEntry[] }
  | { failedRead: 'pointer' | 'registry' }

export async function resolveGuards(
  liveness: Liveness,
  transcripts: readonly { name: string; mtimeMs: number | undefined }[],
  keepLast: number,
  reads: GuardReads,
): Promise<GuardResult> {
  const protectedIds = new Set<string>()
  if (liveness.state !== 'ALIVE' && liveness.state !== 'DEAD') {
    return { protectedIds, registry: [] }
  }

  // B-020 — retention applies to DEAD projects too, and they are the ONLY kind the collector deletes
  // from. Returning an empty set here made `KEEP_PER_PROJECT` and the `--keep-last` flag apply
  // exclusively to the projects that were being spared anyway. Neither existing test could see it:
  // both force ALIVE or pass `keepLast: 0`.
  // B-140 — the quota is spent on DATABLE entries only.
  //
  // An entry the collector could not `stat` has `mtimeMs: undefined`, and the caller's sort reads
  // that as `Infinity` — so it lands at the FRONT, where `slice(0, keepLast)` spends a slot on it.
  // Those entries are already safe: `collectableAge` returns undefined without an mtime and the
  // planner skips them. So the quota was being spent on files that were never at risk, and the
  // stale transcripts it exists to protect fell through to deletion. Measured: 10 unstattable
  // entries beside 5 stale ones planned all 5 for removal, at the default quota of 10.
  //
  // This is the mirror of the bug B-020 fixed on the line above. `mtimeMs` used to be `0`, which
  // sorted LAST and dated the file to 1970, so it was collected every window; that comment reasons
  // about sort position and concludes `keepLast` "could not protect it either". Moving the entry to
  // the front protected it twice and unprotected its neighbours.
  const datable = transcripts.filter((t) => t.mtimeMs !== undefined)
  for (const t of datable.slice(0, keepLast)) protectedIds.add(transcriptId(t.name))

  // The registry and pointer guards need a live cwd to consult, so they stay ALIVE-only.
  if (liveness.state === 'DEAD') return { protectedIds, registry: [] }

  // Same reason as the quota: an unstattable entry must not consume the most-recent slot either, or
  // the genuinely newest transcript of a live project loses its guard to a file nobody could read.
  if (datable[0] !== undefined) protectedIds.add(transcriptId(datable[0].name))
  // B-143 — the pointer read is inside the same guard as the registry read, and for the same reason.
  //
  // `readPointerId` fails fast on any errno but ENOENT because what it returns is a deletion
  // decision: swallowing an EACCES would drop a live session from the protected set. That argument
  // is about THIS PROJECT. The call used to sit outside every `try` here, so the throw unwound past
  // both catches, out of `planOneProject` and out of `planSessionGCAllProjects` — measured: the
  // whole plan rejected. One project with a permissions problem meant nothing anywhere was
  // collected, and under the automatic trigger the stamp was already written, so it would not retry
  // for a day. Every day.
  //
  // Returning undefined skips THIS project and reports it, which is what the caller already does for
  // an unavailable registry. The safe direction is kept where it belongs and stops being contagious.
  let registry: RegistryEntry[]
  let reading: 'pointer' | 'registry' = 'pointer'
  try {
    const pointer = reads.readPointer(liveness.cwd)
    // The pointer holds a SESSION ID and this set is keyed by FILENAME, which is derived from the id
    // and never equal to it — measured: `exec-522dc0ef-…` names a file called `7dc7d4ef-….jsonl`.
    // Adding the raw id put a value in that the lookup can never ask for, so the guard standing
    // between a running TUI and the loss of its own conversation matched nothing. It went unseen
    // because the quota and most-recent guards cover the live session whenever it is also the newest;
    // it failed exactly when it was not, and deletion here calls `unlink` with no restore.
    //
    // The SDK's own forward mapping does the conversion. The INVERSE cannot exist over a hash
    // (usetheokit/theokit-sdk#577) and is not needed: the id is already in hand, so ask what it is
    // called rather than trying to read an id out of a name.
    if (pointer !== undefined) {
      const named = transcriptPath(transcriptRoot(), liveness.cwd, pointer)
      protectedIds.add(transcriptId(basename(named)))
    }
    reading = 'registry'
    registry = await reads.listRegistry(liveness.cwd)
  } catch {
    return { failedRead: reading }
  }
  // #102 — mapped, like the pointer above. `ca3db5c` converted the pointer and left this loop
  // adding RAW session ids to a set that is queried with transcript names, so a registered
  // non-archived session in another project stayed unprotected — the exact defect that commit was
  // cut to close, surviving in the path it did not touch. Found by `theocode review` on its first
  // working run, against the commit that introduced the half-fix.
  for (const e of registry) {
    if (e.archived === true) continue
    // #102 — BOTH names. 5.x hashes the id into the filename; 4.x used the id itself, so an
    // upgraded machine has both on disk. Mapping ALONE stops protecting every legacy transcript,
    // which is the trade `ca3db5c` made without noticing. See `per-session.ts § namesOf`.
    protectedIds.add(transcriptId(basename(transcriptPath(transcriptRoot(), liveness.cwd, e.agentId))))
    protectedIds.add(e.agentId)
  }
  return { protectedIds, registry }
}

/**
 * #102 — every name a registered session can wear on disk, for THIS project.
 *
 * Both conventions: 5.x hashes the id into the filename, 4.x used the id itself, and an upgraded
 * machine has both. A DEAD project has no cwd to map against and `resolveGuards` already hands back
 * an empty registry for one, so the empty set is the same answer without a cast.
 */
export function registryNames(
  liveness: { state: string; cwd?: string },
  registry: readonly RegistryEntry[],
): Map<string, string> {
  if (liveness.state !== 'ALIVE' || liveness.cwd === undefined) return new Map()
  const cwd = liveness.cwd
  return new Map(
    registry.flatMap((e): [string, string][] => [
      [transcriptId(basename(transcriptPath(transcriptRoot(), cwd, e.agentId))), e.agentId],
      [e.agentId, e.agentId],
    ]),
  )
}
