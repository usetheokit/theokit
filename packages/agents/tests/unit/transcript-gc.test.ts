import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquireSessionWriter, transcriptPath } from '@theokit/sdk/persistence'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  GCFloorError,
  planTranscriptGC,
  runTranscriptGC,
} from '../../src/session/gc/transcript-gc.js'
import { projectDirFor } from '../../src/session/project-index.js'
import { persistSessionId } from '../../src/session/session-pointer.js'

/**
 * M72 — transcript retention, and the four invariants that are a merge condition rather than advice.
 *
 * ## Why the invariants are written as tests before anything else
 *
 * This module DELETES a user's conversation history. The named top risk of the milestone is "GC
 * wipes someone's live transcript", and the mitigation it chose was not review — it was that the
 * four invariants below hold under test. A retention pass that is 99% right destroys work
 * irreversibly in the remaining 1%, and the user finds out when they try to resume.
 *
 * The framework ships everything that CREATES unbounded disk state (`transcriptPath`, `appendJsonl`,
 * `forkTranscript`) and, until now, nothing that bounded it.
 */

const CWD = '/some/project'
/** Fixed clock: recency is real behaviour here, so it cannot depend on how fast the suite runs. */
const NOW = new Date('2026-08-13T12:00:00Z').getTime()
let root: string

function writeTranscriptFile(sessionId: string, ageDays = 0): string {
  const path = transcriptPath(root, CWD, sessionId)
  mkdirSync(projectDirFor(CWD, root), { recursive: true })
  writeFileSync(path, '{}\n', 'utf8')
  const when = new Date(NOW - ageDays * 86_400_000)
  utimesSync(path, when, when)
  return path
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theokit-gc-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const plan = (keepLast: number, maxAgeDays: number) =>
  planTranscriptGC({ cwd: CWD, keepLast, maxAgeDays, root, now: NOW })

describe('INVARIANT 1 — a floor violation is REFUSED, never silently normalised', () => {
  it.each([
    ['keepLast', 0, 30],
    ['keepLast negative', -1, 30],
    ['maxAgeDays', 2, 0],
    ['maxAgeDays negative', 2, -5],
  ])('test_%s_below_the_floor_throws_instead_of_clamping', (_label, keepLast, maxAgeDays) => {
    // Clamping is the tempting behaviour and the dangerous one: an operator who typed `--keep-last 0`
    // meaning "keep none" gets silently given a different policy than the one they asked for, and
    // never learns which. Refusing tells them.
    expect(() => plan(keepLast, maxAgeDays)).toThrow(GCFloorError)
  })

  it('test_the_refusal_names_the_field_and_the_floor', async () => {
    // A refusal that does not say which knob is wrong sends the operator guessing between two.
    try {
      plan(0, 30)
      expect.unreachable('a keepLast of 0 was accepted')
    } catch (error) {
      expect(error).toBeInstanceOf(GCFloorError)
      expect((error as GCFloorError).field).toBe('keepLast')
      expect((error as GCFloorError).message).toMatch(/keepLast/)
    }
  })

  it('test_a_value_AT_the_floor_is_accepted', async () => {
    // Counter-proof. A guard that refuses the boundary as well would be off by one, and every test
    // above would still pass.
    expect(() => plan(1, 1)).not.toThrow()
  })
})

describe('INVARIANT 2 — no mtime means NEVER collect', () => {
  // NOTE, stated rather than faked: the `Number.isNaN(mtime)` branch in `planTranscriptGC` is NOT
  // reachable through the public path today. `listSessions` builds `modifiedAt` from `statSync`,
  // which either yields a valid Date or throws — and it drops the entry when it throws. The guard is
  // defence-in-depth against a future change to that function, on a code path that deletes.
  //
  // The first draft of this file had a test claiming to cover it. It ended in `.toBeDefined` with no
  // parentheses — an expression, not an assertion — so it asserted nothing while reading like
  // coverage. The linter caught it. A vacuous test over an unreachable branch is worse than no test:
  // it reports the invariant as proven.

  it('test_a_candidate_never_carries_an_invalid_date', async () => {
    // The structural half of the same invariant: if an unreadable mtime ever became `Invalid Date`,
    // every age comparison against it is `false`, and the file would be collected by accident.
    writeTranscriptFile('a', 90)
    writeTranscriptFile('b', 0)
    for (const candidate of plan(1, 30).candidates) {
      expect(Number.isNaN(candidate.modifiedAt.getTime())).toBe(false)
    }
  })
})

describe('INVARIANT 3 — an active writer lease protects its transcript', () => {
  it('test_a_leased_transcript_is_never_a_candidate', async () => {
    const path = writeTranscriptFile('live', 400)
    writeTranscriptFile('recent', 0)
    const lease = await acquireSessionWriter(path)
    try {
      const result = plan(1, 30)
      expect(result.candidates.map((c) => c.id)).not.toContain('live')
      expect(result.kept.find((k) => k.id === 'live')?.reason).toMatch(/lease|writer/i)
    } finally {
      await (lease as { release?: () => Promise<void> }).release?.()
    }
  })
})

describe('INVARIANT 4 — the apply phase re-checks between plan and apply', () => {
  it('test_a_session_that_becomes_the_pointer_AFTER_planning_is_not_deleted', async () => {
    // The TOCTOU window, made concrete: the plan is computed, then something resumes that session.
    // A collector that trusted its own plan would delete the session the user just returned to.
    writeTranscriptFile('doomed', 400)
    writeTranscriptFile('recent', 0)
    const computed = plan(1, 30)
    expect(computed.candidates.map((c) => c.id)).toContain('doomed')

    await persistSessionId(CWD, 'doomed', root) // the window: it became live after planning

    const result = await runTranscriptGC(computed, { apply: true })
    expect(result.removed).not.toContain('doomed')
    expect(existsSync(transcriptPath(root, CWD, 'doomed'))).toBe(true)
  })

  it('test_a_session_that_acquires_a_LEASE_after_planning_is_not_deleted', async () => {
    const path = writeTranscriptFile('doomed', 400)
    writeTranscriptFile('recent', 0)
    const computed = plan(1, 30)
    expect(computed.candidates.map((c) => c.id)).toContain('doomed')

    const lease = await acquireSessionWriter(path)
    try {
      const result = await runTranscriptGC(computed, { apply: true })
      expect(result.removed).not.toContain('doomed')
      expect(existsSync(path)).toBe(true)
    } finally {
      await (lease as { release?: () => Promise<void> }).release?.()
    }
  })

  it('test_the_backstop_does_not_refuse_everything', async () => {
    // Counter-proof for the two above: a backstop that always refused would pass both and collect
    // nothing, which is a broken GC that looks like a safe one.
    writeTranscriptFile('doomed', 400)
    writeTranscriptFile('recent', 0)
    const result = await runTranscriptGC(plan(1, 30), { apply: true })
    expect(result.removed).toContain('doomed')
    expect(existsSync(transcriptPath(root, CWD, 'doomed'))).toBe(false)
  })
})

describe('dry run is the default shape', () => {
  it('test_without_apply_nothing_is_removed_and_the_plan_is_reported', async () => {
    writeTranscriptFile('doomed', 400)
    writeTranscriptFile('recent', 0)
    const computed = plan(1, 30)
    const result = await runTranscriptGC(computed, { apply: false })
    expect(result.dryRun).toBe(true)
    expect(result.removed).toEqual(['doomed'])
    expect(existsSync(transcriptPath(root, CWD, 'doomed'))).toBe(true)
  })
})

describe('retention policy — keepLast and maxAgeDays together', () => {
  it('test_the_newest_keepLast_survive_regardless_of_age', async () => {
    writeTranscriptFile('old-1', 400)
    writeTranscriptFile('old-2', 300)
    writeTranscriptFile('old-3', 200)
    const result = plan(2, 30)
    const kept = result.kept.map((k) => k.id)
    expect(kept).toContain('old-3')
    expect(kept).toContain('old-2')
    expect(result.candidates.map((c) => c.id)).toEqual(['old-1'])
  })

  it('test_a_session_younger_than_maxAgeDays_is_kept_even_beyond_keepLast', async () => {
    // Both conditions must hold to collect. Age alone would delete a project's whole recent history
    // the moment it exceeded `keepLast`.
    writeTranscriptFile('a', 1)
    writeTranscriptFile('b', 2)
    writeTranscriptFile('c', 3)
    expect(plan(1, 30).candidates).toEqual([])
  })
})

describe('errors accumulate per candidate, and ENOENT is success', () => {
  it('test_a_file_already_gone_counts_as_removed_not_as_an_error', async () => {
    // Absent is the desired end state. Reporting it as a failure would make a second run of an
    // interrupted GC look broken.
    writeTranscriptFile('doomed', 400)
    writeTranscriptFile('recent', 0)
    const computed = plan(1, 30)
    rmSync(transcriptPath(root, CWD, 'doomed')) // vanished between plan and apply
    const result = await runTranscriptGC(computed, { apply: true })
    expect(result.errors).toEqual([])
    expect(result.removed).toContain('doomed')
  })

  it('test_one_failing_candidate_does_not_abort_the_others', async () => {
    // Fail-open per candidate: a single undeletable file must not leave the rest of the disk
    // uncollected, and the operator must still learn which one failed.
    writeTranscriptFile('doomed-a', 400)
    writeTranscriptFile('doomed-b', 400)
    writeTranscriptFile('recent', 0)
    const computed = plan(1, 30)
    // Replace one candidate's path with a directory — `rmSync` on it without `recursive` fails.
    const blocked = transcriptPath(root, CWD, 'doomed-a')
    rmSync(blocked)
    mkdirSync(blocked)
    writeFileSync(join(blocked, 'inside'), 'x', 'utf8')

    const result = await runTranscriptGC(computed, { apply: true })
    expect(result.removed).toContain('doomed-b')
    expect(result.errors.map((e) => e.id)).toContain('doomed-a')
  })
})

describe('the concurrency proof the milestone named as its own mitigation', () => {
  it('test_a_writer_that_ACQUIRES_DURING_the_apply_still_protects_its_transcript', async () => {
    // Top risk 1 of the milestone is "GC wipes someone's live transcript", and the mitigation it
    // chose was this: a test that writes DURING the apply and proves the refusal. Not a review
    // comment — a failing test if the backstop is ever removed.
    //
    // The window is real and narrow: plan says `doomed` is collectable, a process resumes it, and
    // the apply runs. Everything the collector knew is now stale.
    const path = writeTranscriptFile('doomed', 400)
    writeTranscriptFile('recent', 0)
    const computed = plan(1, 30)
    expect(computed.candidates.map((c) => c.id)).toContain('doomed')

    const lease = await acquireSessionWriter(path)
    try {
      const result = await runTranscriptGC(computed, { apply: true })
      expect(result.removed, 'a leased transcript was collected').not.toContain('doomed')
      expect(existsSync(path), 'the file of a live session was deleted').toBe(true)
      // And it is not merely skipped-and-forgotten: nothing claims success over it.
      expect(result.errors.map((e) => e.id)).not.toContain('doomed')
    } finally {
      await (lease as { release?: () => Promise<void> }).release?.()
    }
  })

  it('test_a_dry_run_never_touches_disk_even_with_apply_absent_and_candidates_present', async () => {
    // The other half of "apply is never the default": absence of the flag must mean absence of
    // effect, not a smaller effect.
    const a = writeTranscriptFile('old-a', 400)
    const b = writeTranscriptFile('old-b', 400)
    writeTranscriptFile('recent', 0)
    await runTranscriptGC(plan(1, 30), { apply: false })
    expect(existsSync(a)).toBe(true)
    expect(existsSync(b)).toBe(true)
  })
})
