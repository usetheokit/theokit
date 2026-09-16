import { cpus } from 'node:os'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Default is os.availableParallelism(): one fork per core, each booting a full
    // test environment. Capping leaves headroom for the host, and costs no wall-clock
    // because the gain above this point was already noise when measured.
    maxWorkers: Math.max(2, cpus().length - 4),
    // Tests live in a per-package `tests/` mirror of `src/`, per rules/testing.md § 5.
    // `tools/` keeps its tests beside its checkers: it is not a package and has no `src/`.
    include: ['packages/*/tests/**/*.test.{ts,tsx}', 'tools/**/*.test.mjs'],
    environment: 'node',
    /**
     * The default is 5000, and the first test in any file that builds an agent was landing at
     * ~5100 under full-suite parallelism while passing in ~700ms alone.
     *
     * MEASURED before changing this, because raising a timeout to silence a red test is how a real
     * defect gets buried: importing `@theokit/agents` costs ~420ms on its own, `resolveToolScope`
     * ~17ms, `new ToolRegistry` ~8ms, and the B-059 composition entry ~1ms. The cost is the
     * framework barrel, which every agent-building file pays once at import, and it predates any of
     * this work — the 51st test file simply pushed the parallel workers past the line.
     *
     * So this is a threshold that was always too tight for a 400ms import, not a slowdown to fix.
     * A flaky test is a bug (`rules/testing.md` § 3) and the fix belongs at the cause; the cause
     * here is the limit itself.
     */
    testTimeout: 20_000,
    /**
     * B-063 — the first coverage this repository has ever measured, and the reason it exists is
     * that three different matchers answered "which files are untested" with 51, 7 and 55 files.
     * All three read STRINGS: a filename appearing in a test file's text, an import specifier
     * resolved to a path. None of them ran anything.
     *
     * The instructive failure was `packages/agent/src/session/gc/per-session.ts`, scored TESTED
     * because `pointer.test.ts:11` names it in a prose COMMENT. Coverage, which runs the tests
     * rather than reading them, puts it at 46% — and its only production caller,
     * `packages/cli/src/commands/sessions.ts`, at ZERO.
     *
     * MEASURED 2026-08-20, 555 tests:
     *
     *   Statements  47.58%  (4827/10144)      files in packages/  179
     *   Branches    76.04%  (1000/1315)       at ZERO coverage     40  (1748 lines)
     *   Functions   57.00%  (358/628)
     *
     * NO THRESHOLD IS SET BY VITEST, and that is still deliberate. B-063's reasoning was: a floor
     * picked to sit just under today's number is decorative — it ratchets nothing and turns green
     * into noise; a floor picked ABOVE it fails the build on work nobody has scheduled. Either way
     * the number would be chosen to be passed rather than to be met.
     *
     * B-159 (2026-09-09) overturned half of that, and only half. "No floor" stopped being
     * available: `/implement`'s validation gate enforces one regardless, and with none declared it
     * used DEFAULT_MIN_PERCENT = 80 from the kit's `coverage_gate.py` — a number chosen by nobody
     * here, failing every plan. The choice was never floor-vs-no-floor; it was our number vs a
     * library's.
     *
     * So a floor now exists, in `.claude/rules/code-quality-thresholds.txt` as
     * `coverage.min_percent`, set to EXACTLY the measured total with no slack. The slack is what
     * B-063's sentence was about: it is what permits regression while reading as a standard. With
     * none, a change taken through `/implement` that lowers total coverage fails. That is a
     * ratchet, not a decoration.
     *
     * TWO LIMITS, because that path does not exist in a fresh clone. `.claude/` is gitignored, so
     * the number above binds a checkout that installed the kit, and CI runs `pnpm test` without
     * coverage. What DOES travel is `DECLARED_FLOOR` in `tools/check-coverage-floor.mjs`: the same
     * number, tracked, checked against the gitignored one on every `pnpm lint`. Lowering the floor
     * therefore means editing a versioned file, which is the point — before that constant existed,
     * a downward edit appeared in no diff at all.
     *
     * It is deliberately NOT here. This file configures the reporter; the gate that reads the
     * report is the kit's, and one number in one place is the whole point.
     *
     * MEASURED 2026-09-09 at B-161's close, 1534 tests: lines 59.03% (2653/4494), IN A CLEAN CLONE
     * AND IN THIS WORKING TREE ALIKE. That equality is the result, and the qualifier below is the
     * limit of it.
     *
     * THE CHECKOUT AXIS IS CLOSED. A `git clone` with its own install and an installed checkout
     * were each measured twice and compared per file: 239 files, four metrics, ZERO divergences.
     * Four channels were closed to get there, and all four had the same shape — the injection seam
     * already existed and the call sites did not use it:
     *
     *   `context/agents-md.ts`      three tests passed `process.cwd()` where a tmpdir belonged.
     *   `session/gc/per-session.ts` a test injected `readdir`/`cwd` into `planSessionGC` and gave
     *                               `runSessionGC` neither, so it fell through to the real store.
     *   `context/rules.ts` (panel)  four `statusPanel` calls omitted the wiring record; the panel
     *                               reads the corpus off disk when it has none.
     *   `context/rules.ts` (route)  `showStatus` reaches the same fallback through `currentWiring()`,
     *                               which is undefined until a build publishes a record.
     *
     * THE HOME AXIS IS CLOSED AS OF 2026-09-10, and the two halves of that took different work.
     * B-167 landed the seam — `ChatOverrides.home`, threaded to the sites that used to call
     * `homedir()` with no way for a caller to redirect them. What the seam did not do is prove the
     * axis shut, and this block went on claiming the opposite with the pre-seam numbers under it.
     *
     * Re-measured at `e25f5b9`, same tree, varying only $HOME: an empty home and a home holding
     * 189,660 chars of `~/.theokit/rules` + `AGENTS.md` + a skill BOTH measure 2799/4491 (62.32%).
     * Compared per file rather than on the totals — 242 files, four metrics, zero divergences.
     *
     * That result was NOT taken at face value, because "no divergence" and "the instrument is
     * blind" print the same thing. A throwaway probe read the ambient root through production
     * (`userSkills()`, `loadUserRules(homedir())`) with coverage scoped to `context/`, under the
     * same two homes: 29/187 lines empty against 46/187 full, with `rules.ts` going 26/50 -> 42/50.
     * A home that IS read moves the number by seventeen lines, so the suite's zero is a measurement
     * and not a blind spot. The probe was deleted; none of it is in the tree.
     *
     * WHAT "CLOSED" DOES NOT CLAIM, so it is not over-read. It says no test in the CURRENT suite
     * reads the ambient home in a way that changes coverage. Production still calls `homedir()`
     * where `buildChatAgent` cannot redirect it — the B-171 set (trust store, config, hook trust,
     * MCP scopes) and `commands/command-content.ts:63,128`, where the seam injects the chain
     * FUNCTION and leaves the home ambient. No test exercises those against a populated home today,
     * which is exactly why the number does not move. A future test that does, without isolating
     * $HOME, reopens the axis with nothing here to catch it.
     *
     * The declared floor is 62.03 — the MINIMUM over the space, not "the clean number". Three
     * earlier attempts got it wrong and each failure is worth keeping: 59.29 came from this tree
     * and the v0.24.0 tag failed against it; 59.2 came from a worktree with `.claude` linked in;
     * 59.18 and 59.15 were each correct when written and were left standing here after the floor
     * moved beneath them — which is why this block now states its own axis instead of only its
     * number.
     *
     * DO NOT DIFFERENCE THESE AGAINST THE 2026-08-20 BLOCK ABOVE. A first draft of this comment
     * said "1154 lines of the original debt were covered in three weeks", from 1748 − 594. Three
     * reviewers falsified it independently: the two runs used different major versions of the
     * coverage tool (`@vitest/coverage-v8` ^3.2.7 -> ^4.1.11), and the re-accounting is visible —
     * with this `coverage:` block byte-identical and the source set GROWING 179 -> 240 files,
     * reported statements halved (10144 -> 5054) while branches and functions roughly doubled. A
     * single glob over a growing tree cannot do that; the counting basis changed. Each run is
     * correct about its own tree. The subtraction is not a measurement of anything.
     *
     * What survives the version change better is the file COUNT: 40 files at zero coverage out of
     * 179 by B-063's own reckoning (the glob at `0be3066` holds 181), down to 34 out of 240 today.
     * Better, not perfectly — v4's AST remapping produces 24 entries with no executable lines at
     * all, which are excluded from the 34, and the v3 report is gone so the same exclusion cannot
     * be re-applied to the old figure. Read it as a direction, not a delta: fewer untouched files
     * across a larger codebase, with no floor in force. So the floor is not what produces the
     * improvement; it is what stops the loss.
     *
     * What makes a floor MEANINGFUL is still the decision B-063 named and nobody has made: WHICH
     * of the zero-coverage files are meant to stay that way — `main.ts` and command entry points
     * are arguably composition, and `use-tui-composition.ts` is arguably not. That triage remains
     * the next item, and 62.03% is a ratchet against the clean reading, never a target.
     *
     * WHAT `include` LEAVES OUT, AND WHY IT IS A DECISION RATHER THAN AN OVERSIGHT. The glob is
     * `packages/*\/src`, so the twelve checkers under `tools/` — the `npm run lint` chain and two of
     * the six required status checks — contribute nothing to this number. That includes
     * `check-coverage-floor.mjs` itself: the gate guarding coverage sits outside the thing it
     * guards.
     *
     * They ARE tested — eleven `.mjs` test files run in this suite and pass. What did not exist was
     * a number. Measured 2026-09-10 over `tools/**\/*.mjs` with the same provider: lines 43.72%
     * (331/757), statements 43.95%, functions 52%.
     *
     * That number is why they stay out rather than an argument for folding them in. At 43.72% they
     * sit twenty points under this floor, so a single `include` covering both would drop the total
     * and force the ratchet DOWN — a gate weakened by the act of widening its scope. Two populations
     * with different coverage expectations averaged into one figure also make the figure answer
     * neither question: a regression in app source could be masked by a checker gaining a test.
     *
     * The honest fix, if one is wanted, is a SEPARATE floor for `tools/`, not a shared one. It is
     * deliberately not built here: nothing has yet needed it, and this comment turns "nobody knows
     * how much of the build chain is reached" into a measured 43.72% that anyone can re-run.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
    },
  },
})
