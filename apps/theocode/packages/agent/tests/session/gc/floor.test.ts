/**
 * B-003 — the guards that exist specifically to prevent data loss, now with tests.
 *
 * These ~740 LoC delete user transcripts, registry entries, orphan locks and temp files. Every
 * options interface was built as an injectable seam — the design was clearly made FOR tests that
 * were never written, which is how `hasLiveWriter` could be a required, wired, never-called guard.
 *
 * Per rules/testing.md § 3, business rules on a deletion path get tests. These are those rules.
 */
import { describe, expect, it } from 'vitest'

import { planSessionGCAllProjects } from '../../../src/session/gc/all-sessions.js'

const DAY = 86_400_000
const NOW = 1_000 * DAY

function options(
  entries: { name: string; isDirectory?: boolean; ageDays: number }[],
  overrides: Record<string, unknown> = {},
) {
  return {
    now: () => NOW,
    keepLast: 0,
    maxAgeDays: 30,
    projectsRoot: '/root',
    listProjects: () => ['proj'],
    listProject: () =>
      entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory ?? false,
        mtimeMs: NOW - e.ageDays * DAY,
      })),
    classify: () => ({ state: 'DEAD' as const, cwd: '/proj' }),
    listRegistry: async () => [],
    hasLiveWriter: () => false,
    readPointer: () => undefined,
    ...overrides,
  } as Parameters<typeof planSessionGCAllProjects>[0]
}

describe('B-003 — the age window is a floor, not a suggestion', () => {
  it('test_a_transcript_inside_the_window_is_never_planned', async () => {
    const plan = await planSessionGCAllProjects(options([{ name: 'fresh.jsonl', ageDays: 1 }]))

    expect(plan.candidates).toEqual([])
  })

  it('test_a_transcript_past_the_window_is_planned', async () => {
    // Anti-vacuity floor for the assertion above.
    const plan = await planSessionGCAllProjects(options([{ name: 'stale.jsonl', ageDays: 60 }]))

    expect(plan.candidates).toHaveLength(1)
  })
})

describe('B-003 — the live pointer is never collected', () => {
  it('test_the_pointed_session_is_kept_however_stale', async () => {
    const plan = await planSessionGCAllProjects(
      options([{ name: 'pointed.jsonl', ageDays: 900 }], {
        readPointer: () => 'pointed',
        classify: () => ({ state: 'ALIVE' as const, cwd: '/proj' }),
      }),
    )

    expect(
      plan.candidates,
      'the session a running TUI is writing to was planned for deletion because it was old — ' +
        'age is not evidence that a session is dead',
    ).toEqual([])
  })
})

describe('B-003 — keepLast retains the newest transcripts', () => {
  it('test_the_newest_transcripts_survive_regardless_of_age', async () => {
    const plan = await planSessionGCAllProjects(
      options(
        [
          { name: 'a.jsonl', ageDays: 100 },
          { name: 'b.jsonl', ageDays: 200 },
          { name: 'c.jsonl', ageDays: 300 },
        ],
        { keepLast: 2, classify: () => ({ state: 'ALIVE' as const, cwd: '/proj' }) },
      ),
    )

    // The two most recent are kept; only the oldest is collectable.
    expect(plan.candidates.map((c) => c.target)).toEqual([expect.stringContaining('c.jsonl')])
  })
})

describe('B-003 — a lock whose transcript still exists is not an orphan', () => {
  it('test_a_lock_with_a_live_sibling_transcript_is_kept', async () => {
    const plan = await planSessionGCAllProjects(
      options([
        { name: 'sess.jsonl', ageDays: 1 },
        { name: 'sess.jsonl.lock', ageDays: 90 },
      ]),
    )

    expect(
      plan.candidates,
      'the lock was collected while its transcript was still on disk — the lock is only an orphan ' +
        'once the session it guards is gone',
    ).toEqual([])
  })
})

/**
 * The floor REFUSES; it does not normalise.
 *
 * `planSessionGCAllProjects` throws when `maxAgeDays` is below `FLOOR_DAYS`, and the message says
 * why: "silently normalising would delete yesterday's session". That guard sits on the only path in
 * this product that removes a user's data and had no test — a comment in `liveness-seam.test.ts`
 * mentioned it, which is documentation, not a gate.
 *
 * Found 2026-09-03 while writing down the reliability target in the README: the target claims the
 * delete path fails towards keeping, and a claim in a versioned file needs something that fails when
 * it stops being true.
 */
describe('the retention floor is a refusal, not a normalisation', () => {
  const base = { projectsRoot: '/nonexistent-for-this-test', projects: [] as string[] }

  it('test_a_window_below_the_floor_is_refused', async () => {
    await expect(planSessionGCAllProjects({ ...base, maxAgeDays: 0 } as never)).rejects.toThrow(
      RangeError,
    )
  })

  it('test_a_negative_window_is_refused', async () => {
    await expect(planSessionGCAllProjects({ ...base, maxAgeDays: -30 } as never)).rejects.toThrow(
      RangeError,
    )
  })

  it('test_the_refusal_says_what_the_floor_is_and_why_it_exists', async () => {
    // A guard that refuses without saying why gets removed by the next person who hits it.
    await expect(
      planSessionGCAllProjects({ ...base, maxAgeDays: 0 } as never),
    ).rejects.toThrow(/floor of 1 day/)
  })

  it('test_the_floor_itself_is_accepted', async () => {
    // Anti-vacuity: refusing everything would satisfy the assertions above. One day is a legitimate
    // choice for someone who wants an aggressive sweep; the floor bounds it, it does not forbid it.
    await expect(
      planSessionGCAllProjects({ ...base, maxAgeDays: 1 } as never),
    ).resolves.toBeDefined()
  })
})
