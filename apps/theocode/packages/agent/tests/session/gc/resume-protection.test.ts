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
 * unconditional on age. `resolveGuards` adds every non-archived registry entry to the protected set
 * (`all-sessions.ts`), and the window is never consulted for a protected id.
 *
 * These tests pin that, and pin the boundary of it — an ARCHIVED session is not protected by the
 * registry, which is what makes archive-then-collect work at all.
 */
import { describe, expect, it } from 'vitest'

import { planSessionGCAllProjects } from '../../../src/session/gc/all-sessions.js'

const NOW = Date.UTC(2026, 8, 3)
const DAY = 86_400_000

/** One very old transcript plus enough newer ones that `keepLast` cannot reach it. */
const entries = [
  ...Array.from({ length: 12 }, (_, i) => ({
    name: `recent-${String(i)}.jsonl`,
    isDirectory: false,
    mtimeMs: NOW - (i + 1) * DAY,
  })),
  { name: 'resumed-long-ago.jsonl', isDirectory: false, mtimeMs: NOW - 400 * DAY },
]

async function planWith(registry: { agentId: string; archived?: boolean }[]) {
  return planSessionGCAllProjects({
    projectsRoot: '/s',
    now: () => NOW,
    listProjects: () => ['p'],
    listProject: () => entries,
    classify: () => ({ state: 'ALIVE', cwd: '/cwd/p' }),
    listRegistry: async () => registry,
    hasLiveWriter: () => false,
    // The pointer deliberately absent: the review's premise is that it has not been written yet.
    readPointer: () => undefined,
    keepLast: 10,
  } as never)
}

const targets = (p: { candidates: { target: string }[] }): string[] => p.candidates.map((c) => c.target)

describe('a session the registry lists', () => {
  it('test_it_is_kept_however_old_it_is_and_with_no_pointer_written', async () => {
    // The review's scenario, driven: 400 days old, outside keepLast, no pointer.
    const plan = await planWith([{ agentId: 'resumed-long-ago' }])

    expect(
      targets(plan),
      'a session the registry still lists was planned for deletion',
    ).not.toContain('/s/p/resumed-long-ago.jsonl')
  })

  it('test_the_same_transcript_IS_collected_when_the_registry_does_not_list_it', async () => {
    // Anti-vacuity: without this the test above would pass for a collector that deletes nothing.
    const plan = await planWith([])

    expect(targets(plan)).toContain('/s/p/resumed-long-ago.jsonl')
  })

  it('test_an_archived_session_is_not_protected_by_the_registry', async () => {
    // The boundary, and it is deliberate: archive is the logical takedown that precedes physical
    // removal. If archiving did not release the guard, nothing archived could ever be collected.
    const plan = await planWith([{ agentId: 'resumed-long-ago', archived: true }])

    expect(targets(plan)).toContain('/s/p/resumed-long-ago.jsonl')
  })
})
