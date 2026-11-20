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
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GCFloorError } from '@theokit/agents/session'
import { afterAll, describe, expect, it } from 'vitest'

import { planAndRunCurrentProjectGC } from '../../../../cli/src/commands/sessions.js'
import { planAllProjectsOnDisk } from '../../../src/session/gc/projects-gc.js'
import { claimRoot } from '../../../src/session/gc/root-ownership.js'

const perSessionSeams = {
  cwd: '/home/operator/a-project',
  root: '/nonexistent-theocode-root',
  apply: false,
  listRegistry: async () => [],
}

// An owned, empty root: the collector refuses an unmarked one before it looks at the window.
const home = mkdtempSync(join(tmpdir(), 'theocode-floor-'))
const allProjectsSeams = { projectsRoot: join(home, 'projects') }
claimRoot(allProjectsSeams.projectsRoot)
afterAll(() => rmSync(home, { recursive: true, force: true }))

describe('the collection floor', () => {
  it('test_the_single_project_plan_refuses_a_window_below_the_floor', async () => {
    // The framework's floor error is a GCFloorError, not a RangeError.
    await expect(planAndRunCurrentProjectGC({ ...perSessionSeams, maxAgeDays: 0 })).rejects.toThrow(
      GCFloorError,
    )
  })

  it('test_the_all_projects_plan_refuses_the_same_window', async () => {
    // The arm that already held. Present so a regression that removes the floor from EITHER path
    // is caught, rather than the two drifting again.
    await expect(planAllProjectsOnDisk({ ...allProjectsSeams, maxAgeDays: 0 })).rejects.toThrow(
      GCFloorError,
    )
  })

  it('test_both_plans_accept_the_floor_itself', async () => {
    // Anti-vacuity. A guard written as `<= FLOOR` rather than `< FLOOR` would pass both cases above
    // and reject the smallest window a user is allowed to ask for.
    await expect(
      planAndRunCurrentProjectGC({ ...perSessionSeams, maxAgeDays: 1 }),
    ).resolves.toBeDefined()
    await expect(
      planAllProjectsOnDisk({ ...allProjectsSeams, maxAgeDays: 1 }),
    ).resolves.toBeDefined()
  })
})
