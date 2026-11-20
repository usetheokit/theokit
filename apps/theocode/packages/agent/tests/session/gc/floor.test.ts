/**
 * B-003 — the guards that exist specifically to prevent data loss, now with tests.
 *
 * These ~740 LoC delete user transcripts, registry entries, orphan locks and temp files. Every
 * options interface was built as an injectable seam — the design was clearly made FOR tests that
 * were never written, which is how `hasLiveWriter` could be a required, wired, never-called guard.
 *
 * Per rules/testing.md § 3, business rules on a deletion path get tests. These are those rules.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GCFloorError } from '@theokit/agents/session'
import { afterAll, describe, expect, it } from 'vitest'

import { planAllProjectsOnDisk } from '../../../src/session/gc/projects-gc.js'
import { claimRoot } from '../../../src/session/gc/root-ownership.js'
import { fileOf, planVirtual, targets } from './plan-harness.js'

const CWD = '/proj'
const NEWER = { name: 'newer.jsonl', ageDays: 31 }

describe('B-003 — the age window is a floor, not a suggestion', () => {
  it('test_a_transcript_inside_the_window_is_never_planned', async () => {
    const plan = await planVirtual({
      projects: { [CWD]: [NEWER, { name: 'fresh.jsonl', ageDays: 1 }] },
    })

    expect(targets(plan).some((t) => t.endsWith('fresh.jsonl'))).toBe(false)
  })

  it('test_a_transcript_past_the_window_is_planned', async () => {
    // Anti-vacuity floor for the assertion above (the newest is the quota's, so the stale one is the
    // second).
    const plan = await planVirtual({
      projects: {
        [CWD]: [
          { name: 'new.jsonl', ageDays: 40 },
          { name: 'stale.jsonl', ageDays: 60 },
        ],
      },
    })

    expect(targets(plan)).toHaveLength(1)
  })
})

describe('B-003 — the live pointer is never collected', () => {
  it('test_the_pointed_session_is_kept_however_stale', async () => {
    const pointed = fileOf(CWD, 'pointed')
    const plan = await planVirtual({
      liveness: () => 'alive',
      pointer: () => 'pointed',
      projects: {
        [CWD]: [
          { name: 'decoy.jsonl', ageDays: 40 },
          { name: pointed, ageDays: 900 },
        ],
      },
    })

    expect(
      plan.candidates,
      'the session a running TUI is writing to was planned for deletion because it was old — ' +
        'age is not evidence that a session is dead',
    ).toEqual([])
  })
})

describe('B-003 — keepLast retains the newest transcripts', () => {
  it('test_the_newest_transcripts_survive_regardless_of_age', async () => {
    const plan = await planVirtual({
      keepLast: 2,
      liveness: () => 'alive',
      projects: {
        [CWD]: [
          { name: 'a.jsonl', ageDays: 100 },
          { name: 'b.jsonl', ageDays: 200 },
          { name: 'c.jsonl', ageDays: 300 },
        ],
      },
    })

    // The two most recent are kept; only the oldest is collectable.
    expect(targets(plan)).toEqual([expect.stringContaining('c.jsonl')])
  })
})

describe('B-003 — a lock whose transcript still exists is not an orphan', () => {
  it('test_a_lock_with_a_live_sibling_transcript_is_kept', async () => {
    const plan = await planVirtual({
      projects: {
        [CWD]: [
          { name: 'sess.jsonl', ageDays: 1 },
          { name: 'sess.jsonl.writer.lock', ageDays: 90 },
          { name: 'sess.jsonl.lock', ageDays: 90, isDirectory: true },
        ],
      },
    })

    expect(
      plan.candidates,
      'the lock was collected while its transcript was still on disk — the lock is only an orphan ' +
        'once the session it guards is gone',
    ).toEqual([])
  })

  it('test_a_lock_whose_transcript_is_gone_is_collected', async () => {
    // Anti-vacuity: a planner that never collected a lock would satisfy the case above.
    const plan = await planVirtual({
      projects: { [CWD]: [{ name: 'gone.jsonl.writer.lock', ageDays: 90 }] },
    })

    expect(plan.candidates.map((c) => c.kind)).toEqual(['writer-lock'])
  })
})

/**
 * The floor REFUSES; it does not normalise.
 *
 * The planner throws `GCFloorError` when `maxAgeDays` is below the floor of one day: silently
 * normalising would delete yesterday's session. That guard sits on the only path in this product
 * that removes a user's data, and the claim that the delete path fails towards keeping needs
 * something that fails when it stops being true.
 */
describe('the retention floor is a refusal, not a normalisation', () => {
  const home = mkdtempSync(join(tmpdir(), 'theocode-floor-'))
  const projectsRoot = join(home, 'projects')
  claimRoot(projectsRoot)
  afterAll(() => rmSync(home, { recursive: true, force: true }))

  it('test_a_window_below_the_floor_is_refused', async () => {
    await expect(planAllProjectsOnDisk({ projectsRoot, maxAgeDays: 0 })).rejects.toThrow(
      GCFloorError,
    )
  })

  it('test_a_negative_window_is_refused', async () => {
    await expect(planAllProjectsOnDisk({ projectsRoot, maxAgeDays: -30 })).rejects.toThrow(
      GCFloorError,
    )
  })

  it('test_the_refusal_says_what_the_floor_is_and_why_it_exists', async () => {
    // A guard that refuses without saying why gets removed by the next person who hits it.
    await expect(planAllProjectsOnDisk({ projectsRoot, maxAgeDays: 0 })).rejects.toThrow(
      /at least 1.*refused rather than clamped/s,
    )
  })

  it('test_the_floor_itself_is_accepted', async () => {
    // Anti-vacuity: refusing everything would satisfy the assertions above.
    await expect(planAllProjectsOnDisk({ projectsRoot, maxAgeDays: 1 })).resolves.toBeDefined()
  })
})
