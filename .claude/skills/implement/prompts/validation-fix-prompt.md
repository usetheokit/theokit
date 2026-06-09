# Validation Halt-Loop Driver Prompt

You are in the post-implementation **VALIDATION FIX loop**, iteration {ITERATION}.

Implementation tasks already produced commits on the working branch. `/implement` Step 5 ran `scripts/run_validation.py {PLAN_SLUG}` and got `overall_status = "FAIL"`. Your contract: fix the specific check failures until `run_validation.py` exits 0 (overall `PASS` or `PARTIAL`), then emit `<promise>VALIDATION_GATE_PASSED</promise>`.

**Plan:** `{PLAN_PATH}`
**Implementation working contract:** `{IMPLEMENTATION_PATH}`
**Last validation report (markdown):** `{VALIDATION_REPORT_PATH}`
**Last validation report (JSON, captured during Step 5):** `{VALIDATION_REPORT_JSON_PATH}`
**Progress file:** `.claude/knowledge-base/implementations/.progress-{PLAN_SLUG}.json` (gitignored)
**SEPA agent file:** `.claude/agents/implement-{PLAN_SLUG}-{DATE}/sepa.md`

## Your contract for this iteration

1. **Read** `{VALIDATION_REPORT_JSON_PATH}`. Identify ALL entries in `checks[]` with `status == "FAIL"`. Ignore `WARN`, `PARTIAL`, `SKIP` — they are non-blocking.
2. **Fix ONE failing check this iteration** when fixes are independent (smaller diffs are safer). If two FAILs share a root cause (e.g., `npm test` + `coverage` both stem from one untested branch), fix them together.
3. **Apply the fix protocol** for the targeted check from § Fix protocols below.
4. **Commit** the fix per § Commit discipline.
5. **Re-run** `python3 .claude/skills/implement/scripts/run_validation.py {PLAN_SLUG}`.
   - Exit 0 (`overall_status` ∈ {`PASS`, `PARTIAL`}) → emit `<promise>VALIDATION_GATE_PASSED</promise>` at end of response.
   - Exit 1 (`overall_status` == `FAIL`) → STOP your turn. Stop hook restarts you in iteration {ITERATION + 1}.

## Fix protocols per check

### `npm test` FAIL

- Read `stderr_tail` from the report — identify the failing test file + assertion.
- If the failure is a **regression** (test was passing pre-Step-4): the offending production code is the suspect, NOT the test.
- If the failure reveals a **new edge case** (test exposed a path your task missed): write the failing test FIRST (Unbreakable: TDD-first), then fix the production code.
- **Forbidden:** disabling the test, marking it `skip`, weakening the assertion.
- Run the specific failing file first (`npm test -- {test-file}`), then the full suite to confirm no new regression.

### `npm run typecheck` / `tsc --noEmit` FAIL

- Resolve types narrowly. Read `stderr_tail` for the exact line + diagnostic.
- **Forbidden:** `any`, `unknown as X`, `@ts-ignore`, `@ts-expect-error` without justifying inline comment naming the diagnostic code.
- If the type drift requires changes across more than 1 file, halt this iteration and consult SEPA (per `implementation-prompt.md § SEPA invocation discipline`) before continuing.

### `npm run lint` FAIL

- Fix each rule violation. **Forbidden:** `// eslint-disable-next-line` without a one-line comment naming the rule AND explaining why suppression is correct.
- Auto-fixers may be used (`npm run lint -- --fix`) only when their output is reviewed in the same commit diff.

### `coverage` FAIL

- Open the coverage report (path in `stderr_tail` or default reporter output) and identify file(s) below threshold (< 90% on changed files, < 100% on plan-declared critical paths).
- Add tests exercising the uncovered branches. Tests must follow AAA (Arrange-Act-Assert) and target BEHAVIOR not implementation details (CLAUDE.md § 7).
- **Forbidden:** lowering the threshold to make coverage pass.

### `wiring_triad` FAIL (pillar a/b/c with `fail > 0`)

Open `.progress-{PLAN_SLUG}.json` and the wiring summary in the report. For each task with `wiring.<pillar> == "fail"`:

- **Pillar (a) — static caller fail:** add a FUNCTIONAL caller in production code. The caller must exist because something genuinely needs to call the symbol. If no caller is functionally justified, the symbol is dead code — DELETE it; do NOT add a no-op call to satisfy the pillar.
- **Pillar (b) — integration test fail:** add an integration test under `tests/integration/` exercising the symbol against a real boundary, OR add `<!-- ADR-DEFER-WIRING-B: <rationale> -->` in the implementation task contract.
- **Pillar (c) — runtime metric fail:** run the integration test that should fire the declared metric. If it does NOT fire, the wiring is incorrect — fix the metric emission. NEVER hand-edit `.wiring-evidence.json` (Unbreakable: no fabricated evidence).

### `code_quality` FAIL (verdict ∈ {`FAIL_HARD`, `INVALID`})

- **`FAIL_HARD` with `hard_caps_triggered` including `symbol_fabrication_*` or `dead_code_unallowlisted_*`:** these caps are NEVER ADR-deferrable. Fix the underlying issue — remove fabricated symbols, remove dead code, OR add the symbol to the allowlist with documented rationale per `rules/code-quality-golden-rule.md`.
- **`INVALID`:** the code-quality contract itself is broken (golden-rule missing, allowlist malformed). HALT this loop immediately, surface to human. Do NOT iterate trying to repair the contract from inside a validation-fix iteration.

## TDD discipline applies here too

The Unbreakable Rule "no production code without a failing test first" applies inside this loop. If you discover a new edge case while fixing, write the failing test FIRST, watch it fail, then implement the fix.

## Commit discipline

Each iteration that produces code changes MUST commit atomically:

```
fix(validation): <one-line description>

Plan: {PLAN_SLUG}
Validation-iter: {ITERATION}
Closes-check: <check-name-from-report>
```

- Stage ONLY the files touched by this fix (`git add` with explicit paths — NEVER `git add -A` / `git add .`).
- NEVER `git commit --no-verify` (Unbreakable: fix the hook failure, don't bypass).
- NEVER `git checkout` / `git revert` / `git reset --hard` / `git push --force` (Unbreakable Rule 4 — use `git switch`, `git restore --staged`, `git stash --soft`).
- NEVER edit the plan (`{PLAN_PATH}`) — the plan is the contract.
- CHANGELOG `[Unreleased]` entry under appropriate category if the fix is consumer-visible (Unbreakable Rule 6).

## State-file guard (concurrent ralph-loop prevention)

Before this loop started, `/implement` Step 5.5 verified that any prior `ralph-loop.local.md` state was inactive (the Step 4 TDD loop had emitted `IMPLEMENTATION_COMPLETE` and exited). You MUST NOT:

- Spawn a nested ralph-loop inside this iteration.
- Modify `ralph-loop.local.md` directly.

If you observe `ralph-loop.local.md` with `active: true` referencing a DIFFERENT slug, HALT immediately and surface the conflict — concurrent loops on overlapping state are a documented anti-pattern (`rules/loop-engine-convention.md § Anti-patterns`).

## Promise marker discipline

Emit AT THE VERY END of your response, **on its own isolated line, plain text, NO backticks, NO fenced code blocks, NO markdown wrapping, no indentation**:

<promise>VALIDATION_GATE_PASSED</promise>

This emission is allowed ONLY when `python3 .claude/skills/implement/scripts/run_validation.py {PLAN_SLUG}` (re-run in THIS iteration after your fix) exits with code 0. Emitting speculatively (without re-running the script) is a contract violation.

INCORRECT forms that will NOT terminate the loop:

- Wrapped in backticks: `` `<promise>VALIDATION_GATE_PASSED</promise>` ``
- Inside a fenced code block (triple backticks)
- Indented inside a list item or quote
- Embedded mid-sentence

After emitting, a one-paragraph summary is allowed (checks fixed / iterations used / next step), but the promise marker MUST be on its own isolated line before any trailing prose.

If exit code != 0, do NOT emit the promise. STOP your turn — the Stop hook will restart you in iteration {ITERATION + 1}.

## When to give up honestly

HALT and surface a BLOCKED report — do NOT emit `<promise>VALIDATION_GATE_PASSED</promise>` — if ANY of:

- The same check (same `name`) is FAIL for 3 consecutive iterations with no observable progress (compare `stderr_tail` between iterations).
- A `code_quality` `FAIL_HARD` with `symbol_fabrication_*` or `dead_code_unallowlisted_*` that you genuinely cannot remediate without scope-creeping beyond the plan.
- A `code_quality` `INVALID` (contract itself broken) — HALT immediately.
- An external dependency unavailable for fix (e.g., test fixture file deleted, CI tool absent).

In all cases, the response BODY must include:

```
BLOCKED checks (validation gate NOT passed):
  - <check.name>: <last stderr_tail summary> [<iterations-stuck>]
  - ...
Reason for HALT: <one-line explicit reason>
Recommended next step: <human action required>
```

Do NOT emit the promise marker. The promise `<promise>VALIDATION_GATE_PASSED</promise>` is emitted EXCLUSIVELY when `run_validation.py` re-run in the current iteration exits 0. There is no graceful-exit path that emits the promise from a partial pass. The downstream `/implement` Step 6 will surface BLOCKED to the user; `/review` and `/release` MUST NOT run. Honest BLOCKED > false completion (Unbreakable Rule 3).
