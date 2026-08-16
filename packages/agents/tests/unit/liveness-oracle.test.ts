/**
 * T3.2 — "does the project behind `projects/<encoded>/` still exist?", answered by the package that
 * made the question hard.
 *
 * `encodeProjectDir(cwd)` is `cwd.replace(/[^a-zA-Z0-9]/g, '-')` — a one-way street. That is a
 * FRAMEWORK decision, and its consequence is that a moved or deleted project can only be found by
 * searching. The consumer wrote 188 lines of search plus a budget because of it; the measurement in
 * their own docstring is 13.269 project directories, ~3.200 falling through to filesystem search,
 * ~64M syscalls without a shared budget.
 *
 * Enumeration is product policy — which directories are even candidates is the product's business —
 * so `listProjects` is injected. The liveness question is not product policy: it is the inverse of an
 * encoding this package owns.
 *
 * ## The three-valued result is load-bearing
 *
 * `undetermined` is NOT a soft `dead`. Callers delete on `dead`, and deleting on "we could not tell"
 * is data loss. Every path that runs out of budget, hits an unreadable directory, or loses its
 * enumeration resolves to `undetermined` — fail-safe (`rules/error-handling.md`). The tests below are
 * arranged so that each way of failing has its own assertion that the answer was not `dead`.
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

/** Every call is one filesystem operation, which is what the budget counts. */
function seam(
  existing: readonly string[],
  throwOn: readonly string[] = [],
): FsSeam & {
  calls: () => number
} {
  let calls = 0
  return {
    calls: () => calls,
    exists(path: string) {
      calls += 1
      if (throwOn.includes(path)) throw new Error(`EACCES: permission denied, stat '${path}'`)
      return existing.includes(path)
    },
  }
}

const encode = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-')

describe('classifyProjects', () => {
  it('test_a_directly_resolvable_project_is_alive_without_search', () => {
    const fs = seam(['/home/p/alpha'])
    const listProjects = vi.fn(() => ['/home/p/alpha'])

    const out = classifyProjects([encode('/home/p/alpha')], { listProjects, budget: 100, fs })

    expect(out.get(encode('/home/p/alpha'))?.liveness).toBe('alive')
    expect(listProjects, 'the common case must not pay for enumeration').not.toHaveBeenCalled()
  })

  it('test_a_moved_project_is_found_within_budget_and_is_alive', () => {
    // The encoding is lossy, so `/home/p/my-app` and `/home/p/my/app` encode identically. A
    // candidate whose encoding matches IS the project, as far as the layout can tell.
    const fs = seam(['/home/p/my/app'])
    const out = classifyProjects([encode('/home/p/my-app')], {
      listProjects: () => ['/other/thing', '/home/p/my/app'],
      budget: 100,
      fs,
    })
    expect(out.get(encode('/home/p/my-app'))?.liveness).toBe('alive')
  })

  it('test_a_project_that_is_really_gone_is_dead', () => {
    const fs = seam([])
    const out = classifyProjects([encode('/home/p/gone')], {
      listProjects: () => ['/home/p/other'],
      budget: 100,
      fs,
    })
    expect(out.get(encode('/home/p/gone'))?.liveness).toBe('dead')
  })

  it('test_budget_exhaustion_yields_undetermined_never_dead', () => {
    const fs = seam([])
    const encoded = ['/a/one', '/a/two', '/a/three', '/a/four'].map(encode)
    const out = classifyProjects(encoded, {
      listProjects: () => ['/z/1', '/z/2', '/z/3'],
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

  it('test_an_unreadable_directory_is_undetermined_with_a_reason', () => {
    const fs = seam([], [`/home/p/locked`])
    const out = classifyProjects([encode('/home/p/locked')], {
      listProjects: () => [],
      budget: 100,
      fs,
    })
    const got = out.get(encode('/home/p/locked'))
    expect(got?.liveness, 'cannot read is not the same fact as does not exist').toBe('undetermined')
    // The REAL message, not a paraphrase. The first draft caught the error and threw it away, then
    // wrote "EACCES or similar" from memory — which reads as a diagnosis while carrying none. An
    // operator needs the errno and the path to act (`rules/error-handling.md`).
    expect(got?.reason).toMatch(/EACCES/)
    expect(got?.reason, 'which path could not be read is the actionable half').toContain(
      '/home/p/locked',
    )
  })

  it('test_total_fs_operations_never_exceed_the_budget', () => {
    // The scale-independent property (Risk R5). A budget that resets per project is what produced
    // the ~64M figure, so this is asserted on the SWEEP, not on any one project.
    const fs = seam([])
    const encoded = Array.from({ length: 25 }, (_, i) => encode(`/proj/p${String(i)}`))
    classifyProjects(encoded, {
      listProjects: () => Array.from({ length: 40 }, (_, i) => `/elsewhere/q${String(i)}`),
      budget: 30,
      fs,
    })
    expect(fs.calls(), 'the bound is on the whole sweep').toBeLessThanOrEqual(30)
  })

  it('test_a_symlink_cycle_terminates_within_budget', () => {
    // EC-9, with a DELIBERATE DEVIATION from the plan's expected verdict — recorded here rather than
    // quietly adjusted.
    //
    // The plan expected `undetermined`, reasoning that a cycle burns the budget and anything left
    // over is undetermined. The oracle never walks a tree itself — it asks the injected enumeration —
    // so a cycle can only reach it as a candidate list that REPEATS. Deduplicating the candidates
    // makes that terminate on the distinct entries instead of the list length, which is strictly
    // better: it costs one comparison rather than the whole budget. It also makes the plan's premise
    // false, so the verdict is `dead` by the contract: the enumeration was consulted in full and no
    // candidate encodes to this name.
    //
    // The deviation is deliberate because the alternative is worse. Inferring "your enumeration
    // looped, so I distrust it" from duplicates is a heuristic with real false positives — a product
    // may legitimately list a path twice — and a heuristic that silently turns `dead` into
    // `undetermined` would make the whole verdict unreliable rather than safe. What `dead` means is
    // stated in the module and belongs to the caller: no candidate encoded to this name. Completeness
    // of the enumeration is the enumerator's guarantee, and the oracle does not have the information
    // to second-guess it.
    const fs = seam([])
    const looping = Array.from({ length: 500 }, () => '/loop/a/b/a/b')
    const out = classifyProjects([encode('/loop/target')], {
      listProjects: () => looping,
      budget: 10,
      fs,
    })
    expect(fs.calls(), 'a repeating list must not cost the budget its length').toBeLessThanOrEqual(
      10,
    )
    expect(out.get(encode('/loop/target'))?.liveness).toBe('dead')
  })

  it('test_a_cycle_that_does_exhaust_the_budget_still_yields_undetermined', () => {
    // The half of EC-9 that survives unchanged: when the budget IS spent, nothing is called dead.
    // Distinct entries, so dedup cannot rescue it, and each one costs a probe.
    const fs = seam([])
    const target = encode('/loop/target')
    const looping = Array.from({ length: 500 }, (_, i) => `/loop/a/b${'/a/b'.repeat(i % 3)}`)
      .map((p) => p)
      .filter((p, i, all) => all.indexOf(p) === i)
    const out = classifyProjects([target, encode('/x/one'), encode('/x/two')], {
      listProjects: () => [...looping, '/x/one'],
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
      listProjects: () => {
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
    const out = classifyProjects(encoded, { listProjects: () => [], budget: 2, fs })
    expect([...out.keys()].sort((a, b) => a.localeCompare(b))).toEqual(
      [...encoded].sort((a, b) => a.localeCompare(b)),
    )
  })
})
