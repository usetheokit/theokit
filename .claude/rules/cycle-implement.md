# Cycle: IMPLEMENT

Source of Truth for the implementation cycle.

## Purpose

Execute a confidence-approved plan into code, tests, and commits. TDD-disciplined, halt-loop driven.

## Pre-conditions

- A plan exists at `knowledge-base/plans/{slug}-plan.md` with verdict ≥ SHIPPABLE_WITH_CAVEATS.
- The repository is on a branch other than `main` (per Unbreakable Rule 4 — work on `develop` or a feature branch).
- The project bootstrapped its language toolchain (e.g., `go.mod`, `package.json`, `pyproject.toml`, `Cargo.toml`).

If any pre-condition fails, refuse and surface the missing item.

## Chain (per task in the plan)

Each task runs as a halt-loop iteration:

```
RED      — write the failing test that captures the task's acceptance criterion
GREEN    — minimal code to pass the test
REFACTOR — improve structure; tests stay green
WIRING   — caller + integration test + runtime metric (the "wiring triad")
COMMIT   — atomic commit referencing the plan slug and task ID
```

## Wiring triad

A task is **not** complete until all three are present:

1. **Caller** — production code path that exercises the new behavior end-to-end.
2. **Integration test** — covers the boundary the unit test mocked.
3. **Runtime metric** — counter, histogram, or log line that lets ops see the new behavior in production. Without observability, the feature is invisible when it breaks.

## Hard gates (per iteration)

- Test suite green before commit.
- Linter clean (project-specific — see `rules/code-quality-languages.txt`).
- No new symbols left dangling (every new function/class has a caller or a test exercising it).
- CHANGELOG `[Unreleased]` updated (Unbreakable Rule 6).

## Hard gates (post-halt-loop, before `IMPLEMENTATION_COMPLETE` is honored)

`scripts/run_validation.py` runs after the promise marker and BEFORE the handoff. It consolidates (per ADR 0002 — `cq-gate-in-validate`) every post-implementation gate into one report:

- npm test / typecheck / lint / coverage gates (when applicable).
- Wiring triad summary (caller + integration test + runtime metric).
- **`/code-quality` verdict ∉ {FAIL_HARD, INVALID}** — invoked internally by the script. FAIL_SOFT and PASS_WITH_CAVEATS surface as WARN in the report but do not block. Override only with `--no-code-quality` (pre-code phase or CQ not installed).

Exit codes: `0` = `PASS` or `PARTIAL` (proceed); `1` = `FAIL` (trigger validation halt-loop — see below); `2` = invocation error (escalate to human).

## Validation halt-loop (mandatory when `run_validation.py` exits 1)

When the post-halt-loop gate returns `FAIL`, the skill re-invokes `ralph-loop:ralph-loop` with the validation-fix driver (`skills/implement/prompts/validation-fix-prompt.md`). This is the **default behavior of `/implement`**, not opt-in — driving validation fixes manually outside ralph-loop is the same contract violation as bypassing the Step 4 TDD halt-loop.

Contract:

- **Completion promise:** `<promise>VALIDATION_GATE_PASSED</promise>` — asserts `run_validation.py {slug}` re-run in the same iteration exited `0`.
- **Max iterations:** `5` (fix-mode is refinement; bounded smaller than Step 4).
- **Pre-flight guard:** verify the Step 4 `ralph-loop.local.md` has `active: false` before invoking; concurrent loops on overlapping state are an anti-pattern.
- **Per-iteration objective:** fix one (or one root-cause-clustered group of) `check.status == FAIL` per iteration; commit atomically (`fix(validation): …`); re-run `run_validation.py`; emit promise on exit 0 or STOP turn for next iteration.
- **Forbidden:** disabling/weakening failing tests, lowering coverage thresholds, no-op callers to satisfy pillar (a), hand-edited `.wiring-evidence.json`, ADR-defer of `symbol_fabrication_*` / `dead_code_unallowlisted_*` hard caps.

## Stop conditions

**Step 4 — TDD halt-loop:**

- Hard gate fails twice on the same task → halt-loop pauses, escalate to human.
- Plan task list exhausted → emit completion promise (`IMPLEMENTATION_COMPLETE`).

**Step 5.5 — Validation halt-loop:**

- Same check FAIL × 3 consecutive iterations with no observable progress → emit `VALIDATION_GATE_PASSED` with BLOCKED report.
- `iterations_used >= 5` and at least one check still FAIL → emit `VALIDATION_GATE_PASSED` with BLOCKED report.
- `code_quality INVALID` (contract itself broken) → HALT immediately; surface to human.
- Unremediatable `FAIL_HARD` (`symbol_fabrication_*` / `dead_code_unallowlisted_*` cannot be fixed without scope-creeping the plan) → emit promise with BLOCKED report; recommend loop back to `cycle-plan`.

**Either loop emitting a BLOCKED report blocks downstream:** `/review` and `/release` MUST NOT run until the human resolves the blocker. Honest BLOCKED > false PASS (Unbreakable Rule 3).

## Anti-patterns

- Writing production code before the failing test (skipping RED).
- Skipping REFACTOR because "tests are green" — the cycle is RED → GREEN → REFACTOR, not RED → GREEN → ship.
- WIRING done in a separate PR ("I'll wire it later"). Later never comes.
- Commits that mix multiple tasks. Each commit references one task ID.
- Editing the plan during implementation. If the plan was wrong, return to `/to-plan`.

## Output

- Commits on the working branch.
- `knowledge-base/implementations/{slug}/` — per-iteration logs.
- `knowledge-base/implementations/{slug}-implementation.md` — final summary with wiring triad checklist per task.

## Cross-references

- Schema for cycle rules: `rules/cycle-rule-schema.md`
- Skill: `skills/implement/SKILL.md`
- Conventions: `rules/architecture.md`, `rules/testing.md`, `rules/loop-engine-convention.md`
- Upstream: `rules/cycle-plan.md` (plan must reach verdict ≥ SHIPPABLE_WITH_CAVEATS)
- Downstream: `rules/cycle-code-quality.md` (runs after `IMPLEMENTATION_COMPLETE`)
