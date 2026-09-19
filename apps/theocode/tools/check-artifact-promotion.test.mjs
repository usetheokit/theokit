/**
 * Tests for the artifact-promotion guard.
 *
 * Why this file exists at all. The guard sits in the `npm run lint` chain, which gates every
 * build, and it had no test — measured 2026-09-10, alongside `check-typed-error-assertions.mjs`
 * and `build-cli.mjs`. That is this repository's own rule inverted: `rules/testing.md` says code
 * without a test works by coincidence, and `packages/` honours it with 198 test files against 239
 * sources. The checkers that ENFORCE the rules were the part exempted.
 *
 * The failure mode is silent and specific. A checker that mis-globs, throws early, or returns 0
 * over an empty match set passes the lint chain having inspected nothing. Nobody sees a red build
 * — they see a green one, and a green build is read as evidence. That is strictly worse than
 * having no checker.
 *
 * So the first test below is the NEGATIVE case: a tree that MUST fail. Without it, a guard that
 * has been quietly turned into a no-op still passes its own suite. The two anti-vacuity floors
 * that follow are the same discipline the doc-reference and English-only guards already apply.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { kitRoot } from './kit-root.mjs'

import { describe, expect, it } from 'vitest'

import { PAIRS, RETIRED, auditPairs, divergentDuplicates } from './check-artifact-promotion.mjs'

/**
 * A fake tree: { dir: { file: contents } }.
 *
 * An absent directory throws with `code: 'ENOENT'`, the way `node:fs` does, because the checker
 * now keys on that code rather than on the fact that something was thrown. That distinction is
 * the fix for the finding: absence is a reportable state, and every OTHER read failure —
 * permissions, a path that is a file — is a condition a human has to see, not one to answer with
 * an empty list.
 */
const enoent = (path) => Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })

const fakeFs = (tree) => ({
  readDir: async (dir) => {
    if (!(dir in tree)) throw enoent(dir)
    return Object.keys(tree[dir])
  },
  readFileText: async (path) => {
    const cut = path.lastIndexOf('/')
    const [dir, name] = [path.slice(0, cut), path.slice(cut + 1)]
    if (!tree[dir] || !(name in tree[dir])) throw enoent(path)
    return tree[dir][name]
  },
})

/**
 * The fixture the decision tests run against, named apart from the real `PAIRS` they now import.
 * A test asserting on the live constant would be a description of this repository's current
 * contents rather than of the rule.
 */
const FIXTURE_PAIRS = [['work', 'published']]

describe('divergentDuplicates', () => {
  it('test_it_fails_when_the_same_artifact_differs_in_both_homes', async () => {
    // THE negative case. This is the exact defect ADR 0002 was written for: measured on
    // 2026-08-10, `english-only-completion-plan.md` existed in both homes with divergent bodies
    // and a session resolved the stale one as active.
    const io = fakeFs({
      work: { 'plan.md': 'version A\n' },
      published: { 'plan.md': 'version B\n' },
    })
    const problems = await divergentDuplicates(FIXTURE_PAIRS, io)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('plan.md')
    expect(problems[0]).toContain('published')
  })

  it('test_it_passes_when_the_two_copies_agree', async () => {
    // Anti-vacuity floor: a guard that flags everything would pass the test above.
    const io = fakeFs({ work: { 'plan.md': 'same\n' }, published: { 'plan.md': 'same\n' } })
    expect(await divergentDuplicates(FIXTURE_PAIRS, io)).toEqual([])
  })

  it('test_a_working_only_draft_is_not_a_violation', async () => {
    // Deliberately narrow, per the guard's own header: drafts and in-flight notes belong in the
    // working area. A check that demanded promotion of all of them would push people to stop
    // using the working area, which is the failure this repository already has one directory over.
    const io = fakeFs({ work: { 'draft.md': 'wip\n' }, published: {} })
    expect(await divergentDuplicates(FIXTURE_PAIRS, io)).toEqual([])
  })

  it('test_a_published_only_artifact_is_not_a_violation', async () => {
    const io = fakeFs({ work: {}, published: { 'old.md': 'kept\n' } })
    expect(await divergentDuplicates(FIXTURE_PAIRS, io)).toEqual([])
  })

  it('test_a_missing_directory_is_not_a_violation', async () => {
    // Neither home is required to exist. Throwing here would fail the lint chain for every
    // repository that has not created the working area yet.
    const io = fakeFs({})
    expect(await divergentDuplicates(FIXTURE_PAIRS, io)).toEqual([])
  })

  it('test_a_read_failure_that_is_not_an_absence_is_not_swallowed', async () => {
    // The swallow this replaced was `catch { return [] }`, which answered a permission error with
    // the same empty list it answered an empty directory with. A checker that keeps reporting
    // clean after it stopped being able to look is the one failure worse than no checker.
    const io = {
      readDir: async () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      },
      readFileText: async () => '',
    }
    await expect(divergentDuplicates(FIXTURE_PAIRS, io)).rejects.toThrow(/EACCES/)
  })

  it('test_non_markdown_files_are_ignored', async () => {
    const io = fakeFs({ work: { 'notes.txt': 'A\n' }, published: { 'notes.txt': 'B\n' } })
    expect(await divergentDuplicates(FIXTURE_PAIRS, io)).toEqual([])
  })

  it('test_it_reports_every_divergent_pair_not_just_the_first', async () => {
    // Stopping at the first would let a second divergence ride in behind a fixed one, which is
    // the shape of "the gate passed, so it must be clean".
    const io = fakeFs({
      work: { 'a.md': '1\n', 'b.md': '1\n' },
      published: { 'a.md': '2\n', 'b.md': '2\n' },
    })
    expect(await divergentDuplicates(FIXTURE_PAIRS, io)).toHaveLength(2)
  })

  it('test_it_checks_every_declared_pair', async () => {
    // A checker that inspects one of three directory pairs and exits 0 is the inert-gate failure
    // this suite exists to catch.
    const io = fakeFs({
      w1: { 'x.md': 'A\n' },
      p1: { 'x.md': 'B\n' },
      w2: { 'y.md': 'A\n' },
      p2: { 'y.md': 'B\n' },
    })
    const problems = await divergentDuplicates(
      [
        ['w1', 'p1'],
        ['w2', 'p2'],
      ],
      io,
    )
    expect(problems).toHaveLength(2)
  })
})

/**
 * The CONFIGURATION, which the eight tests above leave unasserted.
 *
 * They pin the decision function against a fixture tree — `[['work', 'published']]` — and a
 * decision function is only as useful as the directories it is pointed at. Measured 2026-09-10:
 * every one of the six directories `PAIRS` named was absent from this checkout, `markdownIn`
 * swallowed each ENOENT, and the gate exited 0 in the `npm run lint` chain having opened no file.
 * A suite that is green over a gate inspecting nothing is the exact failure this file's own
 * docblock says it exists to prevent, and it survived because no test imported the real constant.
 */
describe('PAIRS', () => {
  it('test_every_declared_working_directory_exists', (ctx) => {
    // The working area is gitignored (`.gitignore` — `.claude/` is the maintainers' scaffolding,
    // not product code), so it is absent in a fresh checkout and on every CI runner. Asserting
    // against disk there would be asserting about a tree nobody shipped. SKIP is the honest
    // outcome and it is announced, following `check-codex-parity.mjs`, which skips loudly on its
    // own gitignored input rather than reporting a clean surface it never read.
    if (kitRoot() === undefined) {
      ctx.skip(
        '.claude/ is not versioned and is absent here — nothing to check the constant against',
      )
      return
    }
    // Resolved against the KIT's root, not this package's. They were the same directory while this
    // was its own repository; in the monorepo the kit is installed once at the top and the working
    // area went with it.
    //
    // OPEN, and worth a decision rather than a silent mapping: that area is now shared with the
    // framework, so the promoted half of each pair (`docs/plans`, `docs/reviews` — neither of which
    // exists here) would be audited against records this product did not write. The directories are
    // asserted because that is what this test claims; whether the PAIRING still means anything in a
    // shared working area is a question for whoever next runs the audit.
    //
    // ANSWERED 2026-09-19 (B-191). The pairing means nothing here and the constant now says so: the
    // working side moved to `.squad/records/` with the write root, and the published side was deleted
    // outright by `41732e6a8`. `PAIRS` is empty and carries `RETIRED`.
    //
    // The assertion is a DISJUNCTION rather than a bare loop, because a `for` over an empty list
    // asserts nothing — it would report this file clean while checking no path at all, which is the
    // failure the docblock above says this file exists to prevent.
    const kit = kitRoot()
    if (PAIRS.length === 0) {
      expect(
        RETIRED,
        'the table is empty, so it must say WHY — otherwise rot that removed the rows is ' +
          'indistinguishable from a decision to retire them',
      ).toBeTypeOf('string')
      expect(RETIRED.length, 'the retirement reason must not be blank').toBeGreaterThan(0)
      return
    }
    for (const [working] of PAIRS) {
      expect(existsSync(join(kit, working)), `declared working directory: ${working}`).toBe(true)
    }
  })

  it('test_an_empty_table_declares_why_it_is_empty', () => {
    // The same claim the disjunction above makes, and NOT a duplicate of it. That one sits below a
    // `ctx.skip` for a missing `.claude/`, which is every CI runner — so on CI the half that matters
    // most is never asserted. This case reads the constant only, touches no disk, and therefore runs
    // everywhere, exactly like `test_no_pair_names_the_retired_working_area` below it.
    //
    // Measured 2026-09-19: without it the suite totalled 1941 where the plan's DoD demanded 1942, and
    // the gap was this assertion being skipped rather than a case being deleted.
    if (PAIRS.length === 0) {
      expect(
        RETIRED,
        'the table is empty, so it must say WHY — in CI too, not only where `.claude/` exists',
      ).toBeTypeOf('string')
      expect(RETIRED.length, 'the retirement reason must not be blank').toBeGreaterThan(0)
    }
  })

  it('test_a_table_with_rows_declares_no_retirement', () => {
    // The other half of the mutual exclusion, and the half that survives re-adding a row. Flow 4 of
    // the alignment brief draws that re-addition; nothing else makes the reason go with it, so a live
    // table carrying a stale `RETIRED` would tell the next reader the guard is off when it is on.
    // Reads the constant only, so it runs in CI where the working tree is absent.
    if (PAIRS.length > 0) {
      expect(
        RETIRED,
        'the table has rows, so it is live — a retirement reason here contradicts it',
      ).toBeUndefined()
    }
  })

  it('test_no_pair_names_the_retired_working_area', () => {
    // Runs everywhere, including CI, because it reads the constant rather than the disk. The rot
    // that produced the finding was a rename: the working area moved to `.claude/records/` and
    // this constant kept naming `.claude/knowledge-base/`, which had stopped existing.
    for (const [working, published] of PAIRS) {
      expect(working, 'working side').not.toContain('knowledge-base')
      expect(published, 'published side').not.toContain('knowledge-base')
    }
  })
})

/**
 * The census — what the run actually looked at.
 *
 * `problems.length === 0` is two different facts wearing one face: "both homes agree" and "there
 * was nothing to compare". The gate reported the second as the first for an unknown number of
 * runs. These tests pin the distinction, because it is the only thing that makes a green line
 * from this checker mean anything.
 */
describe('auditPairs census', () => {
  it('test_an_absent_directory_is_reported_rather_than_counted_as_clean', async () => {
    const report = await auditPairs(FIXTURE_PAIRS, fakeFs({}))
    expect(report.problems).toEqual([])
    expect(report.comparedPairs).toBe(0)
    expect(report.comparedFiles).toBe(0)
    expect(report.inspected[0]?.absent).toEqual(['work', 'published'])
  })

  it('test_a_pair_missing_only_its_published_home_names_the_side_that_is_absent', async () => {
    const report = await auditPairs(FIXTURE_PAIRS, fakeFs({ work: { 'plan.md': 'a\n' } }))
    expect(report.comparedPairs).toBe(0)
    expect(report.inspected[0]?.absent).toEqual(['published'])
  })

  it('test_it_counts_the_file_names_it_actually_compared', async () => {
    // An empty-but-PRESENT directory is a comparison that happened and found nothing, which is a
    // different fact from a directory that is not there. Both report zero problems.
    const io = fakeFs({
      work: { 'a.md': '1\n', 'b.md': '1\n', 'draft.md': 'wip\n' },
      published: { 'a.md': '1\n', 'b.md': '1\n' },
    })
    const report = await auditPairs(FIXTURE_PAIRS, io)
    expect(report.comparedPairs).toBe(1)
    expect(report.comparedFiles).toBe(2)
    expect(report.problems).toEqual([])
  })
})
