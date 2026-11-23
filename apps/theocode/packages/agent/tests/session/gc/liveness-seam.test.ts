/**
 * The seam the absorption did NOT remove.
 *
 * `classifyProjects` from `@theokit/agents/session` replaced 188 lines of oracle that lived in this
 * package, and the framework carries that algorithm's tests. What it cannot carry is the part that
 * is still ours: the `FsSeam` adapter, and the translation from the framework's verdict into this
 * GC's vocabulary. Both sit on the path that UNLINKS user data, and a regression in either is
 * invisible to every test in the framework.
 *
 * B-020 is the scar being defended. The adapter's job is to distinguish "not there" from "could not
 * look": ENOENT is the only errno that means absence, and mapping the others to `false` classified
 * live projects DEAD. The framework's seam is typed `boolean | undefined` precisely so an adapter
 * has somewhere to put the third answer — but the type cannot force the adapter to use it, which is
 * why this file exists.
 *
 * Driven through `planAllProjectsOnDisk` against a REAL temp tree rather than through the private
 * functions, so what is asserted is the wiring a user gets, not an internal one test agrees with.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { encodeProjectDir } from '@theokit/agents/persistence'

import { claimRoot } from '../../../src/session/gc/root-ownership.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { planAllProjectsOnDisk } from '../../../src/session/gc/filesystem.js'

const POSIX = process.platform !== 'win32'

let root: string
let live: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theocode-gc-seam-'))
  // The collector refuses a root it did not mark, so a test driving the real disk path has to own
  // its scratch tree the way production owns `~/.theokit/projects`. Claiming here rather than
  // exempting `opts.projectsRoot` in the guard: an internal seam that skips the check is the escape
  // hatch that admits the defect the check exists for.
  claimRoot(root)
  live = mkdtempSync(join(tmpdir(), 'theocode-live-project-'))
})

afterEach(() => {
  for (const d of [root, live]) {
    try {
      chmodSync(d, 0o700)
    } catch {
      /* already gone or not ours */
    }
    rmSync(d, { recursive: true, force: true })
  }
})

/** A project directory holding one transcript whose first record names `cwd`. */
function projectFor(cwd: string, transcript = 'sess-a.jsonl'): string {
  const name = encodeProjectDir(cwd)
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, transcript)
  writeFileSync(file, `${JSON.stringify({ cwd })}\n`, 'utf8')
  // Old enough to clear the collection window, so the only thing deciding the outcome is the
  // liveness verdict — which is what this file is about. `maxAgeDays` has a floor of 1 and refuses
  // to be normalised (the GC's own invariant), so age has to come from the fixture.
  const old = new Date(Date.now() - 90 * 86_400_000)
  utimesSync(file, old, old)
  return name
}

describe('the liveness seam — what the framework cannot test for us', () => {
  it('test_a_project_whose_cwd_exists_is_not_planned_for_deletion', async () => {
    // Anti-vacuity floor. Without it, an adapter that reported everything UNDETERMINED would satisfy
    // every case below while doing nothing.
    projectFor(live)

    const plan = await planAllProjectsOnDisk({ projectsRoot: root, keepLast: 0, maxAgeDays: 1 })

    expect(plan.candidates.map((c) => c.target).join(' ')).not.toContain(encodeProjectDir(live))
  })

  it('test_a_project_whose_recorded_cwd_is_gone_is_reachable_for_collection', async () => {
    // The other half of the floor: the seam must still be able to reach a verdict that DELETES, or
    // the GC is inert and the tests above prove nothing.
    const gone = join(live, 'a-directory-that-was-removed')
    projectFor(gone)

    const plan = await planAllProjectsOnDisk({ projectsRoot: root, keepLast: 0, maxAgeDays: 1 })

    expect(plan.candidates.map((c) => c.target).join(' ')).toContain(encodeProjectDir(gone))
  })

  it.skipIf(!POSIX)('test_a_cwd_that_cannot_be_stat_ed_is_never_collected', async () => {
    // B-020, at the only layer that can still get it wrong. The cwd EXISTS, but its parent is not
    // traversable, so `statSync` fails with EACCES rather than ENOENT. An adapter that mapped that
    // to `false` would classify a live project DEAD — which is a deletion.
    const parent = mkdtempSync(join(tmpdir(), 'theocode-noexec-'))
    const cwd = join(parent, 'project')
    mkdirSync(cwd, { recursive: true })
    const name = projectFor(cwd)
    chmodSync(parent, 0o000)

    try {
      const plan = await planAllProjectsOnDisk({ projectsRoot: root, keepLast: 0, maxAgeDays: 1 })

      expect(
        plan.candidates.map((c) => c.target).join(' '),
        'a cwd we could not stat was treated as a cwd we know to be gone',
      ).not.toContain(name)
    } finally {
      chmodSync(parent, 0o700)
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('test_a_project_directory_with_no_transcript_is_not_collected', async () => {
    // The deleted oracle searched the filesystem from `/` for this case. The framework takes a
    // candidate pool instead and this product supplies none, so the verdict is `undetermined` —
    // which the collector KEEPS. Recorded as an assertion so the behaviour change is pinned rather
    // than discovered later: stale directories survive, live projects are never deleted.
    const name = encodeProjectDir(join(live, 'no-transcript-here'))
    mkdirSync(join(root, name), { recursive: true })

    const plan = await planAllProjectsOnDisk({ projectsRoot: root, keepLast: 0, maxAgeDays: 1 })

    expect(plan.candidates.map((c) => c.target).join(' ')).not.toContain(name)
  })
})
