/**
 * A session the registry still lists is never collected, however old it is.
 *
 * An independent review raised this as SUSPECTED and could not drive it: `--resume` of a transcript
 * older than the retention window, in a project with enough newer siblings that `keepLast` does not
 * reach it. Its reasoning was that the pointer is written fire-and-forget from the composition root,
 * so at sweep time it may not exist yet — leaving "only the registry and the SDK writer lease"
 * between that transcript and `unlink`.
 *
 * The question is answerable rather than suspected, so it is answered here: the registry guard is
 * unconditional on age. the planner protects every non-archived registry entry, and the window is never consulted for a protected id.
 *
 * These tests pin that, and pin the boundary of it — an ARCHIVED session is not protected by the
 * registry, which is what makes archive-then-collect work at all.
 */
import { describe, expect, it } from 'vitest'

import { fileOf, planVirtual, targetOf, targets } from './plan-harness.js'

const CWD = '/cwd/p'
const RESUMED = fileOf(CWD, 'resumed-long-ago')

/** One very old transcript plus enough newer ones that `keepLast` cannot reach it. */
const entries = [
  ...Array.from({ length: 12 }, (_, i) => ({ name: `recent-${String(i)}.jsonl`, ageDays: i + 1 })),
  { name: RESUMED, ageDays: 400 },
]

async function planWith(registry: { id: string; archived?: boolean }[]) {
  return planVirtual({
    keepLast: 10,
    liveness: () => 'alive',
    projects: { [CWD]: entries },
    registry: async () => registry,
    // The pointer deliberately absent: the review's premise is that it has not been written yet.
  })
}

describe('a session the registry lists', () => {
  it('test_it_is_kept_however_old_it_is_and_with_no_pointer_written', async () => {
    // The review's scenario, driven: 400 days old, outside keepLast, no pointer.
    const plan = await planWith([{ id: 'resumed-long-ago' }])

    expect(
      targets(plan),
      'a session the registry still lists was planned for deletion',
    ).not.toContain(targetOf(CWD, RESUMED))
  })

  it('test_the_same_transcript_IS_collected_when_the_registry_does_not_list_it', async () => {
    // Anti-vacuity: without this the test above would pass for a collector that deletes nothing.
    expect(targets(await planWith([]))).toContain(targetOf(CWD, RESUMED))
  })

  it('test_an_archived_session_is_not_protected_by_the_registry', async () => {
    // The boundary, and it is deliberate: archive is the logical takedown that precedes physical
    // removal. If archiving did not release the guard, nothing archived could ever be collected.
    const plan = await planWith([{ id: 'resumed-long-ago', archived: true }])

    expect(targets(plan)).toContain(targetOf(CWD, RESUMED))
  })
})
