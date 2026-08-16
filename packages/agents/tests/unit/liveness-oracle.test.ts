/**
 * T3.2 — "does the project behind `projects/<encoded>/` still exist?", answered by the package that
 * made the question hard.
 *
 * `encodeProjectDir(cwd)` is `cwd.replace(/[^a-zA-Z0-9]/g, '-')` — a one-way street. That is a
 * FRAMEWORK decision, and its consequence is that a moved or deleted project cannot be found by
 * decoding. The consumer wrote 188 lines because of it; the measurement in their own docstring is
 * 13.269 project directories, ~3.200 falling through to filesystem search, ~64M syscalls without a
 * shared budget.
 *
 * ## Revised 2026-08-16 — what the first version got wrong
 *
 * This suite originally encoded two beliefs that a measurement then falsified. Both are rewritten
 * below rather than deleted, because the reasoning is the useful part.
 *
 * **(a) There is no cheap decode.** The first version had a fast path that turned every `-` back
 * into `/` and a test asserting it resolved the common case without enumeration. It resolves no
 * path containing a hyphen — which is most paths — so on a real `~/.theokit/projects` it missed
 * every project and fell through to the search. What replaces it is not a better guess: the
 * transcript RECORDS the cwd it was written in, so the answer is one line of one file away. The
 * consumer measured that path resolving 91 of 120 sampled projects. The intent of the old test
 * ("the common case must not pay for enumeration") is preserved exactly; only its mechanism moved.
 *
 * **(b) Exhausting the candidate pool is not evidence of absence.** The first version returned
 * `dead` after scanning the injected list, and argued the point at length in the symlink-cycle test:
 * *"the enumeration was consulted in full and no candidate encodes to this name… completeness of the
 * enumeration is the enumerator's guarantee, and the oracle does not have the information to
 * second-guess it."*
 *
 * That argument is answered by measurement, not by preference. Wired to the consumer's real
 * enumerator against a real `~/.theokit/projects`, it classified **6 of 6 live projects `dead`** —
 * including this repository — on the path where the caller DELETES. The premise it rests on is the
 * one that fails: a caller-supplied list is a heuristic subset, and the consumer's own oracle only
 * reaches DEAD after a *completed DFS from `/`*, never after scanning a supplied list. So the
 * oracle does not need to second-guess the enumerator — it needs to stop treating a subset as a
 * census. `dead` now requires the one thing that actually proves absence: a recorded cwd that is
 * not on disk.
 *
 * ## The three-valued result is load-bearing
 *
 * `undetermined` is NOT a soft `dead`. Callers delete on `dead`, and deleting on "we could not tell"
 * is data loss. Every path that runs out of budget, hits an unreadable directory, loses its
 * enumeration, or simply does not find out resolves to `undetermined` — fail-safe
 * (`rules/error-handling.md`).
 *
 * ## The budget is shared across the sweep
 *
 * Per-project budgets are what produced the 64M figure: a bound that resets every iteration is not a
 * bound. The property asserted here — total filesystem operations never exceed the configured
 * budget — is scale-independent, which is why a fixture of five projects is evidence about a tree of
 * thirteen thousand (Risk R5).
 */
import { describe, expect, it, vi } from 'vitest'

import { classifyProjects, type FsSeam } from '../../src/session/liveness-oracle.js'

const PROJECTS_ROOT = '/home/p/.theokit/projects'

/**
 * Every call is one filesystem operation, which is what the budget counts.
 *
 * `transcripts` maps a project directory to its files, so a project can be given a recorded cwd —
 * the authoritative path — without touching the candidate pool.
 */
function seam(
  existing: readonly string[],
  throwOn: readonly string[] = [],
  transcripts: Record<string, Record<string, string>> = {},
): FsSeam & { calls: () => number } {
  let calls = 0
  return {
    calls: () => calls,
    exists(path: string) {
      calls += 1
      if (throwOn.includes(path)) throw new Error(`EACCES: permission denied, stat '${path}'`)
      return existing.includes(path)
    },
    listEntries(dir: string) {
      calls += 1
      if (throwOn.includes(dir)) throw new Error(`EACCES: permission denied, scandir '${dir}'`)
      return Object.keys(transcripts[dir] ?? {})
    },
    firstLine(file: string) {
      calls += 1
      const cut = file.lastIndexOf('/')
      return transcripts[file.slice(0, cut)]?.[file.slice(cut + 1)] ?? ''
    },
  }
}

const encode = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-')

/** A project whose transcript records `cwd` — the shape every real project on disk has. */
const withTranscript = (cwd: string): Record<string, Record<string, string>> => ({
  [`${PROJECTS_ROOT}/${encode(cwd)}`]: { 'a.jsonl': JSON.stringify({ cwd }) },
})

describe('classifyProjects', () => {
  it('test_the_common_case_resolves_without_paying_for_enumeration', () => {
    // Was `test_a_directly_resolvable_project_is_alive_without_search`. Same intent, real mechanism:
    // the transcript names the cwd, so the candidate pool is never consulted. The path deliberately
    // contains a hyphen — the shape the removed fast path could not handle.
    const cwd = '/home/p/theokit-framework'
    const fs = seam([cwd], [], withTranscript(cwd))
    const candidatePaths = vi.fn(() => [cwd])

    const out = classifyProjects([encode(cwd)], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths,
      budget: 100,
      fs,
    })

    expect(out.get(encode(cwd))?.liveness).toBe('alive')
    expect(candidatePaths, 'the common case must not pay for enumeration').not.toHaveBeenCalled()
  })

  it('test_a_moved_project_is_found_within_budget_and_is_alive', () => {
    // The encoding is lossy, so `/home/p/my-app` and `/home/p/my/app` encode identically. A
    // candidate whose encoding matches IS the project, as far as the layout can tell. No transcript
    // here, so this exercises the fallback deliberately.
    const fs = seam(['/home/p/my/app'])
    const out = classifyProjects([encode('/home/p/my-app')], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => ['/other/thing', '/home/p/my/app'],
      budget: 100,
      fs,
    })
    expect(out.get(encode('/home/p/my-app'))?.liveness).toBe('alive')
  })

  it('test_a_project_whose_recorded_cwd_is_gone_is_dead', () => {
    // Was `test_a_project_that_is_really_gone_is_dead`, which asserted `dead` after merely
    // exhausting the pool. THIS is what "really gone" can be proven by: the transcript says where it
    // lived, and it is not there. The only branch in the module that may return `dead`.
    const cwd = '/home/p/gone'
    const fs = seam([], [], withTranscript(cwd))
    const out = classifyProjects([encode(cwd)], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => ['/home/p/other'],
      budget: 100,
      fs,
    })
    expect(out.get(encode(cwd))?.liveness).toBe('dead')
    expect(out.get(encode(cwd))?.reason).toMatch(/recorded/i)
  })

  it('test_a_pool_that_does_not_contain_the_project_is_undetermined_not_dead', () => {
    // The belief this replaces: "the enumeration was consulted in full, therefore absent". Measured
    // against a real tree, that reasoning classified 6 of 6 live projects dead. Without a recorded
    // cwd there is no proof of absence, and the caller deletes on `dead`.
    const fs = seam([])
    const out = classifyProjects([encode('/home/p/unknown')], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => ['/home/p/other'],
      budget: 100,
      fs,
    })
    expect(out.get(encode('/home/p/unknown'))?.liveness).toBe('undetermined')
  })

  it('test_budget_exhaustion_yields_undetermined_never_dead', () => {
    const fs = seam([])
    const encoded = ['/a/one', '/a/two', '/a/three', '/a/four'].map(encode)
    const out = classifyProjects(encoded, {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => ['/z/1', '/z/2', '/z/3'],
      budget: 3,
      fs,
    })
    const verdicts = encoded.map((e) => out.get(e)?.liveness)
    expect(verdicts, 'every project must be classified, none dropped').toHaveLength(4)
    expect(
      verdicts.slice(-1)[0],
      'running out of budget is not evidence of absence — deleting on it is data loss',
    ).toBe('undetermined')
    expect(out.get(encoded[3]!)?.reason).toMatch(/budget/i)
  })

  it('test_an_unreadable_project_directory_is_undetermined_with_a_reason', () => {
    const dir = `${PROJECTS_ROOT}/${encode('/home/p/locked')}`
    const fs = seam([], [dir])
    const out = classifyProjects([encode('/home/p/locked')], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => [],
      budget: 100,
      fs,
    })
    const got = out.get(encode('/home/p/locked'))
    expect(got?.liveness, 'cannot read is not the same fact as does not exist').toBe('undetermined')
    // The REAL message, not a paraphrase. An operator needs the errno and the path to act
    // (`rules/error-handling.md`).
    expect(got?.reason).toMatch(/EACCES/)
    expect(got?.reason, 'which path could not be read is the actionable half').toContain(dir)
  })

  it('test_total_fs_operations_never_exceed_the_budget', () => {
    // The scale-independent property (Risk R5). A budget that resets per project is what produced
    // the ~64M figure, so this is asserted on the SWEEP, not on any one project.
    const fs = seam([])
    const encoded = Array.from({ length: 25 }, (_, i) => encode(`/proj/p${String(i)}`))
    classifyProjects(encoded, {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => Array.from({ length: 40 }, (_, i) => `/elsewhere/q${String(i)}`),
      budget: 30,
      fs,
    })
    expect(fs.calls(), 'the bound is on the whole sweep').toBeLessThanOrEqual(30)
  })

  it('test_a_repeating_candidate_list_costs_its_distinct_entries_not_its_length', () => {
    // EC-9. A symlink cycle in the PRODUCT's enumeration reaches this module as a list that repeats;
    // de-duplicating makes it cost the distinct entries. That half is unchanged and still right.
    //
    // What changed is the verdict. The previous version asserted `dead` here and argued that a fully
    // consulted enumeration proves absence. It does not — see this file's header. The dedup remains
    // strictly better than burning the budget; it just no longer licenses a deletion.
    const fs = seam([])
    const looping = Array.from({ length: 500 }, () => '/loop/a/b/a/b')
    const out = classifyProjects([encode('/loop/target')], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => looping,
      budget: 10,
      fs,
    })
    expect(fs.calls(), 'a repeating list must not cost the budget its length').toBeLessThanOrEqual(
      10,
    )
    expect(out.get(encode('/loop/target'))?.liveness).toBe('undetermined')
  })

  it('test_a_cycle_that_does_exhaust_the_budget_still_yields_undetermined', () => {
    // The half of EC-9 that survives unchanged: when the budget IS spent, nothing is called dead.
    // Distinct entries, so dedup cannot rescue it, and each one costs a probe.
    const fs = seam([])
    const target = encode('/loop/target')
    const looping = Array.from(
      { length: 500 },
      (_, i) => `/loop/a/b${'/a/b'.repeat(i % 3)}`,
    ).filter((p, i, all) => all.indexOf(p) === i)
    const out = classifyProjects([target, encode('/x/one'), encode('/x/two')], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => [...looping, '/x/one'],
      budget: 2,
      fs,
    })
    expect(out.get(encode('/x/two'))?.liveness).toBe('undetermined')
    expect(out.get(encode('/x/two'))?.reason).toMatch(/budget/i)
  })

  it('test_enumeration_failure_yields_undetermined_for_every_project_with_a_typed_error', () => {
    // EC-10. If the product's enumeration throws, the oracle knows nothing about anything. Reporting
    // `dead` here would delete every transcript on the machine because a directory listing failed.
    const fs = seam([])
    const out = classifyProjects([encode('/a/one'), encode('/a/two')], {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => {
        throw new Error('ENOENT: no such file or directory')
      },
      budget: 100,
      fs,
    })
    for (const e of [encode('/a/one'), encode('/a/two')]) {
      expect(out.get(e)?.liveness).toBe('undetermined')
      expect(out.get(e)?.reason).toMatch(/enumerat/i)
    }
  })

  it('test_every_input_appears_in_the_output', () => {
    // A missing key reads to a caller as "not dead", which happens to be safe — but only by luck.
    const fs = seam(['/a/one'])
    const encoded = ['/a/one', '/a/two', '/a/three'].map(encode)
    const out = classifyProjects(encoded, {
      projectsRoot: PROJECTS_ROOT,
      candidatePaths: () => [],
      budget: 2,
      fs,
    })
    expect([...out.keys()].sort((a, b) => a.localeCompare(b))).toEqual(
      [...encoded].sort((a, b) => a.localeCompare(b)),
    )
  })
})
