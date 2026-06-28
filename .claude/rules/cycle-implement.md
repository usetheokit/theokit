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
GREEN    — walk the parsimony ladder, then write the minimal code to pass the test
REFACTOR — improve structure; tests stay green
WIRING   — caller + integration test + runtime metric (the "wiring triad")
COMMIT   — atomic commit referencing the plan slug and task ID
```

## Parsimony gate (GREEN-phase deliberation — pre-write)

Before writing any production code in the GREEN phase, the halt-loop walks the
**parsimony ladder** (`rules/parsimony-ladder.md`) top-down and stops at the first
rung that resolves the need. The six rungs are defined once in that file — not
restated here, per DRY (`parsimony-ladder.md § How each rung is enforced`).

This is a **deliberation, not a detector** — it is the proactive counterpart to the
reactive dead-code / scope-creep gates downstream. The ladder NEVER justifies
skipping a test, input validation, error handling, security, or accessibility — see
`rules/parsimony-ladder.md § Never on the chopping block`. A parsimony argument that
weakens correctness is a Rule 3 (honesty) violation, not a win.

## Wiring triad

A task is **not** complete until all three are present:

1. **Caller** — production code path that exercises the new behavior end-to-end.
2. **Integration test** — covers the boundary the unit test mocked.
3. **Runtime metric** — counter, histogram, or log line that lets ops see the new behavior in production. Without observability, the feature is invisible when it breaks.

## Hard gates (pre-loop, at Step 2)

- **Every plan task has an executable RED-test shape** — verified by `skills/implement/scripts/check_tdd_shape.py`. Tasks whose `#### TDD` body contains only prose (no assertion / GWT / `test_<behavior>` literal) BLOCK the halt-loop from starting. Defense in depth against vague plans that slipped past `/plan-confidence`'s `check_criterion_executability`. Failure path: loop back to `cycle-plan` `/plan-improve`.

## Hard gates (per iteration)

- Parsimony ladder walked before GREEN-phase code is written (`rules/parsimony-ladder.md`) — guardrail items (tests/validation/error-handling/security/accessibility) never sacrificed.
- Test suite green before commit.
- Linter clean (project-specific — see `rules/code-quality-languages.txt`).
- No new symbols left dangling (every new function/class has a caller or a test exercising it).
- CHANGELOG `[Unreleased]` updated (Unbreakable Rule 6).

## Hard gates (per phase boundary — Step 4.7 mini review)

When a commit closes a `## Phase N` of the plan, `skills/implement/scripts/mini_review.py` MUST run BEFORE the halt-loop accepts the next task. Verdict drives:

| Verdict | Trigger | Action |
|---|---|---|
| `PHASE_REVIEW_PASS` | No HIGH or BLOCKER findings | Proceed to next phase |
| `PHASE_REVIEW_NEEDS_FIX` | ≥ 1 HIGH/BLOCKER finding | Halt-loop emits BLOCKED with report path; surface to human; resume via § Step 4 "Resume after recovered blocker" only after fix |

Aggregated checks: phase completeness, diff cohesion (declared scope vs modified files), wiring summary (pillar a non-negotiable across all phase symbols), delta-scoped code-quality (currently SKIP — full audit still runs at Step 5).

Skipping mini review on phase boundary is a documented anti-pattern: design problems compound across phases, and each skipped boundary lets defects propagate into the next phase where they become harder to localize. Plans without `## Phase N` headers cause Step 4.7 to SKIP gracefully (no phases → no boundaries).

## Hard gates (post-halt-loop, before `IMPLEMENTATION_COMPLETE` is honored)

`scripts/run_validation.py` runs after the promise marker and BEFORE the handoff. It consolidates (per ADR 0002 — `cq-gate-in-validate`) every post-implementation gate into one report:

- **Progress-checkpoint schema — validated fail-fast, before any gate that reads it.** `check_progress_schema.py` confirms `.progress-{slug}.json` matches the canonical shape (`skills/implement/templates/progress-schema.json`): a `tasks` array of objects keyed by `id` (not `task_id`), each with `phase`/`status` and, once committed, `commit_sha`/`files`. A malformed checkpoint FAILs loudly instead of letting phase-scoped gates degrade silently.
- **Checkpoint-vs-git consistency.** `check_checkpoint_consistency.py` cross-checks the checkpoint against the real git history both ways: every `committed` task points at a SHA that exists, and every plan task referenced by a real commit (`T{N.M}` convention in the message) is recorded `committed`. Nothing forces the halt-loop to update `.progress` at write time, but a task finished + committed without a matching checkpoint entry FAILs here (and on each phase boundary), so the omission cannot reach handoff. Heuristic limit: relies on the commit-message task-id convention.
- npm test / typecheck / lint / coverage gates (when applicable).
- **Wiring summary — independently re-verified, never self-reported.** Symbols are derived from the committed diffs and `check_wiring.py` is re-run per symbol; a progress file claiming pillar (a) pass over an actually-uncalled symbol is caught as fabricated evidence (FAIL). Trusting the self-reported `wiring` field is the bypass this closes.
- **Acceptance-criteria gate** — enforces the plan's mechanizable AC/DoD that the command gates miss (file-size budget per changed file, CHANGELOG-updated) and surfaces non-mechanizable criteria (backward-compat) for human evidence instead of accepting a self-ticked box.
- **Test-obligation gate** — declared concurrency tests / failure scenarios must have at least one matching test in the tree; total absence when the plan promised them is a FAIL (a generic green suite never exercised them).
- **`/code-quality` verdict ∉ {FAIL_HARD, INVALID}** — invoked internally by the script. FAIL_SOFT and PASS_WITH_CAVEATS surface as WARN in the report but do not block. Override only with `--no-code-quality` (pre-code phase or CQ not installed).

Exit codes: `0` = `PASS` or `PARTIAL` (proceed); `1` = `FAIL` (trigger validation halt-loop — see below); `2` = invocation error (escalate to human).

## Validation halt-loop (mandatory when `run_validation.py` exits 1)

When the post-halt-loop gate returns `FAIL`, the skill re-invokes `ralph-loop:ralph-loop` with the validation-fix driver (`skills/implement/prompts/validation-fix-prompt.md`). This is the **default behavior of `/implement`**, not opt-in — driving validation fixes manually outside ralph-loop is the same contract violation as bypassing the Step 4 TDD halt-loop.

Contract:

- **Completion promise:** `<promise>VALIDATION_GATE_PASSED</promise>` — asserts `run_validation.py {slug}` re-run in the same iteration exited `0`. The loop runs until validation actually passes; never emit this promise on a partial pass.
- **Pre-flight guard:** verify the Step 4 `ralph-loop.local.md` has `active: false` before invoking; concurrent loops on overlapping state are an anti-pattern.
- **Per-iteration objective:** fix one (or one root-cause-clustered group of) `check.status == FAIL` per iteration; commit atomically (`fix(validation): …`); re-run `run_validation.py`; emit promise on exit 0 or STOP turn for next iteration.
- **Forbidden:** disabling/weakening failing tests, lowering coverage thresholds, no-op callers to satisfy pillar (a), hand-edited `.wiring-evidence.json`, ADR-defer of `symbol_fabrication_*` / `dead_code_unallowlisted_*` hard caps, emitting the promise on a `BLOCKED` exit to satisfy a downstream gate.

## Stop conditions

**Step 4 — TDD halt-loop:**

- Hard gate fails twice on the same task → halt-loop pauses, escalate to human.
- Plan task list exhausted → emit completion promise (`IMPLEMENTATION_COMPLETE`).

**Step 5.5 — Validation halt-loop:**

- Same check FAIL × 3 consecutive iterations with **no observable progress** (identical diagnostic, identical failure shape, no new diff direction) → HALT; surface BLOCKED report to the human. **Do NOT emit `VALIDATION_GATE_PASSED`** — the gate did not pass.
- `code_quality INVALID` (contract itself broken) → HALT immediately; surface to human.
- Unremediatable `FAIL_HARD` (`symbol_fabrication_*` / `dead_code_unallowlisted_*` cannot be fixed without scope-creeping the plan) → HALT; surface BLOCKED report; recommend loop back to `cycle-plan`. **Do NOT emit the completion promise** — the validation gate has NOT passed.

The promise `VALIDATION_GATE_PASSED` is emitted EXCLUSIVELY when `run_validation.py` exits `0`. There is no graceful-exit path that emits the promise on a partial pass. Honest BLOCKED > false PASS (Unbreakable Rule 3).

**Either loop emitting a BLOCKED report blocks downstream:** `/review` and `/release` MUST NOT run until the human resolves the blocker.

## Anti-patterns

- Writing production code before the failing test (skipping RED).
- Skipping REFACTOR because "tests are green" — the cycle is RED → GREEN → REFACTOR, not RED → GREEN → ship.
- WIRING done in a separate PR ("I'll wire it later"). Later never comes.
- Commits that mix multiple tasks. Each commit references one task ID.
- Editing the plan during implementation. If the plan was wrong, return to `/to-plan`.

## Output

- Commits on the working branch.
- `knowledge-base/implementations/.progress-{slug}.json` — the runtime checkpoint (gitignored) the halt-loop writes each iteration and every gate reads. Schema: `skills/implement/templates/progress-schema.json`.
- `knowledge-base/implementations/{slug}/` — per-iteration logs.
- `knowledge-base/implementations/{slug}-implementation.md` — final summary with wiring triad checklist per task.

## Cross-references

- Schema for cycle rules: `rules/cycle-rule-schema.md`
- Skill: `skills/implement/SKILL.md`
- Conventions: `rules/architecture.md`, `rules/testing.md`, `rules/error-handling.md`, `rules/git-safety.md`, `rules/loop-engine-convention.md`, `rules/parsimony-ladder.md`
- Macro super-loop: `rules/cycle-roadmap.md` — one cycle-implement run per milestone in the super-loop
- Upstream: `rules/cycle-plan.md` (plan must reach verdict ≥ SHIPPABLE_WITH_CAVEATS)
- Downstream: `rules/cycle-code-quality.md` (runs after `IMPLEMENTATION_COMPLETE`)
- Companion gates against plan vagueness:
  - Plan-side (heuristic, linguistic): `skills/plan-confidence/scripts/check_criterion_executability.py`
  - Implement-side (structural, shape detection): `skills/implement/scripts/check_tdd_shape.py`
- Phase-boundary mini review (Step 4.7):
  - Orchestrator: `skills/implement/scripts/mini_review.py`
  - Phase completeness: `skills/implement/scripts/check_phase_completeness.py`
  - Diff cohesion: `skills/implement/scripts/check_diff_cohesion.py`
  - Reports persisted at: `knowledge-base/mini-reviews/{slug}-phase{N}-review-{date}.md`
  - Companion to `cycle-review.md` (final review): mini review runs per-phase; cycle-review runs once at the end. Both must pass for handoff.
