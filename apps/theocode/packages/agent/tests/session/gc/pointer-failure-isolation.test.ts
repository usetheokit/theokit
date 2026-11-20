/**
 * B-143 — one unreadable pointer stopped collection for the whole tree.
 *
 * `readPointerId` fails fast on any errno but ENOENT, and its docblock gives the reason: what it
 * returns is a deletion decision, so swallowing an EACCES would drop a live session from the
 * protected set. "Refusing to GC is the safe direction" — correct, and it is an argument about THAT
 * PROJECT.
 *
 * The call sat outside every `try` in `resolveGuards` (the old `resolveGuards`, between the catch that
 * wraps `listProject` and the one that wraps `listRegistry`), so the throw unwound past both, out of
 * `planOneProject`, and out of `planSessionGCAllProjects` itself. Measured: the whole plan rejects.
 * One project with a permissions problem meant no project anywhere was collected — and with the
 * automatic trigger the parent has already written its stamp, so it would not retry for 24 hours,
 * every day, forever.
 *
 * Found by an independent adversarial review, verified here before believing it.
 */
import { describe, expect, it } from 'vitest'

import { planVirtual, targetOf, targets } from './plan-harness.js'

// TWO transcripts per project: the newest is the quota's, so a single-transcript project can never
// produce a candidate and would make these assertions vacuous.
const stale = [
  { name: 'newest.jsonl', ageDays: 1 },
  { name: 'old.jsonl', ageDays: 90 },
]

const eacces = (): never => {
  const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException
  err.code = 'EACCES'
  throw err
}

const BROKEN = '/cwd/broken'
const HEALTHY = '/cwd/healthy'

async function planWith(pointer: (cwd: string) => string | undefined) {
  return planVirtual({
    // Both ALIVE, each with its own cwd, so only one pointer read fails.
    liveness: () => 'alive',
    projects: { [BROKEN]: stale, [HEALTHY]: stale },
    pointer,
  })
}

describe('a failing pointer read is isolated to its project', () => {
  it('test_the_sweep_completes_instead_of_rejecting', async () => {
    // The finding. Before this, the returned promise rejected and nothing anywhere was collected.
    await expect(planWith((cwd) => (cwd === BROKEN ? eacces() : undefined))).resolves.toBeDefined()
  })

  it('test_the_healthy_project_is_still_collected', async () => {
    const plan = await planWith((cwd) => (cwd === BROKEN ? eacces() : undefined))

    expect(
      targets(plan),
      'a permissions problem in one project stopped collection in another',
    ).toEqual([targetOf(HEALTHY, 'old.jsonl')])
  })

  it('test_the_broken_project_is_skipped_rather_than_collected', async () => {
    // The safe direction the pointer docblock argues for, kept — for that project only.
    const plan = await planWith((cwd) => (cwd === BROKEN ? eacces() : undefined))

    expect(targets(plan)).not.toContain(targetOf(BROKEN, 'old.jsonl'))
  })

  it('test_the_reason_is_reported_rather_than_silently_skipped', async () => {
    // "I found nothing" and "I could not look" are different facts.
    const plan = await planWith((cwd) => (cwd === BROKEN ? eacces() : undefined))

    expect(plan.errors.map((e) => `${e.project} ${e.message}`).join(' ')).toContain('broken')
  })

  // The message names the READ that failed, not just the project: an operator whose pointer file is
  // unreadable must not be sent to look at the registry.
  it('test_a_failing_pointer_read_is_not_reported_as_a_registry_problem', async () => {
    const plan = await planWith((cwd) => (cwd === BROKEN ? eacces() : undefined))

    const said = plan.errors.map((e) => e.message).join(' ')
    expect(said, 'the pointer failed and the message blamed the registry').toContain('pointer')
    expect(said).not.toContain('registry')
  })

  it('test_a_failing_registry_read_still_names_the_registry', async () => {
    // The other half, so the fix cannot be "rename it to pointer and move on".
    const plan = await planVirtual({
      liveness: () => 'alive',
      projects: { [BROKEN]: stale },
      registry: async () => eacces(),
    })

    expect(plan.errors.map((e) => e.message).join(' ')).toContain('registry')
  })

  it('test_a_healthy_tree_still_collects_everything', async () => {
    // Anti-vacuity: skipping every project would satisfy the assertions above.
    const plan = await planWith(() => undefined)

    expect(plan.candidates).toHaveLength(2)
  })
})
