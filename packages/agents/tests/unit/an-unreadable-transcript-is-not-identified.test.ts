import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { transcriptPath } from '@theokit/sdk/persistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { planTranscriptGC, runTranscriptGC } from '../../src/session/gc/transcript-gc.js'
import { projectDirFor } from '../../src/session/project-index.js'
import { listSessions, protectedTranscriptPaths } from '../../src/session/session-lifecycle.js'

/**
 * theokit#668 — "I could not read this transcript" and "this transcript belongs to nobody" are
 * opposite claims, and the listing collapsed them into one by falling back to the filename stem.
 *
 * Under `@theokit/sdk` 5.x that stem is `sessionUuidFor(id)`, a one-way hash, so the fallback did
 * not return a degraded id — it returned an identifier belonging to no session. Protection was then
 * looked up BY that id, so a session someone declared protected lost its protection.
 *
 * The fix runs the mapping in the direction that HAS a function. `transcriptPath(root, cwd, id)` is
 * total on both majors; the inverse is not. So protection is keyed by TRANSCRIPT PATH, computed
 * forward from the ids that protect, and whether the file can be read stops mattering to it.
 *
 * Every assertion here holds on both supported majors. The end-to-end protection case is marked
 * where it can only FAIL on 5.x, rather than being written as if it proved the same thing on 4.x.
 */

const CWD = '/some/project'
const NOW = new Date('2026-08-13T12:00:00Z').getTime()
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theokit-unreadable-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeReadable(sessionId: string, ageDays = 0): string {
  const path = transcriptPath(root, CWD, sessionId)
  mkdirSync(projectDirFor(CWD, root), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ type: 'user', sessionId })}\n`, 'utf8')
  const when = new Date(NOW - ageDays * 86_400_000)
  utimesSync(path, when, when)
  return path
}

/** Truncated mid-write: the first record does not parse, so no id is recoverable from inside. */
function writeUnreadable(sessionId: string, ageDays = 0): string {
  const path = transcriptPath(root, CWD, sessionId)
  mkdirSync(projectDirFor(CWD, root), { recursive: true })
  writeFileSync(path, '{"type":"user","sessionId":"exec-', 'utf8')
  const when = new Date(NOW - ageDays * 86_400_000)
  utimesSync(path, when, when)
  return path
}

describe('an unreadable transcript is listed but never identified (theokit#668)', () => {
  it('test_the_listing_reports_no_id_rather_than_inventing_one', async () => {
    writeUnreadable('exec-truncated')
    const [entry] = await listSessions(CWD, root)

    // It still appears: a session the GC cannot see is a session the GC never collects.
    expect(entry).toBeDefined()
    // But it carries no identity, because none was recoverable. The filename is a convention; the
    // record is the authority, and on 5.x the convention is a hash that cannot be undone.
    expect(entry?.id).toBeUndefined()
    expect(entry?.idSource).toBe('unavailable')
  })

  it('test_a_readable_transcript_still_reports_the_id_from_the_record', async () => {
    // The positive control. Without it, `id === undefined` above could mean the reader broke.
    writeReadable('exec-real-id')
    const [entry] = await listSessions(CWD, root)
    expect(entry?.id).toBe('exec-real-id')
    expect(entry?.idSource).toBe('transcript')
  })

  it('test_protection_is_keyed_by_transcript_path_not_by_session_id', async () => {
    // The mechanism, asserted directly: a map keyed by id cannot answer for a file whose id is
    // unknown, and no amount of care at the call site fixes that.
    const path = writeReadable('exec-only-one')
    expect([...(await protectedTranscriptPaths(CWD, root)).keys()]).toEqual([path])
  })

  it('test_the_registry_is_never_asked_to_remove_an_id_that_was_never_read', async () => {
    // The second half of the defect: `removeFromRegistry(candidate.id)` used to be called with the
    // filename stem, so the file died and the registry entry it named did not exist.
    writeReadable('exec-keeper')
    writeUnreadable('exec-old-and-truncated', 400)

    const removeFromRegistry = vi.fn(() => true)
    const plan = await planTranscriptGC({ cwd: CWD, keepLast: 1, maxAgeDays: 30, root, now: NOW })
    await runTranscriptGC(plan, { apply: true, removeFromRegistry })

    expect(removeFromRegistry).not.toHaveBeenCalled()
  })

  it('test_a_protected_session_whose_transcript_is_unreadable_is_kept', async () => {
    // END-TO-END. Honest note on reach: this can only FAIL on 5.x. On 4.x the stem IS the id, so
    // the old id-keyed lookup matched by accident and the session was protected anyway. It is kept
    // here because it is the user-visible statement of the defect, and because it must not regress
    // on either major once protection is path-keyed.
    writeReadable('exec-keeper')
    writeUnreadable('exec-protected', 400)

    const plan = await planTranscriptGC({
      cwd: CWD,
      keepLast: 1,
      maxAgeDays: 30,
      root,
      now: NOW,
      protectedIds: () => new Map([['exec-protected', 'live session']]),
    })

    expect(plan.candidates).toHaveLength(0)
    expect(plan.kept.map((k) => k.reason)).toContain('live session')
  })
})
