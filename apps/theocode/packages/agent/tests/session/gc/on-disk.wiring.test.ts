/**
 * Pillar (b) of the wiring triad for the delete path: the boundary the unit tests mock.
 *
 * Every test in this directory injects its own `unlink`, which proves the PLANNER calls the seam and
 * says nothing about what the seam is bound to. `runAllProjectsOnDisk` is where the real bindings
 * live — `fsp.unlink`, `fsp.rmdir`, `Agent.delete`, `sessionHasWriter`, `readPointerId` — and it had
 * NO test at all. Measured 2026-09-03 by mutation: replacing `unlink: (path) => fsp.unlink(path)`
 * with a no-op left every case in this directory green.
 *
 * The failure that hides there is the quiet one. A collector wired to a no-op reports a finished
 * sweep, lists what it "removed", and removes nothing — the same shape as B-138, at the last hop
 * before the filesystem.
 *
 * SCOPE, stated because this test deletes real files: every path it touches is created under
 * `mkdtempSync` in this run, and the plan is hand-built so the only candidate is that file. Nothing
 * discovers paths, and `projectsRoot` is overridden so no real projects tree is reachable.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { runAllProjectsOnDisk } from '../../../src/session/gc/filesystem.js'

/**
 * Scratch roots, removed when the file finishes.
 *
 * MEASURED 2026-09-03: /tmp held 2 773 leaked `theocode-*` directories from suites that create one
 * per case and never remove it — 1 546 from one file alone. Sixteen other test files here already
 * clean up, so this follows the convention rather than inventing one, and the cost of not doing it
 * is paid once per test on every machine that ever runs the suite.
 */
const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

function scratch(): { root: string; project: string; transcript: string } {
  const root = mkdtempSync(join(tmpdir(), 'theocode-gc-wiring-'))
  roots.push(root)
  const project = join(root, 'a-project')
  mkdirSync(project, { recursive: true })
  const transcript = join(project, 'sess-old.jsonl')
  writeFileSync(transcript, '{}\n')
  return { root, project, transcript }
}

const planFor = (transcript: string) => ({
  candidates: [{ project: 'a-project', kind: 'transcript' as const, target: transcript, ageDays: 90 }],
  kept: [],
  touchedProjects: [],
  liveCwds: [],
  totalByKind: {} as never,
  errors: [],
})

describe('the on-disk wiring of the delete path', () => {
  it('test_apply_actually_removes_the_file_from_the_filesystem', async () => {
    const { root, transcript } = scratch()

    const result = await runAllProjectsOnDisk(planFor(transcript), { apply: true, projectsRoot: root })

    expect(existsSync(transcript), 'the collector reported a removal it did not perform').toBe(false)
    expect(result.removed).toContain(transcript)
    expect(result.errors).toEqual([])
  })

  it('test_a_dry_run_leaves_the_file_where_it_is', async () => {
    // Anti-vacuity in the direction that matters most: a wiring that deleted unconditionally would
    // satisfy the case above, and this is the one that would catch it.
    const { root, transcript } = scratch()

    const result = await runAllProjectsOnDisk(planFor(transcript), { projectsRoot: root })

    expect(existsSync(transcript), 'a DRY RUN deleted a file').toBe(true)
    expect(result.dryRun).toBe(true)
  })

  it('test_a_file_that_vanished_between_plan_and_apply_is_not_an_error', async () => {
    // ENOENT means somebody else already removed it, which is the outcome this path wanted. Treating
    // it as a failure would fill the report with errors about work that succeeded.
    const { root, transcript } = scratch()

    const result = await runAllProjectsOnDisk(
      planFor(join(root, 'a-project', 'never-existed.jsonl')),
      { apply: true, projectsRoot: root },
    )

    expect(result.errors).toEqual([])
    expect(existsSync(transcript), 'an unrelated file was removed').toBe(true)
  })
})
