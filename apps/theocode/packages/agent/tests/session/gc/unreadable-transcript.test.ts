/**
 * #106 — a transcript whose id cannot be read is never deleted as an orphan.
 *
 * The third state in the family this repository has been closing all week. `sessions gc` classified
 * every transcript as registered or not, by matching names against registry ids — and a file it
 * simply could not read matched nothing, so it fell into "not registered" and was unlinked.
 *
 * "I could not read this" and "this belongs to nobody" are opposite claims, and only one of them
 * justifies deletion. `@theokit/sdk@5.3.0` makes the distinction available for the first time:
 * `listSessions` reports `idSource: "unavailable"` with `id: undefined` rather than falling back to
 * the filename — the fallback that produced the original defect in two independent consumers.
 *
 * Measured against 5.3.0, a directory with one readable transcript and one corrupted file:
 *
 *   { id: "exec-522dc0ef-…", idSource: "transcript" }   ← read from INSIDE the file
 *   { id: undefined,          idSource: "unavailable" }  ← NOT the filename stem
 *
 * The safe direction is asymmetric and that is the whole argument: keeping a file that turns out to
 * be junk costs disk. Deleting one that turns out to be a live session costs the session, and
 * `unlink` has no undo.
 */
import { describe, expect, it } from 'vitest'

import { planSessionGC } from '../../../src/session/gc/per-session.js'

const DAY = 86_400_000
const now = (): number => 1_000 * DAY

describe('#106 — unreadable is not orphaned', () => {
  it('test_a_transcript_whose_id_cannot_be_read_is_kept', async () => {
    const plan = await planSessionGC({
      cwd: '/p',
      now,
      keepLast: 0,
      maxAgeDays: 1,
      list: () => Promise.resolve([]),
      readdir: () => [
        { id: 'decoy-newer', mtimeMs: 999 * DAY },
        { id: 'unreadable-one', mtimeMs: 0, idSource: 'unavailable' },
      ],
      readPointer: () => undefined,
    } as never)

    expect(
      plan.candidates.map((c) => c.id),
      'a transcript this run could not read was scheduled for deletion as an orphan',
    ).not.toContain('unreadable-one')
  })

  it('test_a_readable_orphan_is_still_collected', async () => {
    // Anti-vacuity. Keeping everything would satisfy the arm above and turn `gc` into a no-op —
    // which is the failure mode in the other direction, and the one nobody notices for months.
    const plan = await planSessionGC({
      cwd: '/p',
      now,
      keepLast: 0,
      maxAgeDays: 1,
      list: () => Promise.resolve([]),
      readdir: () => [
        { id: 'decoy-newer', mtimeMs: 999 * DAY },
        { id: 'readable-orphan', mtimeMs: 0, idSource: 'transcript' },
      ],
      readPointer: () => undefined,
    } as never)

    expect(plan.candidates.map((c) => c.id)).toContain('readable-orphan')
  })

  it('test_an_entry_with_no_idSource_at_all_keeps_todays_behaviour', async () => {
    // `idSource` arrives from `listSessions`, and this repository's own `readdir` seam does not
    // supply it. An absent field must mean "no reason to doubt", not "unreadable" — otherwise
    // adopting the field would silently switch `gc` off for every caller that has not adopted it.
    const plan = await planSessionGC({
      cwd: '/p',
      now,
      keepLast: 0,
      maxAgeDays: 1,
      list: () => Promise.resolve([]),
      readdir: () => [
        { id: 'decoy-newer', mtimeMs: 999 * DAY },
        { id: 'plain-old-entry', mtimeMs: 0 },
      ],
      readPointer: () => undefined,
    } as never)

    expect(plan.candidates.map((c) => c.id)).toContain('plain-old-entry')
  })
})
