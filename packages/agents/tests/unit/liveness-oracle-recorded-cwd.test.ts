/**
 * Regression suite for the defect that made `classifyProjects` unusable by the consumer it was
 * absorbed from — and, worse, unsafe: it classified live projects `dead`, and the caller DELETES
 * on `dead`.
 *
 * Reproduced 2026-08-16 against the real module with the real `~/.theokit/projects` of the machine
 * this was measured on: 6 of 6 live project directories — including this repository, the SDK and
 * TheoCode itself — came back `dead`.
 *
 * Three defects, and only the first is the one everybody names:
 *
 * 1. The absorbed module kept the FALLBACK (search a caller-supplied pool) and dropped the
 *    ANSWER. The consumer resolves a project by reading the `cwd` field out of the first line of a
 *    transcript in that project's directory — the transcript records where it came from. Its own
 *    docstring measured that path resolving 91 of 120 sampled projects. No search, no heuristic,
 *    no budget spent.
 *
 * 2. `listProjects` named two different contracts across the seam T5.3 has to cross. The
 *    consumer's returns ENCODED DIRECTORY NAMES (classification is a separate injected seam); this
 *    module read it as REAL PATHS. Feeding one to the other is what produced the 6-of-6.
 *
 * 3. The fall-through emitted `dead` where the evidence supported at most `undetermined` — and its
 *    reason string said "no candidate project encodes to this name" when a candidate had matched.
 *    A pool the caller supplied is a heuristic, not an oracle; exhausting it proves nothing.
 *
 * The invariant every case here defends: a verdict of `dead` requires POSITIVE evidence of absence
 * — a recorded cwd that is not there. Everything else is `undetermined` (`rules/error-handling.md`,
 * and the module's own three-valued contract).
 */
import { describe, expect, it } from 'vitest'

import {
  classifyProjects,
  LivenessBudgetError,
  type FsSeam,
} from '../../src/session/liveness-oracle.js'

/** The encoding under test, restated here so the test does not depend on the module's private copy. */
const encode = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-')

/**
 * A seam over an in-memory tree. `ops` counts every call so the budget property is measurable
 * rather than asserted.
 */
function seamOver(
  existing: readonly string[],
  transcripts: Record<string, Record<string, string>> = {},
): FsSeam & { ops: () => number } {
  let ops = 0
  const present = new Set(existing)
  return {
    exists: (path) => {
      ops += 1
      return present.has(path)
    },
    listEntries: (dir) => {
      ops += 1
      return Object.keys(transcripts[dir] ?? {})
    },
    firstLine: (file) => {
      ops += 1
      const dir = file.slice(0, file.lastIndexOf('/'))
      const name = file.slice(file.lastIndexOf('/') + 1)
      return transcripts[dir]?.[name] ?? ''
    },
    ops: () => ops,
  }
}

const PROJECTS_ROOT = '/home/op/.theokit/projects'

describe('classifyProjects — the recorded cwd is the answer, the search is the fallback', () => {
  it('test_a_live_project_with_a_hyphen_in_its_path_is_alive_not_dead', () => {
    // The exact shape of the reproduction: a real path containing a hyphen, which is every path in
    // the tree this was measured on. The old `likelyPath` turned `-` into `/` and missed all of them.
    const cwd = '/home/op/Projetos/theo/theokit-framework'
    const name = encode(cwd)
    const fs = seamOver([cwd], {
      [`${PROJECTS_ROOT}/${name}`]: { 'a.jsonl': JSON.stringify({ cwd }) },
    })

    const out = classifyProjects([name], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => [],
      budget: 100,
      fs,
    })

    expect(out.get(name)?.liveness).toBe('alive')
  })

  it('test_an_empty_candidate_pool_is_undetermined_never_dead', () => {
    // "The product's enumerator gave me nothing" is could-not-tell. Deleting here is data loss.
    const name = encode('/home/op/somewhere')
    const fs = seamOver([])

    const out = classifyProjects([name], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => [],
      budget: 100,
      fs,
    })

    expect(out.get(name)?.liveness).toBe('undetermined')
  })

  it('test_a_pool_that_does_not_contain_the_project_is_undetermined_not_dead', () => {
    // A caller-supplied pool is a heuristic. Exhausting it proves the pool was incomplete, not
    // that the project is gone.
    const name = encode('/home/op/missing-from-the-pool')
    const fs = seamOver(['/home/op/other'])

    const out = classifyProjects([name], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => ['/home/op/other'],
      budget: 100,
      fs,
    })

    expect(out.get(name)?.liveness).toBe('undetermined')
  })

  it('test_a_recorded_cwd_that_is_gone_is_the_one_thing_that_proves_dead', () => {
    // The ONLY positive evidence of absence: the transcript says where it lived, and it is not there.
    const cwd = '/home/op/deleted-project'
    const name = encode(cwd)
    const fs = seamOver([], {
      [`${PROJECTS_ROOT}/${name}`]: { 'a.jsonl': JSON.stringify({ cwd }) },
    })

    const out = classifyProjects([name], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => [],
      budget: 100,
      fs,
    })

    expect(out.get(name)?.liveness).toBe('dead')
    expect(out.get(name)?.reason).toMatch(/recorded/i)
  })

  it('test_a_transcript_whose_cwd_does_not_encode_to_this_name_is_ignored', () => {
    // Guards against trusting a stray or copied transcript: the recorded cwd must encode back to
    // the directory it was found in, or it is not evidence about THIS project.
    const name = encode('/home/op/project-a')
    const fs = seamOver([], {
      [`${PROJECTS_ROOT}/${name}`]: { 'a.jsonl': JSON.stringify({ cwd: '/home/op/project-b' }) },
    })

    const out = classifyProjects([name], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => [],
      budget: 100,
      fs,
    })

    expect(out.get(name)?.liveness).toBe('undetermined')
  })

  it('test_the_recorded_cwd_answers_without_touching_the_candidate_pool', () => {
    // The measured reason the fast path matters: 91 of 120 resolve here, and each one that does
    // spends no search budget. A pool that throws proves the pool was never consulted.
    const cwd = '/home/op/resolved-by-transcript'
    const name = encode(cwd)
    const fs = seamOver([cwd], {
      [`${PROJECTS_ROOT}/${name}`]: { 'a.jsonl': JSON.stringify({ cwd }) },
    })

    const out = classifyProjects([name], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => {
        throw new Error('the candidate pool must not be consulted when the transcript answered')
      },
      budget: 100,
      fs,
    })

    expect(out.get(name)?.liveness).toBe('alive')
  })

  it('test_budget_exhaustion_yields_undetermined_and_never_exceeds_the_bound', () => {
    const names = Array.from({ length: 20 }, (_, i) => encode(`/home/op/p${i}`))
    const fs = seamOver([])

    const out = classifyProjects(names, {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => [],
      budget: 5,
      fs,
    })

    expect(fs.ops()).toBeLessThanOrEqual(5)
    expect([...out.values()].every((v) => v.liveness !== 'dead')).toBe(true)
    expect(out.size).toBe(names.length)
  })

  it('test_an_unreadable_project_directory_is_undetermined_with_the_real_error', () => {
    const name = encode('/home/op/unreadable')
    const fs: FsSeam = {
      exists: () => false,
      listEntries: () => {
        const e = new Error('permission denied') as NodeJS.ErrnoException
        e.code = 'EACCES'
        throw e
      },
      firstLine: () => '',
    }

    const out = classifyProjects([name], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => [],
      budget: 100,
      fs,
    })

    expect(out.get(name)?.liveness).toBe('undetermined')
    expect(out.get(name)?.reason).toMatch(/EACCES|permission/i)
  })
})

/**
 * Round two, 2026-08-16 — the defects the `/review` found in the round-one fix.
 *
 * Round one replaced a search that guessed with a transcript read that answers, and that direction
 * was right. What it got wrong is that it treated "the recorded cwd re-encodes to this name" as
 * VALIDATION. The file's own opening paragraph says the encoding is many-to-one, so that check
 * narrows the recorded cwd to a COLLISION CLASS, never to a path — and the verdict derived from it
 * was `dead`, on the branch where the caller deletes.
 *
 * Three failures follow from it, and the third is the one that makes this urgent rather than merely
 * wrong: transcripts are user-writable data, so the class member that decides the verdict can be
 * PLANTED.
 *
 * Note on provenance: the first-match flaw exists in the consumer's oracle too
 * (`TheoCode/.../liveness-oracle.ts:168-181` — one `recordedCwd`, then `isDirectory(cwd)`). This is
 * not a faithful absorption gone wrong; it is a defect the framework is in a position to fix and the
 * consumer was not, because the framework owns the encoding that creates the collision.
 */
describe('classifyProjects — a collision class is not a path', () => {
  it('test_a_live_sibling_cwd_outweighs_a_gone_one_in_the_same_collision_class', () => {
    // `/home/op/my-app` and `/home/op/my/app` encode identically and therefore SHARE one project
    // directory. One of them being gone says nothing about the other.
    const live = '/home/op/my-app'
    const gone = '/home/op/my/app'
    const name = encode(live)
    expect(encode(gone), 'the fixture is only meaningful if they collide').toBe(name)

    const fs = seamOver([live], {
      [`${PROJECTS_ROOT}/${name}`]: {
        'a.jsonl': JSON.stringify({ cwd: gone }),
        'b.jsonl': JSON.stringify({ cwd: live }),
      },
    })

    const out = classifyProjects([name], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => [],
      budget: 100,
      fs,
    })

    expect(out.get(name)?.liveness).toBe('alive')
  })

  it('test_a_planted_transcript_cannot_condemn_a_live_project', () => {
    // Transcripts are user-writable. `_home_op_my_app` was never a path, but it encodes to the same
    // name, so under first-match-wins it decides the verdict for a project that exists.
    const live = '/home/op/my-app'
    const planted = '_home_op_my_app'
    const name = encode(live)
    expect(encode(planted)).toBe(name)

    const fs = seamOver([live], {
      [`${PROJECTS_ROOT}/${name}`]: {
        'planted.jsonl': JSON.stringify({ cwd: planted }),
        'real.jsonl': JSON.stringify({ cwd: live }),
      },
    })

    const out = classifyProjects([name], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => [],
      budget: 100,
      fs,
    })

    expect(out.get(name)?.liveness, 'a plantable field must not reach `dead`').toBe('alive')
  })

  it('test_a_non_finite_budget_is_refused_not_treated_as_unbounded', () => {
    // The whole module exists because an unbounded sweep produced ~64M syscalls and never returned.
    // `remaining -= 1` on `Infinity` is still `Infinity`, so every `remaining <= 0` guard is a no-op
    // and the bound silently does not exist — the exact failure, reintroduced through the front door.
    // Refused rather than clamped, matching this package's own invariant 1 in `transcript-gc.ts`:
    // an operator who asked for a policy must not be silently given a different one.
    const fs = seamOver([])
    const call = (budget: number) => () =>
      classifyProjects(['x'], {
        projectsRoot: PROJECTS_ROOT,
        candidatePaths: () => [],
        budget,
        fs,
      })

    expect(call(Number.POSITIVE_INFINITY)).toThrow(LivenessBudgetError)
    expect(call(Number.NaN)).toThrow(LivenessBudgetError)
    expect(call(-1)).toThrow(LivenessBudgetError)
    expect(call(1.5)).toThrow(LivenessBudgetError)
    // Zero is a real policy — "spend nothing" — and its result is `undetermined`, never `dead`.
    expect(call(0)).not.toThrow()
    expect(
      classifyProjects(['x'], {
        projectsRoot: PROJECTS_ROOT,
        candidatePaths: () => [],
        budget: 0,
        fs,
      }).get('x')?.liveness,
    ).toBe('undetermined')
  })

  it('test_the_budget_error_names_the_value_it_refused', () => {
    // An operator reading this in a GC log needs to know WHICH knob and WHAT value, not that
    // something was invalid (`rules/error-handling.md` — fail clear, with context).
    let caught: unknown
    try {
      classifyProjects(['x'], {
        projectsRoot: PROJECTS_ROOT,
        candidatePaths: () => [],
        budget: Number.POSITIVE_INFINITY,
        fs: seamOver([]),
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(LivenessBudgetError)
    expect((caught as Error).message).toMatch(/budget/i)
    expect((caught as Error).message).toMatch(/Infinity/)
  })

  it('test_a_stat_that_could_not_be_performed_is_never_absence', () => {
    // The consumer's scar B-020: its seam is `isDirectory(): boolean | undefined` because an adapter
    // that mapped every stat failure to `false` classified live projects DEAD. Round one absorbed
    // the interface and dropped the scar — `exists` was two-valued, on the delete path.
    const cwd = '/home/op/unstattable'
    const name = encode(cwd)
    const fs: FsSeam = {
      exists: () => {
        const e = new Error('permission denied') as NodeJS.ErrnoException
        e.code = 'EACCES'
        throw e
      },
      listEntries: () => ['a.jsonl'],
      firstLine: () => JSON.stringify({ cwd }),
    }

    const out = classifyProjects([name], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => [],
      budget: 100,
      fs,
    })

    const got = out.get(name)
    expect(got?.liveness, 'could not look is not did not find').toBe('undetermined')
    expect(got?.reason).toMatch(/EACCES|permission/i)
  })
})
