/**
 * B-140 — `keepLast` was spent on entries that could never be collected, so the ones it existed to
 * protect were deleted instead.
 *
 * The quota protects the N most recent transcripts of a DEAD project. The sort that feeds it reads
 * an unknown mtime as `Infinity` (`all-sessions.ts:166`, `(b.mtimeMs ?? Infinity) - ...`), so an
 * entry the collector could not `stat` sorts as the NEWEST thing in the project and takes a slot.
 *
 * Those entries are already safe: `collectableAge` returns `undefined` without an mtime
 * (`all-sessions.ts:222`) and the planner skips them. So the quota is spent on files that were never
 * at risk, and the stale transcripts it was meant to keep fall through to deletion.
 *
 * The history is what makes this worth a test rather than a one-line change. `mtimeMs` used to be
 * `0` — which sorted LAST and dated the file to 1970, so it was collected every window. B-020 fixed
 * that by making it `undefined`, and its comment reasons explicitly about sort position: "mtime 0
 * also sorts LAST, so `keepLast` ... could not protect it either". The fix moved the entry to the
 * front to protect it, and protected it twice while unprotecting its neighbours.
 *
 * The errnos are named in `filesystem.ts:74-82` and include EMFILE, "plausible precisely here, since
 * the collector stats every entry of every project in one pass".
 *
 * Reachability changed in this release: until `session_gc` defaulted to true, this needed someone to
 * type `sessions gc --apply`.
 */
import { describe, expect, it } from 'vitest'

import { planSessionGCAllProjects, type ProjectEntry } from '../../../src/session/gc/all-sessions.js'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 8, 3)

const transcript = (name: string, ageDays: number | undefined): ProjectEntry =>
  ({
    name,
    isDirectory: false,
    ...(ageDays === undefined ? {} : { mtimeMs: NOW - ageDays * DAY }),
  }) as ProjectEntry

async function planFor(entries: ProjectEntry[]) {
  return planSessionGCAllProjects({
    projectsRoot: '/scratch',
    now: () => NOW,
    listProjects: () => ['p'],
    listProject: () => entries,
    // DEAD is the only kind the collector deletes from, and the only kind `keepLast` guards.
    classify: () => ({ state: 'DEAD' }) as never,
    listRegistry: async () => [],
    hasLiveWriter: () => false,
    readPointer: () => undefined,
    keepLast: 10,
  } as never)
}

describe('the keepLast quota', () => {
  it('test_stale_transcripts_inside_the_quota_are_protected', async () => {
    // The baseline the quota promises: 5 stale transcripts, quota 10, nothing collected.
    const plan = await planFor([1, 2, 3, 4, 5].map((i) => transcript(`stale-${String(i)}.jsonl`, 30 + i)))

    expect(plan.candidates).toHaveLength(0)
  })

  it('test_unstattable_entries_do_not_spend_the_quota_that_protects_the_others', async () => {
    // THE BUG. The same 5 stale transcripts, plus 10 entries the collector could not stat. Those 10
    // sort first, take the whole quota, and the 5 it was protecting become candidates.
    const unstattable = Array.from({ length: 10 }, (_, i) =>
      transcript(`unknown-${String(i)}.jsonl`, undefined),
    )
    const stale = [1, 2, 3, 4, 5].map((i) => transcript(`stale-${String(i)}.jsonl`, 30 + i))

    const plan = await planFor([...unstattable, ...stale])

    expect(
      plan.candidates.map((c) => c.target),
      'entries the collector could not stat spent the quota, and the transcripts it protects were planned for deletion',
    ).toEqual([])
  })

  it('test_an_unstattable_entry_is_still_never_collected_itself', async () => {
    // Anti-vacuity in the dangerous direction: the fix must not make unknown-mtime entries
    // collectable. That was the pre-B-020 behaviour and it deleted files dated to 1970.
    const plan = await planFor(
      Array.from({ length: 12 }, (_, i) => transcript(`unknown-${String(i)}.jsonl`, undefined)),
    )

    expect(plan.candidates).toHaveLength(0)
  })

  it('test_the_quota_still_runs_out_for_real_transcripts', async () => {
    // Anti-vacuity in the other direction: protecting everything would satisfy the tests above.
    // 12 stale transcripts against a quota of 10 leaves exactly the 2 oldest collectable.
    const plan = await planFor(
      Array.from({ length: 12 }, (_, i) => transcript(`stale-${String(i)}.jsonl`, 40 + i)),
    )

    expect(plan.candidates).toHaveLength(2)
  })
})
