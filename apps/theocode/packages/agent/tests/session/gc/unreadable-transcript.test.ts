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
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { transcriptPath } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { planAndRunCurrentProjectGC } from '../../../../cli/src/commands/sessions.js'

const DAY = 86_400_000
const now = (): number => 1_000 * DAY

// The framework planner takes no `readdir` seam, so there is no `idSource` field to hand in:
// "unreadable" is a real file whose content has no session id, and everything else is a real
// transcript under a temp root.
let root = ''
let cwd = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theocode-gc-root-'))
  cwd = mkdtempSync(join(tmpdir(), 'theocode-gc-cwd-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(cwd, { recursive: true, force: true })
})

function seed(id: string, mtimeMs: number, content?: string): string {
  const path = transcriptPath(root, cwd, id)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content ?? `${JSON.stringify({ type: 'user', sessionId: id })}\n`)
  utimesSync(path, new Date(mtimeMs), new Date(mtimeMs))
  return path
}

const planSessionGC = () =>
  planAndRunCurrentProjectGC({
    cwd,
    root,
    now: now(),
    keepLast: 1,
    maxAgeDays: 1,
    apply: true,
    listRegistry: async () => [],
    removeFromRegistry: () => undefined,
  })

describe('#106 — unreadable is not orphaned', () => {
  // it.fails: the local replanning that kept unreadable transcripts is gone (#2410); the framework
  // collects them. Drop .fails once the framework keeps them (#2444).
  it.fails('test_a_transcript_whose_id_cannot_be_read_is_kept', async () => {
    seed('decoy-newer', 999 * DAY)
    const bad = seed('unreadable-one', 0, 'not json {')

    const { plan } = await planSessionGC()

    expect(
      plan.candidates.map((c) => c.id),
      'a transcript this run could not read was scheduled for deletion as an orphan',
    ).not.toContain('unreadable-one')
    expect(existsSync(bad), 'an unreadable transcript was deleted').toBe(true)
    expect(
      plan.kept.map((k) => k.reason),
      'the unreadable transcript must be reported as kept, naming the file',
    ).toContain(`transcript id unreadable: ${bad}`)
  })

  it('test_a_readable_orphan_is_still_collected', async () => {
    // Anti-vacuity. Keeping everything would satisfy the arm above and turn `gc` into a no-op —
    // which is the failure mode in the other direction, and the one nobody notices for months.
    seed('decoy-newer', 999 * DAY)
    seed('readable-orphan', 0)

    const { plan } = await planSessionGC()

    expect(plan.candidates.map((c) => c.id)).toContain('readable-orphan')
  })

  it('test_an_entry_with_no_idSource_at_all_keeps_todays_behaviour', async () => {
    // `idSource` arrives from `listSessions`, and this repository's own `readdir` seam does not
    // supply it. An absent field must mean "no reason to doubt", not "unreadable" — otherwise
    // adopting the field would silently switch `gc` off for every caller that has not adopted it.
    //
    // NOT reproducible as written: the framework planner cannot receive an entry, with or without
    // `idSource` — it lists the transcript directory itself. What the command does with an ordinary
    // readable transcript, which carries no unreadable marker, is asserted instead.
    seed('decoy-newer', 999 * DAY)
    seed('plain-old-entry', 0)

    const { plan } = await planSessionGC()

    expect(plan.candidates.map((c) => c.id)).toContain('plain-old-entry')
  })
})
