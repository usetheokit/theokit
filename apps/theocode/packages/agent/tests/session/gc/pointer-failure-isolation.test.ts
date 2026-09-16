/**
 * B-143 — one unreadable pointer stopped collection for the whole tree.
 *
 * `readPointerId` fails fast on any errno but ENOENT, and its docblock gives the reason: what it
 * returns is a deletion decision, so swallowing an EACCES would drop a live session from the
 * protected set. "Refusing to GC is the safe direction" — correct, and it is an argument about THAT
 * PROJECT.
 *
 * The call sat outside every `try` in `resolveGuards` (`all-sessions.ts:143`, between the catch that
 * wraps `listProject` and the one that wraps `listRegistry`), so the throw unwound past both, out of
 * `planOneProject`, and out of `planSessionGCAllProjects` itself. Measured: the whole plan rejects.
 * One project with a permissions problem meant no project anywhere was collected — and with the
 * automatic trigger the parent has already written its stamp, so it would not retry for 24 hours,
 * every day, forever.
 *
 * Found by an independent adversarial review, verified here before believing it.
 */
import { describe, expect, it } from 'vitest'

import { planSessionGCAllProjects } from '../../../src/session/gc/all-sessions.js'

const NOW = Date.UTC(2026, 8, 3)
const DAY = 86_400_000
// TWO transcripts per project: for an ALIVE project the newest is protected as most-recent, so a
// single-transcript project can never produce a candidate and would make these assertions vacuous.
const stale = [
  { name: 'newest.jsonl', isDirectory: false, mtimeMs: NOW - 1 * DAY },
  { name: 'old.jsonl', isDirectory: false, mtimeMs: NOW - 90 * DAY },
]

const eacces = (): never => {
  const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException
  err.code = 'EACCES'
  throw err
}

async function planWith(readPointer: (cwd: string) => string | undefined) {
  return planSessionGCAllProjects({
    projectsRoot: '/s',
    now: () => NOW,
    listProjects: () => ['broken', 'healthy'],
    listProject: () => stale,
    // Both ALIVE, each with its own cwd, so only one pointer read fails.
    classify: (p: string) => ({ state: 'ALIVE', cwd: `/cwd/${p}` }),
    listRegistry: async () => [],
    hasLiveWriter: () => false,
    readPointer,
    keepLast: 0,
  } as never)
}

describe('a failing pointer read is isolated to its project', () => {
  it('test_the_sweep_completes_instead_of_rejecting', async () => {
    // The finding. Before this, the returned promise rejected and nothing anywhere was collected.
    await expect(
      planWith((cwd) => (cwd === '/cwd/broken' ? eacces() : undefined)),
    ).resolves.toBeDefined()
  })

  it('test_the_healthy_project_is_still_collected', async () => {
    const plan = await planWith((cwd) => (cwd === '/cwd/broken' ? eacces() : undefined))

    expect(
      plan.candidates.map((c) => c.target),
      'a permissions problem in one project stopped collection in another',
    ).toEqual(['/s/healthy/old.jsonl'])
  })

  it('test_the_broken_project_is_skipped_rather_than_collected', async () => {
    // The safe direction the pointer docblock argues for, kept — for that project only. Collecting
    // it would be the outcome `readPointerId` refuses to allow.
    const plan = await planWith((cwd) => (cwd === '/cwd/broken' ? eacces() : undefined))

    expect(plan.candidates.map((c) => c.target)).not.toContain('/s/broken/old.jsonl')
  })

  it('test_the_reason_is_reported_rather_than_silently_skipped', async () => {
    // "I found nothing" and "I could not look" are different facts — the rule B-020 states one
    // function above, applied to this one.
    const plan = await planWith((cwd) => (cwd === '/cwd/broken' ? eacces() : undefined))

    expect(plan.errors.join(' ')).toContain('broken')
  })

  // The message names the READ that failed, not just the project.
  //
  // B-143 widened what this catch covers — the pointer read moved inside the guard that already
  // wrapped the registry read — and the message it reports was left saying `registry unavailable`.
  // An operator whose pointer file is unreadable is then sent to look at the registry. Widening a
  // catch without widening its message is how a diagnostic starts pointing at the wrong file.
  it('test_a_failing_pointer_read_is_not_reported_as_a_registry_problem', async () => {
    const plan = await planWith((cwd) => (cwd === '/cwd/broken' ? eacces() : undefined))

    expect(plan.errors.join(' '), 'the pointer failed and the message blamed the registry').toContain(
      'pointer',
    )
  })

  it('test_a_failing_registry_read_still_names_the_registry', async () => {
    // The other half, so the fix cannot be "rename it to pointer and move on".
    const plan = await planSessionGCAllProjects({
      projectsRoot: '/s',
      now: () => NOW,
      listProjects: () => ['broken'],
      listProject: () => stale,
      classify: (p: string) => ({ state: 'ALIVE', cwd: `/cwd/${p}` }),
      listRegistry: async () => eacces(),
      hasLiveWriter: () => false,
      readPointer: () => undefined,
      keepLast: 0,
    } as never)

    expect(plan.errors.join(' ')).toContain('registry')
  })

  it('test_a_healthy_tree_still_collects_everything', async () => {
    // Anti-vacuity: skipping every project would satisfy the assertions above.
    const plan = await planWith(() => undefined)

    expect(plan.candidates).toHaveLength(2)
  })
})
