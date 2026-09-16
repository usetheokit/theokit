/**
 * Tests for the coverage-floor guard.
 *
 * B-159 declared `coverage.min_percent` at exactly the measured total, and the 2026-09-09 review
 * found the same gap from four independent directions: nothing re-checks the number the gate
 * discriminates against. The failure modes are ASYMMETRIC, which is the whole reason this guard
 * exists — a trailing comment on the value fails loudly (`float()` raises, the floor reverts to 80,
 * `/implement` FAILs), but editing the number DOWNWARD fails silently, and because `.claude/` is
 * gitignored it appears in no diff, no review and no CI.
 *
 * Every arm below has its positive control beside it. A test proving a malformed line is caught
 * passes against a parser that rejects everything.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import {
  DECLARED_FLOOR,
  compareToDeclared,
  evaluateFloor,
  readFilesCovered,
  readMeasured,
  resolveViaGate,
} from './check-coverage-floor.mjs'

/**
 * Whether the kit's gate is installed here.
 *
 * Since the checker ASKS `resolve_threshold` rather than reimplementing it, every test of that
 * behaviour needs the module — and it lives under `.claude/`, which this repository does not
 * version. CI has no `.claude/`, so 17 of these failed there on `ModuleNotFoundError` while passing
 * locally: "1520 tests pass" was true and about the wrong machine.
 *
 * `skipIf` rather than an early return, because vitest reports a return as a PASS — the exact trap
 * this file already documents for `test_the_two_declarations_agree`. Where the gate is absent these
 * report SKIPPED, which is the honest state: **CI verifies nothing about this checker**, and that is
 * the second face of B-160 rather than a gap to paper over.
 */
/**
 * Every temporary root this file makes, removed when it finishes.
 *
 * This file was the largest single leak in the tree: seventeen directories per run, each holding a
 * `.claude` tree and two symlinks, none of them ever removed. The pattern is
 * `packages/agent/tests/aggregate-cut-wiring.test.ts:44-57`'s, written inline because `tools/` is
 * not a package and has no `src/` to hang a helper module off (`rules/testing.md` § 5).
 *
 * `force: true` matters here rather than being defensive noise: several roots contain symlinks into
 * `.claude/skills/implement/scripts`, and a run that failed part-way leaves a half-built tree.
 */
const made = []

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
  made.length = 0
})

function tempRoot(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}

const GATE_DIR = resolve('.claude/skills/implement/scripts')
const GATE_INSTALLED = existsSync(join(GATE_DIR, 'coverage_gate.py'))

describe.skipIf(!GATE_INSTALLED)('asking the gate what floor it resolves', () => {
  // These replace a suite that tested a JavaScript reimplementation of `resolve_threshold`. The
  // reimplementation is gone: two adversarial passes found character-class divergences between the
  // two parsers, each a way to lower the effective floor while the checker reported agreement.
  // Every case below is one of those, and each now runs BOTH implementations on the same bytes.
  const gateDir = GATE_DIR

  function withThresholds(body) {
    const root = tempRoot('coverage-floor-gate-')
    mkdirSync(join(root, '.claude', 'rules'), { recursive: true })
    writeFileSync(join(root, '.claude/rules/code-quality-thresholds.txt'), body)
    symlinkSync(gateDir, join(root, '.claude', 'skills-link'))
    mkdirSync(join(root, '.claude', 'skills', 'implement'), { recursive: true })
    symlinkSync(gateDir, join(root, '.claude/skills/implement/scripts'))
    return root
  }

  /** What the gate itself resolves — the fact under test, not a model of it. */
  function gateSays(root) {
    const out = execFileSync('python3', ['-c',
      `import json,sys;sys.path.insert(0,${JSON.stringify(gateDir)});from pathlib import Path;` +
      `import coverage_gate as g;v,s=g.resolve_threshold(Path(${JSON.stringify(root)})); print(json.dumps([v,s]))`,
    ], { encoding: 'utf8' })
    return JSON.parse(out)
  }

  it('test_it_reports_the_value_the_gate_reports', () => {
    const root = withThresholds('coverage.min_percent = 59.29\n')
    expect(resolveViaGate(root)).toEqual({ value: 59.29, source: 'project' })
    expect(gateSays(root)).toEqual([59.29, 'project'])
  })

  it('test_a_declaration_behind_a_bare_cr_is_seen_because_the_gate_sees_it', () => {
    // F-guard-10-r3. `split('\n')` missed this; `splitlines()` does not.
    const root = withThresholds('# note\rcoverage.min_percent = 5\ncoverage.min_percent = 59.29\n')
    expect(gateSays(root)).toEqual([5, 'project'])
    expect(resolveViaGate(root).value).toBe(5)
  })

  it('test_a_leading_unit_separator_is_seen_because_the_gate_sees_it', () => {
    // F-guard-16-r4. U+001F is Python whitespace, is NOT a splitlines() boundary, and is NOT JS
    // whitespace — so `trim()` left it attached to the key and the line was skipped. Effective
    // floor 0, reported as agreement.
    const root = withThresholds('\u001fcoverage.min_percent = 0\ncoverage.min_percent = 59.29\n')
    expect(gateSays(root)).toEqual([0, 'project'])
    expect(resolveViaGate(root).value).toBe(0)
  })

  it('test_underscored_digits_are_read_the_way_python_reads_them', () => {
    // F-guard-18-r4. `float('1_0')` is 10.0 and `Number('1_0')` is NaN, so the mirrored parser
    // rejected a declaration the gate accepts — and a test asserted that as correct behaviour.
    const root = withThresholds('coverage.min_percent = 1_0\n')
    expect(gateSays(root)).toEqual([10, 'project'])
    expect(resolveViaGate(root).value).toBe(10)
  })

  it('test_a_bom_is_reported_as_the_gate_falling_back_rather_than_as_agreement', () => {
    // F-guard-17-r4, the divergence in the other direction: the gate cannot read the key at all
    // and uses its own default, which is B-159's original symptom.
    const root = withThresholds('\ufeffcoverage.min_percent = 59.29\n')
    expect(gateSays(root)).toEqual([80, 'default'])
    expect(resolveViaGate(root)).toEqual({ value: 80, source: 'default' })
  })

  it('test_an_unavailable_python_is_an_error_and_never_an_agreement', () => {
    // A gate that cannot answer is not a gate that agreed.
    const root = withThresholds('coverage.min_percent = 59.29\n')
    expect(resolveViaGate(root, 'python3-that-does-not-exist').error).toBeDefined()
  })
})

describe('evaluating the floor against the tree', () => {
  it('test_a_floor_matching_the_total_is_the_intended_state', () => {
    expect(evaluateFloor({ floor: 59.29, measured: 59.29, tolerance: 1 }).status).toBe('OK')
  })

  it('test_a_floor_above_the_measured_total_fails', () => {
    // The R4 shape: declared against a tree that no longer exists, or a coverage-tool bump (R5).
    const result = evaluateFloor({ floor: 60, measured: 59.29, tolerance: 1 })
    expect(result.status).toBe('FAIL')
    expect(result.message).toMatch(/above/i)
  })

  it('test_slack_beyond_tolerance_asks_for_a_redeclaration', () => {
    // F-wire-4 / F-dom-5: the ratchet decaying by drift rather than by decision.
    const result = evaluateFloor({ floor: 59.29, measured: 62, tolerance: 1 })
    expect(result.status).toBe('FAIL')
    expect(result.message).toContain('62')
  })

  it('test_a_small_gain_does_not_redden_the_lint_chain', () => {
    // The tolerance is NOT slack in the floor — `coverage_gate.py` still compares `>=` exactly. It
    // is the width of the window before this checker asks for a re-declaration. Zero here would
    // redden lint on every coverage-improving commit, and a gate people bypass is the failure this
    // ecosystem exists to prevent.
    expect(evaluateFloor({ floor: 59.29, measured: 59.6, tolerance: 1 }).status).toBe('OK')
  })

  it('test_the_default_tolerance_is_the_one_that_runs', () => {
    // F-guard-2: every other call passes `tolerance: 1` explicitly, so mutating the default
    // survived the whole suite. This is the only call that omits it.
    expect(evaluateFloor({ floor: 59.29, measured: 61.5 }).status).toBe('FAIL')
    expect(evaluateFloor({ floor: 59.29, measured: 60.2 }).status).toBe('OK')
  })

  it('test_a_missing_measurement_is_not_an_answer_either_way', () => {
    // A report the checker could not read must never read as agreement.
    const result = evaluateFloor({ floor: 59.29, measured: null, tolerance: 1 })
    expect(result.status).toBe('UNMEASURED')
  })
})

describe('reading the measured total', () => {
  it('test_it_reads_the_same_field_the_python_gate_parses', () => {
    // EC-2: `_from_json_summary` reads total.lines.pct, already rounded. Recomputing from
    // covered/total gives 59.2963… and would fail against the 59.29 the gate compares.
    const report = JSON.stringify({ total: { lines: { total: 4491, covered: 2663, pct: 59.29 } } })
    expect(readMeasured(report)).toBe(59.29)
  })

  it('test_an_unparseable_report_yields_null_rather_than_a_number', () => {
    expect(readMeasured('not json')).toBeNull()
  })

  it('test_readFilesCovered_answers_null_when_it_cannot_tell', () => {
    // M5/M6 survived because this reader was exported and imported by nothing — its sibling
    // `readMeasured` has exactly these tests one block up. Under those mutants an unreadable report
    // is announced as "coverage for NO source file", which is a claim about a document the checker
    // failed to parse.
    expect(readFilesCovered('not json'), 'garbage read as a scope claim').toBeNull()
    expect(readFilesCovered('null'), 'a null document read as a scope claim').toBeNull()
    expect(readFilesCovered('{"total":{"lines":{"pct":50}}}'), 'no per-file entries is not zero').toBeNull()
    expect(
      readFilesCovered('{"total":{"lines":{"pct":50}},"/a.ts":{"statements":{"covered":3}}}'),
      'an entry with no lines block is unknown, not zero covered',
    ).toBeNull()
  })

  it('test_readFilesCovered_counts_only_files_with_covered_lines', () => {
    const report = JSON.stringify({
      total: { lines: { pct: 50 } },
      '/a.ts': { lines: { covered: 4 } },
      '/b.ts': { lines: { covered: 0 } },
    })

    expect(readFilesCovered(report)).toBe(1)
    expect(readMeasured('{}')).toBeNull()
  })
})

describe('the record in vitest.config.ts', () => {
  // F-wire-3 — T1.2's two assertions were one-shot DoD greps that nothing re-runs. B-063's comment
  // block is where a developer looks before changing coverage settings, so a stale claim there is
  // the "two records, one of them stale" failure ADR-2 exists to prevent.
  const config = readFileSync('vitest.config.ts', 'utf8')

  it('test_it_no_longer_claims_no_threshold_exists', () => {
    expect(config).not.toContain('NO THRESHOLD IS SET HERE')
  })

  it('test_the_number_it_states_is_the_number_that_is_declared', () => {
    // The assertion this describe existed for and did not make. Every other test here checks that
    // the prose MENTIONS the right things; none checked that what it SAYS is true. So the block sat
    // at "the declared floor is 59.18" through three re-declarations (59.18 -> 59.15 -> 58.95 -> 58.96) with
    // the suite green, and the file is tracked — every clone read the wrong number from it.
    //
    // Substrings cannot catch this. A number can.
    const stated = /declared floor is (\d+(?:\.\d+)?)/.exec(config)
    expect(stated, 'vitest.config.ts no longer states a declared floor at all').not.toBeNull()
    expect(Number(stated[1]), 'the record and the declaration disagree').toBe(DECLARED_FLOOR)
  })

  it('test_it_names_where_the_floor_actually_lives', () => {
    expect(config).toContain('code-quality-thresholds.txt')
    expect(config).toContain('DECLARED_FLOOR')
  })

  it('test_it_keeps_the_measurement_it_is_a_record_of', () => {
    // Positive control: the two arms above pass against a comment that deleted B-063 entirely,
    // which would destroy the record rather than update it.
    expect(config).toContain('2026-08-20')
  })

  it('test_it_states_that_the_floor_does_not_reach_a_clone', () => {
    // F-wire-1: the qualification landed in the CHANGELOG first and not here, which is the half
    // the finding argued matters.
    expect(config).toMatch(/gitignored/)
  })
})

describe('wiring', () => {
  it('test_the_lint_script_invokes_the_coverage_floor_checker', () => {
    // Pillar (a). Removing the invocation reddens the suite instead of going unnoticed.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.scripts.lint).toContain('check-coverage-floor.mjs')
  })
})

describe('the tracked declaration', () => {
  const THRESHOLD_PATHS = ['rules/code-quality-thresholds.txt', '.claude/rules/code-quality-thresholds.txt']
  const onDisk = THRESHOLD_PATHS.find((p) => { try { readFileSync(p); return true } catch { return false } })

  it('test_the_tracked_floor_is_a_usable_number', () => {
    // Runs everywhere, including CI where the gitignored file is absent. F-guard-13-r3: the first
    // version of the test below `return`ed there, which vitest reports as a PASS — so
    // `DECLARED_FLOOR = 40` survived the entire suite in every fresh clone.
    expect(Number.isFinite(DECLARED_FLOOR)).toBe(true)
    expect(DECLARED_FLOOR).toBeGreaterThan(0)
    expect(DECLARED_FLOOR).toBeLessThanOrEqual(100)
  })

  it.skipIf(onDisk === undefined)('test_the_two_declarations_of_the_floor_agree_in_this_repository', () => {
    // The invariant itself, on the real files. `skipIf` rather than an early return, so where the
    // gitignored file is absent this reports SKIPPED instead of green.
    // Through the gate, not through a model of it — the invariant is about the value that will
    // actually be enforced.
    expect(compareToDeclared(resolveViaGate(process.cwd()).value)).toEqual({ status: 'OK' })
  })

  it('test_a_downward_edit_of_the_gitignored_value_fails_at_any_magnitude', () => {
    // F-tests-1-r2 / F-guard-1: this is the arm the first version did not have. It needs no
    // coverage report, so it runs on every `pnpm lint` — which is the whole reason it exists.
    const result = compareToDeclared(59.28, 59.29)
    expect(result.status).toBe('FAIL')
    expect(result.message).toContain('LOWERED')
  })

  it('test_a_raise_in_one_file_only_also_fails', () => {
    // Positive control for the arm above: it must catch disagreement, not just lowering.
    expect(compareToDeclared(70, 59.29).status).toBe('FAIL')
  })

  it('test_agreement_passes', () => {
    expect(compareToDeclared(59.29, 59.29).status).toBe('OK')
  })
})

describe.skipIf(!GATE_INSTALLED)('the CLI contract', () => {
  // F-guard-2 — the exit code IS the deliverable, and nothing exercised it. Every mutant below
  // survived the first version: flipping `return 1` to `return 0`, pointing the paths anywhere,
  // and changing the TOLERANCE default (which no unit test reached, because all six callers passed
  // `tolerance: 1` explicitly).
  const CLI = new URL('./check-coverage-floor.mjs', import.meta.url).pathname

  /**
   * A scaffold the checker can actually interrogate.
   *
   * The gate module is linked in as well as the thresholds file: since the checker asks
   * `resolve_threshold` rather than reimplementing it, a root without the kit is a root where the
   * question cannot be answered — which the checker reports as an error, correctly, and which would
   * make every case below look like a failure for the wrong reason.
   */
  function linkGate(root, prefix) {
    mkdirSync(join(root, ...prefix, 'skills', 'implement'), { recursive: true })
    symlinkSync(GATE_DIR, join(root, ...prefix, 'skills', 'implement', 'scripts'))
  }

  function scaffold({ floor, pct, files }) {
    const root = tempRoot('coverage-floor-')
    if (floor !== undefined) {
      mkdirSync(join(root, '.claude', 'rules'), { recursive: true })
      writeFileSync(join(root, '.claude/rules/code-quality-thresholds.txt'), `coverage.min_percent = ${floor}\n`)
    }
    linkGate(root, ['.claude'])
    if (pct !== undefined) {
      mkdirSync(join(root, 'coverage'), { recursive: true })
      // `files` is optional so every existing caller keeps the `{total: …}` shape it was written
      // with. Passing it is what reaches the MAIN route's scope check: with no per-file entries the
      // reader returns null and that branch is unreachable, which is why deleting the branch used to
      // leave the whole suite green (M7, found independently by two reviewers).
      const report = { total: { lines: { pct } } }
      if (files !== undefined) {
        for (let i = 0; i < files.total; i += 1) {
          report[`/repo/packages/x/src/file-${String(i)}.ts`] = {
            lines: { pct: i < files.covered ? 80 : 0, total: 10, covered: i < files.covered ? 8 : 0 },
          }
        }
      }
      writeFileSync(join(root, 'coverage/coverage-summary.json'), JSON.stringify(report))
    }
    return root
  }

  function run(root) {
    try {
      const stdout = execFileSync('node', [CLI], { env: { ...process.env, COVERAGE_FLOOR_ROOT: root }, encoding: 'utf8' })
      return { code: 0, stdout }
    } catch (error) {
      return { code: error.status, stdout: `${error.stdout ?? ''}` }
    }
  }

  it('test_agreement_exits_zero', () => {
    expect(run(scaffold({ floor: DECLARED_FLOOR, pct: DECLARED_FLOOR })).code).toBe(0)
  })

  it('test_a_downward_edit_exits_nonzero_with_no_coverage_report_present', () => {
    // The measured case is covered above; this is the one that failed before, because every
    // `pnpm lint` runs without a report and the old checker exited 0.
    const result = run(scaffold({ floor: DECLARED_FLOOR - 0.01 }))
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('LOWERED')
  })

  it('test_a_trailing_comment_exits_nonzero', () => {
    const root = tempRoot('coverage-floor-')
    mkdirSync(join(root, '.claude', 'rules'), { recursive: true })
    writeFileSync(join(root, '.claude/rules/code-quality-thresholds.txt'), 'coverage.min_percent = 59.29  # ratchet\n')
    linkGate(root, ['.claude'])
    // The gate cannot read this line either, so it falls back to its own default — which is not
    // agreement, and is the state B-159 exists to remove.
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain("'default'")
  })

  it('test_the_main_route_also_refuses_a_report_that_covered_no_source_file', () => {
    // M7 — deleting the main route's whole scope guard left all 51 tests green, found independently
    // by two reviewers. The bug was OBSERVED on this route (`pnpm lint` in a kit-installed checkout)
    // and only the tracked-only route had a test for the fix. The one fixture with per-file entries
    // lived in the other describe, so this branch was unreachable from here.
    const result = run(scaffold({ floor: DECLARED_FLOOR, pct: 0, files: { total: 3, covered: 0 } }))

    expect(result.code, 'the main route reported a scope mismatch as a regression').toBe(0)
    expect(result.stdout).toContain('NO source file')
    expect(
      result.stdout,
      'the main-route message must name the overwrite, which is what makes it actionable',
    ).toContain('same path')
  })

  it('test_the_main_route_still_fails_when_the_tree_really_is_below_the_floor', () => {
    // Anti-vacuity for the test above, on this route: files ARE covered and the total is genuinely
    // below the floor, so the guard must still refuse.
    const result = run(scaffold({ floor: DECLARED_FLOOR, pct: 40, files: { total: 3, covered: 3 } }))

    expect(result.code).toBe(1)
  })

  it('test_slack_beyond_the_default_tolerance_exits_nonzero', () => {
    // Exercises TOLERANCE's DEFAULT, which no unit test reaches.
    expect(run(scaffold({ floor: DECLARED_FLOOR, pct: DECLARED_FLOOR + 5 })).code).toBe(1)
  })

  it('test_a_gain_within_the_default_tolerance_exits_zero', () => {
    // Positive control for the arm above — without it, a checker that always failed would pass it.
    expect(run(scaffold({ floor: DECLARED_FLOOR, pct: DECLARED_FLOOR + 0.5 })).code).toBe(0)
  })

  it('test_every_verdict_names_where_the_number_came_from', () => {
    // F-guard-3 / F-guard-23-r5: the first fix named the path only when the two disagreed, and the
    // clause it added was pinned by no test — deleting it survived the suite. An agreeing run that
    // does not say what it read is the half that was still unauditable.
    expect(run(scaffold({ floor: DECLARED_FLOOR })).stdout).toContain('read from')
    expect(run(scaffold({ floor: DECLARED_FLOOR, pct: DECLARED_FLOOR })).stdout).toContain('read from')
    expect(run(scaffold({ floor: DECLARED_FLOOR - 1 })).stdout).toContain('read from')
  })

  it('test_it_does_not_pick_between_two_layouts_it_cannot_tell_apart', () => {
    // `resolve_threshold` returns a value and a source KIND, not a path. With both files present
    // the gate's precedence decides, and this checker does not know which one won — so it says so
    // instead of printing one, which would be a guess dressed as a reading.
    const root = tempRoot('coverage-floor-')
    mkdirSync(join(root, 'rules'), { recursive: true })
    mkdirSync(join(root, '.claude', 'rules'), { recursive: true })
    writeFileSync(join(root, 'rules/code-quality-thresholds.txt'), 'coverage.min_percent = 5\n')
    writeFileSync(join(root, '.claude/rules/code-quality-thresholds.txt'), `coverage.min_percent = ${DECLARED_FLOOR}\n`)
    linkGate(root, [])
    const out = run(root).stdout
    expect(out).toContain('whichever of')
    expect(out).not.toMatch(/read from \S+ or/)
  })

  it('test_a_fallback_reports_what_it_saw_and_not_why', () => {
    // F-guard-22-r5: "the declaration is present but unreadable" was byte-identical for a file
    // that declares nothing at all — which is the shipped state of the thresholds file — so the
    // cause was asserted without being observed.
    const root = tempRoot('coverage-floor-')
    mkdirSync(join(root, '.claude', 'rules'), { recursive: true })
    writeFileSync(join(root, '.claude/rules/code-quality-thresholds.txt'), '# nothing declared\n')
    linkGate(root, ['.claude'])
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('read no usable coverage.min_percent')
    expect(result.stdout).not.toContain('present but unreadable')
  })

  it('test_a_gate_it_cannot_reach_is_an_error_and_never_an_agreement', () => {
    // Mutation-tested: neutering the error branch survived the suite, because the only test of it
    // called resolveViaGate directly and never went through main(). A thresholds file the checker
    // cannot ask about is the realistic case — the kit is not installed in this root.
    const root = tempRoot('coverage-floor-')
    mkdirSync(join(root, '.claude', 'rules'), { recursive: true })
    writeFileSync(join(root, '.claude/rules/code-quality-thresholds.txt'), `coverage.min_percent = ${DECLARED_FLOOR}\n`)
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('could not ask the gate')
  })

  it('test_an_absent_thresholds_file_skips_loudly_and_exits_zero', () => {
    const result = run(tempRoot('coverage-floor-'))
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('SKIPPED')
  })

  it('test_the_skip_message_does_not_assert_a_reason_it_did_not_observe', () => {
    // F-guard-3: the old message said "gitignored, so this is expected in CI" — a claim about WHY
    // the file was missing, made without looking, and false in the kit's standalone layout where
    // `rules/` sits at the root and a different floor is in force.
    expect(run(tempRoot('coverage-floor-')).stdout).not.toMatch(/expected in CI/)
  })

  it('test_it_reads_the_standalone_layout_the_python_gate_tries_first', () => {
    // F-guard-3. `coverage_gate.py::_THRESHOLD_FILES` tries `rules/` before `.claude/rules/`.
    const root = tempRoot('coverage-floor-')
    mkdirSync(join(root, 'rules'), { recursive: true })
    writeFileSync(join(root, 'rules/code-quality-thresholds.txt'), 'coverage.min_percent = 5\n')
    linkGate(root, [])
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('says 5%')
  })

  it('test_the_standalone_layout_wins_over_the_plugin_one', () => {
    // F-guard-12-r3: with only one file present, reversing FLOOR_PATHS kept the suite green — the
    // precedence was pinned by nothing. Both present, disagreeing, is the case that pins it.
    // `toContain('5')` also matched "59.29", so the assertion above is now on 'says 5%'.
    const root = tempRoot('coverage-floor-')
    mkdirSync(join(root, 'rules'), { recursive: true })
    mkdirSync(join(root, '.claude', 'rules'), { recursive: true })
    writeFileSync(join(root, 'rules/code-quality-thresholds.txt'), 'coverage.min_percent = 5\n')
    writeFileSync(join(root, '.claude/rules/code-quality-thresholds.txt'), `coverage.min_percent = ${DECLARED_FLOOR}\n`)
    linkGate(root, [])
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('says 5%')
  })

  it('test_it_falls_through_to_the_next_file_when_the_first_declares_nothing', () => {
    // F-guard-11-r3: the gate stops at the first file that yields a VALUE, not the first that
    // exists. Stopping earlier reported "the gate will use its default of 80" about a
    // configuration the gate reads correctly.
    const root = tempRoot('coverage-floor-')
    mkdirSync(join(root, 'rules'), { recursive: true })
    mkdirSync(join(root, '.claude', 'rules'), { recursive: true })
    writeFileSync(join(root, 'rules/code-quality-thresholds.txt'), '# nothing declared here\n')
    writeFileSync(join(root, '.claude/rules/code-quality-thresholds.txt'), `coverage.min_percent = ${DECLARED_FLOOR}\n`)
    linkGate(root, [])
    expect(run(root).code).toBe(0)
  })

  it('test_a_declaration_hidden_behind_a_bare_cr_is_caught_end_to_end', () => {
    // F-guard-10-r3 through the real binary, not just the parser. This is the shape that reported
    // agreement at 59.29 while the gate resolved 5.
    const root = tempRoot('coverage-floor-')
    mkdirSync(join(root, '.claude', 'rules'), { recursive: true })
    writeFileSync(
      join(root, '.claude/rules/code-quality-thresholds.txt'),
      `# ratchet note\rcoverage.min_percent = 5\ncoverage.min_percent = ${DECLARED_FLOOR}\n`,
    )
    linkGate(root, ['.claude'])
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('says 5%')
  })

  it('test_an_unmeasured_run_exits_zero', () => {
    // F-guard-2: the only exit-code mapping with no test, and the one that runs on every real
    // `pnpm lint` — the report is gitignored and no lint step produces one.
    const result = run(scaffold({ floor: DECLARED_FLOOR }))
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('NOT verified')
  })

  it('test_an_unreadable_thresholds_path_does_not_crash_the_lint_chain', () => {
    // A directory where the file should be: EISDIR. The first version let it throw a raw stack
    // trace out of `pnpm lint`.
    const root = tempRoot('coverage-floor-')
    mkdirSync(join(root, '.claude/rules/code-quality-thresholds.txt'), { recursive: true })
    linkGate(root, ['.claude'])
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stdout).not.toContain('EISDIR')
  })
})

describe('the tracked floor is checkable without the kit', () => {
  // B-160. `coverage.min_percent` never reaches a clone, so for a long time the checker SKIPped
  // there and printed "nothing here to compare it against" — while a coverage report sat in the
  // directory beside it. The comparison it could make was already written: `evaluateFloor` fails on
  // slack, so a lowered DECLARED_FLOOR is caught by the tracked half alone.
  const CLI = new URL('./check-coverage-floor.mjs', import.meta.url).pathname

  function reportOnly(pct) {
    const root = tempRoot('floor-noKit-')
    mkdirSync(join(root, 'coverage'), { recursive: true })
    writeFileSync(join(root, 'coverage/coverage-summary.json'), JSON.stringify({ total: { lines: { pct } } }))
    return root
  }
  function run(root) {
    try {
      return { code: 0, stdout: execFileSync('node', [CLI], { env: { ...process.env, COVERAGE_FLOOR_ROOT: root }, encoding: 'utf8' }) }
    } catch (error) {
      return { code: error.status, stdout: `${error.stdout ?? ''}` }
    }
  }

  it('test_a_tracked_floor_far_below_the_tree_fails_without_the_kit', () => {
    // LITERAL, not `DECLARED_FLOOR + 19`. The first version derived every fixture from the constant
    // under test, so lowering DECLARED_FLOOR lowered the report with it and every assertion still
    // held — the mutant survived the whole suite in a kit-less clone, which is the one environment
    // this branch exists for. A fixture computed from the thing it tests cannot detect a change in
    // that thing. Verified: with `.claude/` absent, DECLARED_FLOOR at 40 and at 100 both left the
    // suite green before this line existed.
    const result = run(reportOnly(78.15))
    expect(result.code).toBe(1)
    expect(result.stdout).toMatch(/slack/i)
  })

  it('test_the_tracked_floor_is_the_number_this_repository_measured', () => {
    // The other half of the same trap: pin the constant itself against a literal, so a mutant that
    // moves it is caught where `test_the_two_declarations_agree` cannot run — that one is
    // skipIf(!GATE_INSTALLED) and is skipped in exactly this environment.
    expect(DECLARED_FLOOR).toBe(62.03)
  })

  it('test_the_tolerance_boundary_is_pinned_on_this_route_too', () => {
    // These pin the EXACT boundary, one hundredth apart, so no widening of TOLERANCE survives.
    //
    // The previous pair (59.65 / 61.15) was written as the floor plus 0.5 and plus 2. Literal in the
    // source, relative in intent — and when the floor moved 59.15 -> 58.95 they stayed put and became
    // +0.70 / +2.20, which still brackets 1 but no longer brackets it tightly: mutating TOLERANCE
    // from 1 to 2 passed all 48 tests. Measured on this file, before and after that move.
    //
    // So the numbers below are literal AND adjacent: floor+1.00 must pass, floor+1.01 must fail.
    // `63.03 - 62.03` is exactly 1 in IEEE 754 — checked when the floor moved to 62.03, not assumed
    // and not inherited from the previous pair — so the passing side is not float-fragile. Moving
    // the floor again without moving these two turns this test red, which is the property the old
    // pair lacked, and which is what caught the 2026-09-10 re-declaration.
    expect(run(reportOnly(63.03)).code, 'exactly TOLERANCE above the floor must pass').toBe(0)
    expect(run(reportOnly(63.04)).code, 'one hundredth beyond TOLERANCE must fail').toBe(1)
  })

  // B-165 — `vitest run --coverage <one-file>` overwrites the same path with a report from a
  // different run, and the guard compared it to a whole-tree floor: observed 2026-09-09, `pnpm lint`
  // failed with "the floor 59.15% is above the measured total 10.29% ... Re-measure and re-declare"
  // of a floor that was correct.
  //
  // Measured against real reports from this repository, only one of three candidate signals works:
  // key count is 239 in both, the denominator is 4488 in both (the include glob is fixed), and files
  // WITH coverage is 181 whole-tree against 0 for a run that touches no source file. So the check
  // settles the extreme and nothing else, which is what these two tests pin.
  function report({ pct, filesCovered, filesTotal = 3 }) {
    const root = tempRoot('floor-scope-')
    mkdirSync(join(root, 'coverage'), { recursive: true })
    const json = { total: { lines: { pct, total: 4488, covered: Math.round((pct / 100) * 4488) } } }
    for (let i = 0; i < filesTotal; i += 1) {
      json[`/repo/packages/x/src/file-${String(i)}.ts`] = {
        lines: { pct: i < filesCovered ? 80 : 0, total: 10, covered: i < filesCovered ? 8 : 0 },
      }
    }
    writeFileSync(join(root, 'coverage/coverage-summary.json'), JSON.stringify(json))
    return root
  }

  it('test_a_report_that_covered_no_source_file_is_not_a_regression', () => {
    // A genuine 0% would mean the suite executed nothing, which the runner reports first. So this
    // shape is provably a partial run, and the one case the guard may settle on its own.
    const result = run(report({ pct: 0, filesCovered: 0 }))

    expect(result.code, 'a report covering no source file was called a regression').toBe(0)
    expect(result.stdout).toContain('NO source file')
    // F-tests-4: this read `.not.toContain('Re-measure and re-declare')` and was VACUOUS — the same
    // commit lowercased that phrase, so `toContain` was false on every reachable path and the
    // assertion could never fail. Matching case-insensitively is what makes it an assertion.
    expect(
      result.stdout.toLowerCase(),
      'it still proposed re-declaring a floor that is correct',
    ).not.toContain('re-measure and re-declare')
  })

  it('test_a_partial_run_that_did_cover_files_still_fails_and_says_why', () => {
    // The honest limit: 10.29% from one package's tests and 10.29% from a real regression are the
    // same JSON. The guard does NOT guess — it fails, which is the safe side, and the message names
    // the third possibility so a human settles it in one command instead of re-declaring the floor.
    const result = run(report({ pct: 10.29, filesCovered: 1 }))

    expect(result.code, 'the safe side is to fail when the report cannot be told apart').toBe(1)
    // F-tests-3: this matched /partial|full suite|whole tree/i, which survives restoring the old
    // two-cause text and appending "Re-run the full suite" — the misleading remedy comes back and
    // the test stays green. These pin the CAUSE and the absence of the wrong prescription instead.
    expect(
      result.stdout,
      'the message does not name the partial-run cause',
    ).toMatch(/came from a PARTIAL run/i)
    expect(
      result.stdout.toLowerCase(),
      'the message prescribes re-declaring before ruling out a partial run',
    ).toContain('re-run the full suite first')
  })

  it('test_a_regression_below_the_tracked_floor_fails', () => {
    // The arm the first version never exercised: `floor > measured`. Without it, a mutant that lets
    // a real coverage regression pass silently survives.
    const result = run(reportOnly(50))
    expect(result.code).toBe(1)
    expect(result.stdout).toMatch(/above the measured/i)
  })

  it('test_an_accurate_tracked_floor_passes_without_the_kit', () => {
    // Positive control: the arm above passes against a checker that always fails.
    expect(run(reportOnly(DECLARED_FLOOR)).code).toBe(0)
  })

  it('test_neither_thresholds_file_nor_report_still_skips', () => {
    const result = run(tempRoot('floor-empty-'))
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('SKIPPED')
  })

  it('test_the_skip_message_does_not_claim_there_is_nothing_to_compare', () => {
    // It said exactly that, with a report present. The sentence was stronger than the state.
    expect(run(reportOnly(DECLARED_FLOOR)).stdout).not.toMatch(/nothing here to compare/)
  })
})
