#!/usr/bin/env node
/**
 * The declared coverage floor must still describe the tree it was declared against.
 *
 * B-159 — `/implement`'s validation gate enforces a total-line-coverage floor. This repository
 * declared none, so `coverage_gate.py` fell back to `DEFAULT_MIN_PERCENT = 80` and reported its
 * source as `default`: a number nobody here chose, failing every plan that reached the gate. The
 * fix was to declare `coverage.min_percent` at exactly the measured total, with no slack.
 *
 * ## Why the declaration alone was not enough
 *
 * The failure modes are ASYMMETRIC:
 *
 *   - a value the gate cannot parse fails LOUDLY — it falls back to 80, so the next `/implement`
 *     FAILs and someone looks;
 *   - editing the number DOWNWARD fails SILENTLY. The gate passes, and because the thresholds file
 *     is gitignored the edit appears in no diff, no review and no CI.
 *
 * A ratchet whose own value can be lowered without anyone seeing is not a ratchet.
 *
 * ## `DECLARED_FLOOR` — the tracked half
 *
 * So the floor is declared TWICE, and the two must agree:
 *
 *   - `DECLARED_FLOOR` here, tracked by git, changed only by editing this file;
 *   - `coverage.min_percent` in the thresholds file, gitignored, read by the kit's gate.
 *
 * A downward edit of the gitignored value fails at any magnitude with no coverage report needed,
 * and lowering the floor legitimately means editing a TRACKED constant — which appears in a diff
 * and in review. The reason the edit was invisible was that nothing versioned knew what the number
 * used to be.
 *
 * Two declarations of one fact is the shape `check-sdk-pin.mjs` already carries here, for the same
 * reason: they pin the same thing, nothing makes them move together, so a check does.
 *
 * ## Why it ASKS the gate instead of parsing the file
 *
 * This used to reimplement `resolve_threshold` in JavaScript. That could not converge. Two
 * consecutive adversarial passes found character-class divergences between the two parsers, each
 * one a way to lower the effective floor while this checker reported AGREEMENT and no versioned
 * file changed — the exact premise the tracked declaration exists to provide:
 *
 *   - `split('\n')` vs Python's `splitlines()`, which also breaks on CR, VT, FF, the three
 *     file/group/record separators, NEL and U+2028/9. A declaration behind a stray CR:
 *     gate 5, checker "agrees at 59.29".
 *   - `String.trim()` vs Python's `str.strip()`, which differ on U+001C..U+001F and U+FEFF. A
 *     leading U+001F: gate 0, checker "agrees at 59.29".
 *   - `Number()` vs `float()` on `0x3B`, `1_0`, `nan`, `inf` — in both directions.
 *
 * Fixing each as it was found is not a strategy; there are more character classes than rounds of
 * review. Two parsers of one file will keep diverging, so there is now one parser, and it is the
 * one whose answer matters. `resolve_threshold` also owns the path precedence, the fall-through to
 * the next file and the numeric grammar — every one of which produced a finding while this mirrored
 * them imperfectly.
 *
 * Parsimony ladder rung 2: the thing that answers this question already exists. Ask it.
 *
 * ## What it deliberately cannot do
 *
 * CI cannot compare the two DECLARATIONS. The thresholds file lives under `.claude/`, which this
 * repository does not version, so in a CI checkout it is absent and the two halves cannot be held
 * against each other there — that agreement stays a property of a machine that installed the kit.
 *
 * What it CAN do there, since B-160: hold `DECLARED_FLOOR` against a coverage report, if one
 * exists. With neither the thresholds file nor a report it still SKIPs, naming which of the two it
 * lacks. **This does not make coverage a merge gate** — no workflow produces a report today, so in
 * CI as it stands the skip path is what runs, and `.github/workflows/ci.yml` was deliberately left
 * alone: coverage there costs a measured +23s on a 70-second job, so the obstacle is not price but
 * that adding the step changes what every future PR must satisfy.
 *
 * Nor does it verify coverage at `pnpm lint` time. `run_validation.py` runs `npm run lint` BEFORE
 * the step that regenerates the report, so at lint time the report is from a previous run or
 * absent. Its age is printed rather than assumed, and the agreement check does not depend on it.
 *
 * ## On the tolerance, which is narrower than it looks
 *
 * `TOLERANCE` governs ONE question: how far the measured total may rise above the floor before this
 * asks you to raise it. It has nothing to do with downward edits — the agreement check catches
 * those exactly, at any magnitude. Zero here would redden lint on every coverage-improving commit
 * until someone edited a gitignored file, and a gate people bypass is the failure this ecosystem
 * exists to prevent.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Both layouts. Used ONLY to decide whether there is anything to ask about, and to name the paths
 * in the skip message — the precedence between them belongs to `resolve_threshold` now.
 *
 * Mutation-tested: reversing this list changes nothing, and that is correct rather than a gap in
 * the suite. It used to be load-bearing, and every time it was, it produced a finding.
 */
const FLOOR_PATHS = ['rules/code-quality-thresholds.txt', '.claude/rules/code-quality-thresholds.txt']
const REPORT_PATH = 'coverage/coverage-summary.json'
const KEY = 'coverage.min_percent'

/** Where `coverage_gate.py` lives, in both layouts, matching FLOOR_PATHS above. */
const GATE_DIRS = ['skills/implement/scripts', '.claude/skills/implement/scripts']

/**
 * The floor this repository has agreed to, tracked by git.
 *
 * Lowering it is a reviewable edit to a versioned file, by construction. Raising it is the only
 * change the ratchet welcomes; both must be mirrored into the thresholds file the kit's gate reads.
 *
 * THIS NUMBER IS THE MINIMUM OVER THE ENVIRONMENT SPACE, and it is NOT a zero-slack ratchet in
 * every environment. Saying otherwise took two corrections to get right, so the history is worth
 * keeping:
 *
 *   59.29  declared first, from the maintainer's working tree. Acceptance on the v0.24.0 tag
 *          FAILED — the tag measured lower.
 *   59.2   declared second, from what was called a "clean checkout". It was not: that worktree had
 *          `.claude` symlinked in before the run, so the correction was measured in the same kind
 *          of contaminated environment as the defect it corrected.
 *   59.18  measured with every known contamination channel absent, one variable at a time.
 *   59.15  the same, after B-162 moved the tests out of `src/`. `hooks-test-helpers.ts` is test
 *          scaffolding that lived there; it is not a `*.test.*` file, so the reporter's exclude
 *          never matched it and the include counted its 3 lines as PRODUCTION. Moving it removes
 *          them from both sides — 2655/4488.
 *   58.96  declared at B-167's first pass, over 2647/4489 — the denominator carried one
 *          instrumented line that the second pass removed, so this pair describes no revision that
 *          survives. Recorded because a floor citing a denominator nothing measures is exactly the
 *          drift the ladder exists to make visible.
 *   58.97  the same 2647 lines over 4488. Measured after the third site was migrated.
 *   58.98  2648/4489, after B-168 added two guards.
 *   59.06  2656/4497, after B-171 taught rules and skills to follow the configured state dir. The floor tracks the tree; each move here is a
 *          measurement someone ran, not a number someone chose.
 *   58.95  declared at B-161's close, and the first one measured with the CHECKOUT axis actually
 *          closed rather than assumed: 2646/4488, twice in a real `git clone` with its own install
 *          and twice here, compared per file — 239 files, four metrics, zero divergences.
 * *   62.03  2814/4536, declared 2026-09-10 after a code review's 62 findings were fixed. The
 *          numerator moved because four clusters gained tests where there had been none: the
 *          all-projects session sweep's APPLY phase (entered by no test at all, with two
 *          data-losing defects inside it), the three-state hook trust classification, the consent
 *          state model at 0%, and credential provenance at 0%. Measured under the protocol below
 *          rather than from the working tree — twice in a real `git clone` with its own install
 *          and an empty `$HOME`, and once here; all three returned 2814/4536 exactly, which is the
 *          agreement the CHECKOUT axis being closed predicts.
 *
 * VERIFIED — not re-declared — at `e06337c`, once the review batch was complete. A protocol run
 * (real clone, own install, empty `$HOME`) reads 2799/4491 = 62.32%. Numerator AND denominator both
 * moved from the 2814/4536 above: the command-dispatch restructure removed 131 code lines, so this
 * is a different tree rather than drift within the same one.
 *
 * 62.32 against a floor of 62.03 is 0.29 of slack, inside `TOLERANCE`, so nothing was raised. That
 * is the tolerance doing its job rather than an omission — the note on it below says a zero
 * tolerance "would redden lint on every coverage-improving commit until someone edited a gitignored
 * file, and a gate people bypass is the failure this ecosystem exists to prevent". Recorded so the
 * next reader can tell a floor that was CHECKED from one that was merely left alone.
 *
 * The drop from 59.15 is the point, not a regression. Those ~9 lines were covered only because
 * tests read the ambient environment; the repository had them by accident of where the suite ran,
 * and no clone ever did.
 *
 * FOUR channels were closed, and every one had the same shape — the seam existed and the call site
 * did not use it:
 *
 *   `context/agents-md.ts`      three tests passed `process.cwd()` where a tmpdir belonged.
 *   `session/gc/per-session.ts` a test injected `readdir`/`cwd` into `planSessionGC` and gave
 *                               `runSessionGC` neither.
 *   `context/rules.ts` (panel)  four `statusPanel` calls omitted the wiring record, and one passed
 *                               a PARTIAL record — which reaches the same disk fallback, because
 *                               `rules` is optional on the type.
 *   `context/rules.ts` (route)  `showStatus` reaches that fallback via `currentWiring()`.
 *
 * WHAT IS STILL OPEN, so the number above is not read as more than it is: the HOME axis, tracked as
 * B-167. Same tree, same commit, varying only $HOME — empty measures 2646/4488, a home holding a
 * 163,836-char `~/.theokit/rules` measures 2648/4488. `ChatOverrides` carries `cwd` and no `home`,
 * so `homedir()` is reached at three sites in one build and no caller can redirect it.
 *
 * A populated home therefore measures ABOVE this floor, inside `TOLERANCE`, and passes — which is
 * what a floor is for. The declaration is sound; it is the equality that is axis-scoped.
 *
 * Re-declare from a real clone with its own install — not a worktree with linked `node_modules`,
 * which resolves `@theocode/*` back into the original tree and silently measures a blend of both.
 * That mistake was made once here and its numbers were discarded.
 * Re-declare from a checkout with NO `.claude`, no ancestor context file and no transcript store —
 * and verify the three, rather than assuming a /tmp path is enough. It was not, twice.
 */
export const DECLARED_FLOOR = 62.03

/**
 * WHY NO COVERAGE STEP IN CI, recorded here because here is where the floor is declared.
 *
 * `.github/workflows/ci.yml` produces no coverage report, so in CI the check above takes the skip
 * path and this constant is compared against nothing. That is a decision, not an oversight, and the
 * number behind it is measured: `pnpm test` 42.5s, `pnpm test:coverage` 65.3s, the CI `test` job
 * 70s — **+23s**. Price is not the obstacle. Adding the step changes what every future pull request
 * must satisfy, which is a decision about this project's CI policy rather than part of fixing a
 * checker.
 *
 * It is written in this file rather than in a plan because B-160's own acceptance criterion asked
 * for the decision "recorded with its reason WHERE THE FLOOR IS DECLARED" — and the plan that first
 * recorded it lives under `.claude/`, which no clone receives. A reason filed where the reader
 * cannot reach it satisfies the letter of that criterion and not its point.
 */

/** Percentage points the total may sit above the floor before a re-declaration is asked for. */
const TOLERANCE = 1

/**
 * The floor the kit's gate will actually use, asked OF the gate.
 *
 * Returns `{ value, source }` as `resolve_threshold` does — `source` matters as much as the number:
 * `'default'` means the gate could not read the declaration at all, which is B-159's original
 * symptom and is NOT agreement.
 */
export function resolveViaGate(root, python = 'python3') {
  const script = [
    'import json,sys',
    'from pathlib import Path',
    ...GATE_DIRS.map((dir) => `sys.path.insert(0, ${JSON.stringify(join(root, dir))})`),
    'import coverage_gate as g',
    `value, source = g.resolve_threshold(Path(${JSON.stringify(root)}))`,
    'print(json.dumps({"value": value, "source": source}))',
  ].join('\n')

  try {
    const stdout = execFileSync(python, ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return JSON.parse(stdout)
  } catch (error) {
    // Python missing, the kit not installed, or the gate raising on the file it was handed. The
    // last one is worth surfacing rather than swallowing: a non-UTF-8 byte makes `resolve_threshold`
    // raise, and a checker that exits 0 there says the two agree when neither was read.
    return { error: `${error.stderr ?? error.message}`.trim().split('\n').slice(-1)[0] }
  }
}

/** Whether the gitignored declaration still agrees with the tracked one. */
export function compareToDeclared(floor, declared = DECLARED_FLOOR) {
  if (floor === declared) return { status: 'OK' }
  const direction = floor < declared ? 'LOWERED' : 'raised'
  return {
    status: 'FAIL',
    message:
      `the thresholds file says ${floor}% and DECLARED_FLOOR in this file says ${declared}% — ` +
      `the floor was ${direction} in the thresholds file only. Both must move together: the ` +
      'tracked constant is what makes the change visible in a diff.',
  }
}

/**
 * Total line coverage from istanbul's `json-summary`, or `null` when it is unreadable.
 *
 * The gate tries four artifact shapes; this reads the one this repository's reporter emits. Saying
 * "as the gate reads it" overstated that.
 */
/**
 * How many source files the report shows ANY coverage for, or `null` when unreadable.
 *
 * B-165 — a report is a claim about a set of files, and `vitest run --coverage <one-file>` overwrites
 * the same path with a report from a different run. The guard compared one to a whole-tree floor and
 * said "the floor 58.95% is above the measured total 10.29% ... Re-measure and re-declare" — of a
 * floor that was correct. Observed 2026-09-09 in `pnpm lint`.
 *
 * Three candidate signals were measured against real reports from this repository, and two of them
 * do not work here:
 *
 *   key count     239 in BOTH. `coverage.include` is a fixed glob, so every source file appears in
 *                 every report whether or not the run touched it.
 *   denominator   4488 in BOTH, for the same reason.
 *   files covered 181 whole-tree, 0 for a `tools/` run.
 *
 * So the only honest reading is the third, and it only settles the extreme: a report where NO source
 * file has coverage did not measure the source tree, and cannot be a regression — a genuine 0% would
 * mean the suite executed nothing, which the suite runner would have reported first.
 *
 * A partial run that DOES touch some files (a single package's tests, the 10.29% case) is
 * indistinguishable from a real regression by anything inside the JSON. The guard does not guess
 * there; it fails, and names the third possibility so the reader can settle it in one command.
 */
export function readFilesCovered(reportJson) {
  try {
    const report = JSON.parse(reportJson)
    if (report === null || typeof report !== 'object') return null
    const files = Object.entries(report).filter(([name]) => name !== 'total')
    // No per-file entries at all is not "zero files covered" — it is a report that does not carry
    // the information, and the two must not collapse. A minimal `{total: …}` document says nothing
    // about scope, so the caller gets `null` and falls through to the value check as before. This
    // is also what closes the serious case: a broken `coverage.include` yields a report with no
    // entries and `pct: "Unknown"` (measured), so it reaches the value check rather than the skip.
    if (files.length === 0) return null
    // An entry without a `lines` block is unknown, not zero. Reading it as zero let a report the
    // checker could not understand be reported as "coverage for NO source file" — naming a cause it
    // never observed, which is the defect this file exists to refuse.
    if (files.some(([, entry]) => typeof entry?.lines?.covered !== 'number')) return null
    return files.filter(([, entry]) => entry.lines.covered > 0).length
  } catch {
    return null
  }
}

export function readMeasured(reportJson) {
  try {
    // `_from_json_summary` reads this exact field, already rounded. Recomputing from covered/total
    // gives 59.2963… and fails against the 59.29 the gate compares.
    const pct = JSON.parse(reportJson)?.total?.lines?.pct
    return typeof pct === 'number' ? pct : null
  } catch {
    return null
  }
}

/** Whether the declared floor still describes the measured tree. */
export function evaluateFloor({ floor, measured, tolerance = TOLERANCE }) {
  if (measured === null || measured === undefined) {
    // Never `OK`: a measurement that could not be read must not read as agreement.
    return { status: 'UNMEASURED', message: `no parseable ${REPORT_PATH}; floor ${floor}% was NOT verified` }
  }
  if (floor > measured) {
    return {
      status: 'FAIL',
      message:
        `the floor ${floor}% is above the measured total ${measured}% — every plan halts here. ` +
        'THREE things produce this and the report cannot tell them apart: the tree regressed; ' +
        'the floor was declared against a different one (a coverage-tool major bump re-accounts ' +
        'the same code); or this report came from a PARTIAL run — a single-file coverage run ' +
        'writes to this same path. Re-run the full suite first; re-measure and re-declare only ' +
        'if the number holds.',
    }
  }
  if (measured - floor > tolerance) {
    return {
      status: 'FAIL',
      message:
        `the floor ${floor}% now sits ${(measured - floor).toFixed(2)} points below the measured ` +
        `${measured}% — that gap is slack, and slack is what makes a floor decorative. ` +
        `Raise it to ${measured}.`,
    }
  }
  return { status: 'OK', message: `floor ${floor}%, measured ${measured}%` }
}

/** The report's age in whole minutes, or `null` when it is unreadable. */
function ageMinutes(path) {
  try {
    return Math.round((Date.now() - statSync(path).mtimeMs) / 60000)
  } catch {
    return null
  }
}

/**
 * Which file the number came from, without pretending to know when it cannot.
 *
 * `resolve_threshold` returns a value and a source kind, not a path. With one candidate present
 * that is unambiguous; with both, the gate's own precedence decides and this says so rather than
 * naming one — the previous version printed `A or B`, which reads as a guess between them.
 */
function sourceNote(present) {
  if (present.length === 1) return `(read from ${present[0]})`
  return `(from whichever of ${present.join(', ')} the gate resolves first)`
}

/** Read a file, or `null`. `existsSync` says a path exists; it does not say it can be read. */
function readOrNull(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * The no-thresholds-file route: hold the TRACKED floor against the report, if one exists.
 *
 * B-160. This used to skip and say "nothing here to compare it against" — with a coverage report
 * sitting in the directory beside it. There IS something: `DECLARED_FLOOR` is tracked and
 * travels, so in a clone it is the ONLY half available, and comparing it to the measured total
 * is the one check this environment supports. `evaluateFloor` already does it: a floor sitting
 * further below the tree than TOLERANCE fails, which is exactly the mutant this was filed about
 * — DECLARED_FLOOR lowered to 40 against a measured 59, surviving the whole suite until now.
 *
 * What this still cannot see is `coverage.min_percent`, which no clone has. The two halves
 * agreeing stays a property of a machine that installed the kit.
 */
function checkTrackedFloorOnly(reportFile, say) {
  const text = existsSync(reportFile) ? readOrNull(reportFile) : null
  const measured = text === null ? null : readMeasured(text)
  if (measured === null) {
    say(
      `[coverage-floor] SKIPPED — no ${FLOOR_PATHS.join(' or ')} and no parseable ${REPORT_PATH}. ` +
        `The tracked floor is ${DECLARED_FLOOR}%, and nothing here measures the tree to compare it to.`,
    )
    return 0
  }
  // B-165 — the same scope refusal as the main path. The partial-report false alarm fires on
  // THIS route too: a checkout without the kit installed reaches here, and a single-file report is
  // just as incomparable to a whole-tree floor with or without a thresholds file.
  if (readFilesCovered(text) === 0) {
    say(
      '[coverage-floor] SKIPPED — the report shows coverage for NO source file, so it did not ' +
        'measure the source tree. Run `pnpm test:coverage` — `pnpm test` writes no report.',
    )
    return 0
  }

  const trackedOnly = evaluateFloor({ floor: DECLARED_FLOOR, measured })
  // The age travels on this route too. The `readFilesCovered` note above says a number without its
  // age is a claim about now, and the first version of this branch dropped it — including on the
  // failing arm, which tells the reader to raise the floor to a figure it will not date.
  const age = ageMinutes(reportFile)
  const stamp = age === null ? '' : ` (report ${age}m old)`
  say(`[coverage-floor] no thresholds file — checking the TRACKED floor only. ${trackedOnly.message}${stamp}`)
  return trackedOnly.status === 'OK' ? 0 : 1
}

/** The measured-floor evaluation: the agreed value against the report on disk, scope-checked. */
function checkAgainstReport(reportFile, floor, present, say) {
  const reportText = existsSync(reportFile) ? readOrNull(reportFile) : null
  const measured = reportText === null ? null : readMeasured(reportText)

  // A report that covered no source file did not measure the tree, so its total is not comparable to
  // a whole-tree floor. This is an exact test, not a fraction: ADR-1 rejected a coverage-fraction
  // threshold by name, because any ratio is a number that silently accepts real regressions.
  const covered = reportText === null ? null : readFilesCovered(reportText)
  if (covered === 0) {
    const fileCount = Object.keys(JSON.parse(reportText)).length - 1
    say(
      `[coverage-floor] SKIPPED — the report shows coverage for NO source file (0 of ${String(fileCount)} ` +
        'entries), so it did not measure the source tree: a partial coverage run writes to the same ' +
        'path. Run `pnpm test:coverage` to check the value — `pnpm test` writes no report.',
    )
    return 0
  }

  const result = evaluateFloor({ floor, measured })

  if (result.status === 'UNMEASURED') {
    // Not a failure. `pnpm lint` runs before the step that regenerates the report, so this is the
    // ordinary case there — and the agreement check upstream already ran without needing one.
    say(`[coverage-floor] floor ${floor}% agrees with DECLARED_FLOOR ${sourceNote(present)}; ${result.message}`)
    return 0
  }

  const age = ageMinutes(reportFile)
  // The OK path names its source too. A checker that only says where it read when it disagrees
  // leaves the agreeing case unauditable, which is the half of F-guard-3 the first fix missed.
  // A number without its age is a claim about now. This checker does not regenerate the report.
  const stamp = age === null ? '' : ` (report ${age}m old)`
  say(`[coverage-floor] ${result.message} ${sourceNote(present)}${stamp}`)
  return result.status === 'OK' ? 0 : 1
}

function main() {
  const root = process.env['COVERAGE_FLOOR_ROOT'] ?? join(dirname(fileURLToPath(import.meta.url)), '..')
  const say = (line) => process.stdout.write(`${line}\n`)

  const reportFile = join(root, REPORT_PATH)
  const present = FLOOR_PATHS.map((relative) => join(root, relative)).filter((path) => existsSync(path))
  if (present.length === 0) return checkTrackedFloorOnly(reportFile, say)

  const resolved = resolveViaGate(root)
  if (resolved.error !== undefined) {
    // A gate that cannot answer is not a gate that agreed.
    say(`[coverage-floor] could not ask the gate what floor it resolves: ${resolved.error}`)
    return 1
  }
  if (resolved.source !== 'project') {
    // Says what was observed and stops there. `source === 'default'` means the gate read no usable
    // declaration; it does not say whether the key was absent, malformed, or hidden behind a
    // separator this checker no longer tries to recognise. Naming a cause it did not observe is the
    // defect this whole file exists to catch, one level up.
    say(
      `[coverage-floor] the gate resolves ${resolved.value}% from '${resolved.source}' — it read no ` +
        `usable ${KEY} from ${present.join(' or ')}, so the tracked floor of ${DECLARED_FLOOR}% is ` +
        'not in force.',
    )
    return 1
  }

  const agreement = compareToDeclared(resolved.value)
  if (agreement.status !== 'OK') {
    // F-guard-3: naming the file matters when both layouts are present — "the thresholds file"
    // does not say which one, and the remedy is an edit to a specific path.
    say(`[coverage-floor] ${agreement.message} ${sourceNote(present)}`)
    return 1
  }

  return checkAgainstReport(reportFile, resolved.value, present, say)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main())
}
