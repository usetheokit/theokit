/**
 * The collection floor belongs to the COMMAND, not to whichever planner happens to run.
 *
 * `sessions gc --max-age-days 0` reaches one of two implementations depending on `--all-projects`.
 * `planSessionGCAllProjects` refuses it with a stated reason — *"silently normalising would delete
 * yesterday's session"* — and `planSessionGC`, the DEFAULT form reached without the flag, had no
 * floor at all: `maxAgeDays ?? 30` took the value verbatim and `ageDays > maxAgeDays` then planned
 * every transcript in the project outside the protected set.
 *
 * The argument for the floor does not depend on how many projects are being swept, so a user typing
 * the same number got a refusal or a mass deletion according to a flag that has nothing to do with
 * it. One rule, enforced on both paths.
 */
import { describe, expect, it } from 'vitest'

import { planSessionGCAllProjects } from '../../../src/session/gc/all-sessions.js'
import { planSessionGC } from '../../../src/session/gc/per-session.js'

const allProjectsSeams = {
  projectsRoot: '/projects',
  listProjects: () => [],
  listProject: () => [],
  classify: () => ({ state: 'DEAD' as const }),
  listRegistry: async () => [] as never,
  hasLiveWriter: () => false,
  readPointer: () => undefined,
}

const perSessionSeams = {
  cwd: '/home/operator/a-project',
  list: async () => [] as never,
  readdir: () => [],
  readPointer: () => undefined,
}

describe('the collection floor', () => {
  it('test_the_single_project_plan_refuses_a_window_below_the_floor', async () => {
    await expect(planSessionGC({ ...perSessionSeams, maxAgeDays: 0 })).rejects.toThrow(RangeError)
  })

  it('test_the_all_projects_plan_refuses_the_same_window', async () => {
    // The arm that already held. Present so a regression that removes the floor from EITHER path
    // is caught, rather than the two drifting again.
    await expect(
      planSessionGCAllProjects({ ...allProjectsSeams, maxAgeDays: 0 }),
    ).rejects.toThrow(RangeError)
  })

  it('test_both_plans_accept_the_floor_itself', async () => {
    // Anti-vacuity. A guard written as `<= FLOOR` rather than `< FLOOR` would pass both cases above
    // and reject the smallest window a user is allowed to ask for.
    await expect(planSessionGC({ ...perSessionSeams, maxAgeDays: 1 })).resolves.toBeDefined()
    await expect(
      planSessionGCAllProjects({ ...allProjectsSeams, maxAgeDays: 1 }),
    ).resolves.toBeDefined()
  })
})
