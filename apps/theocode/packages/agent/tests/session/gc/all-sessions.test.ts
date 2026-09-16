/**
 * B-003 — a transcript with a live writer is never planned for deletion.
 *
 * `hasLiveWriter` is a REQUIRED field of the plan options and is wired to the SDK's
 * `sessionHasWriter`, a cross-process filesystem lease. It was never called in the plan phase: its
 * only two uses sat inside `backstopRefusal`, behind a guard that returns early for everything that
 * is not a lock. So transcript deletion consulted the lease in neither phase.
 *
 * What protected a live transcript instead was the `ageDays > maxAgeDays` filter — a live writer
 * keeps the file's mtime fresh by appending. That is a real mitigation, and it is why this was rated
 * HIGH rather than BLOCKER; it is also an mtime heuristic standing in for an explicit lease the SDK
 * already provides and the caller already wired.
 *
 * A guard that is declared, wired and never invoked is worse than an absent one: it reads as
 * protection.
 */
import { describe, expect, it, vi } from 'vitest'

import { planSessionGCAllProjects } from '../../../src/session/gc/all-sessions.js'

const DAY = 86_400_000
const NOW = 1_000 * DAY

/** One project holding one transcript old enough to be collectable. */
function options(overrides: Partial<Parameters<typeof planSessionGCAllProjects>[0]> = {}) {
  return {
    now: () => NOW,
    keepLast: 0,
    maxAgeDays: 30,
    listProjects: () => ['proj'],
    listProject: () => [{ name: 'sess-old.jsonl', isDirectory: false, mtimeMs: NOW - 60 * DAY }],
    classify: () => ({ state: 'DEAD' as const, cwd: '/proj' }),
    listRegistry: async () => [],
    hasLiveWriter: () => false,
    readPointer: () => undefined,
    ...overrides,
  } as Parameters<typeof planSessionGCAllProjects>[0]
}

describe('B-003 — the plan phase consults the writer lease', () => {
  it('test_a_stale_transcript_with_no_live_writer_is_collectable', async () => {
    // Anti-vacuity floor: if nothing were ever planned, the test below would pass for free.
    const plan = await planSessionGCAllProjects(options())

    expect(
      plan.candidates.some((c) => c.target.endsWith('sess-old.jsonl')),
      'the fixture stopped producing a collectable transcript, so the guard test below proves nothing',
    ).toBe(true)
  })

  it('test_a_transcript_with_a_live_writer_is_NOT_planned_for_deletion', async () => {
    const hasLiveWriter = vi.fn(() => true)

    const plan = await planSessionGCAllProjects(options({ hasLiveWriter }))

    expect(
      hasLiveWriter,
      '`hasLiveWriter` is a required option wired to the SDK lease and was never called in the plan ' +
        'phase — transcript deletion consulted the lease in neither phase',
    ).toHaveBeenCalled()
    expect(
      plan.candidates.filter((c) => c.kind === 'transcript'),
      'a transcript being written to right now was planned for deletion. Only its mtime freshness ' +
        'stood between a live session and unlink.',
    ).toEqual([])
  })
})
