---
name: implement
description: Executes an implementation plan from cycle-plan via halt-loop (ralph-loop) with TDD discipline + wiring triad (caller + integration test + runtime metric) + quality gates (SOLID, Clean Code, DRY, Design Patterns). Single entry-point for cycle-implement. Use after /to-plan chain returned verdict ≥ SHIPPABLE_WITH_CAVEATS while working on `develop`.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit Skill Agent
argument-hint: "{plan-slug} [--max-iterations 50] [--time-budget 8h]"
---

# Implement — Plan → Code Halt-Loop

Single entry-point for [`cycle-implement`](../../rules/cycle-implement.md). Reads a validated implementation plan, drives an autonomous TDD halt-loop task-by-task, enforces the **wiring triad** + quality rules, and produces commits on `develop` ready for `cycle-review`.

## Cycle contract

This skill is **the only phase** of [`cycle-implement`](../../rules/cycle-implement.md). The cycle rule is the **source of truth** for:

- Pre-conditions (plan verdict ≥ SHIPPABLE_WITH_CAVEATS; on `develop`; never on `main`)
- Hard gates (TDD RED phase MUST fail; TDD GREEN MUST pass; wiring triad; validate gate)
- Stop conditions (3-attempt fail per task; max iterations; environment broken)
- Anti-patterns (no TDD-skip, no main commits, no `git checkout`/`git revert`/`git push --force`)
- Rollback (`git stash` + `git switch`/`--soft reset`, NEVER `--hard`)

**Read `cycle-implement.md` before invoking this skill.** This SKILL.md retains phase-specific detail (halt-loop driver workflow, wiring triad script, quality-rule enforcement during execute, validation gate).

## When to Trigger

User explicitly invokes `/implement {plan-slug}` when:

- A plan at `knowledge-base/plans/{slug}-plan.md` has `/plan-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- Current branch is `develop` (verify: `git branch --show-current` == `develop`)
- The development environment is operational (language toolchain installed; external services up if integration tests require them)

Refuse to start when any pre-condition fails — surface the missing piece honestly.

## Quality rules (enforced during the halt-loop)

These are the rules that EVERY task in the halt-loop honors. Phase-specific enforcement:

### SOLID

Each new module/class/function checked against SOLID at REFACTOR phase of TDD:

- **SRP**: function/class has ONE reason to change. If you used "and" in the description ("X validates AND persists AND notifies"), split.
- **OCP**: prefer composition over inheritance for variation points. Add behavior via new code, not by editing existing switch/case branches.
- **LSP**: subtypes substitute parent without breaking callers. No `NotImplementedException` in overrides.
- **ISP**: interfaces are role-shaped, not header-shaped. If consumers depend on methods they don't call, split the interface.
- **DIP**: high-level modules MUST NOT import from low-level adapter modules. The project's specific layering is declared in `rules/architecture.md`.

### Clean Code

- Naming: per `rules/architecture.md § Naming conventions` (each project declares its own)
- Function size: < 20 lines as guideline; if larger, justify or split
- No comments explaining WHAT (well-named code already does that); only WHY when non-obvious
- No dead code: every export reachable from a public entry-point OR a test
- No untyped escape hatches (`any`, `interface{}`, `Object`) in typed languages — per `rules/architecture.md`
- No ad-hoc `print` / `console.log` in production paths — use the project's structured logger

### DRY

- Rule of three: extract abstraction only on the third repetition of the same KNOWLEDGE
- Code that LOOKS similar but represents DIFFERENT concepts: do NOT merge — accidental coupling is worse than minor duplication
- Constants and enums centralized; magic numbers forbidden

### Design Patterns

Use established patterns when the problem matches; do NOT invent novel patterns mid-implementation.

Common patterns to recognize and use deliberately:

- **Adapter** — implements the same domain interface against different external systems
- **Strategy** — interchangeable algorithms behind a stable contract
- **Repository** — abstracts persistence behind a domain-shaped interface
- **Pipeline** — sequential stages with explicit fallbacks
- **State machine / Reconciler** — declarative desired-state convergence

When a `*-patterns` skill from `cycle-discover` is registered AND its trigger phrases match the current task, the halt-loop SHOULD consult it as documented in `to-plan/SKILL.md § Step 0`. Override of a pattern requires an ADR.

### WIRING (HARD GATE — the main rule)

**Implementation is NOT done until it is wired.** "Code compiles" and "tests pass" are necessary but NOT sufficient.

The wiring triad — enforced by `scripts/check_wiring.py` at the end of every task and before final commit:

| Pillar | What it asserts | Enforcement |
|---|---|---|
| **(a) Static caller** | Every new public export is invoked by at least 1 production caller | `grep -rl 'symbolName' <src-root>/ --exclude='*test*' --exclude-dir=<vendor>` must return ≥1 file |
| **(b) Integration test** | Every new behavior is exercised in at least 1 integration test that hits the real boundary (real DB, real external API stub with deterministic fixture, etc.) | `grep -rl 'symbolName' <integration-test-root>/` must return ≥1 file OR ADR-deferred for first-iteration prototypes |
| **(c) Runtime metric** | Every metric/counter declared in the plan's Global DoD is observed non-zero during an integration test run | `.wiring-evidence.json` (written by integration test infra) shows `metric_name: count > 0` OR plan declared no metrics for this task |

Failure of any pillar = HALT before commit. The halt-loop iterates until all three pass OR an ADR explicitly defers a pillar with rationale (warn-first for pillars (b) and (c) during prototype phases; pillar (a) is non-negotiable).

**Pre-code phase reality check.** In a project without source code yet (pre-release / pre-spike), the `.wiring-evidence.json` writer infra does not yet exist. Any plan that declares a runtime metric MUST explicitly defer pillar (c) via an ADR, e.g.: `ADR D-wiring-c: pillar (c) deferred until integration-test infra ships with evidence writer`. Without that ADR, the first task declaring a metric will HALT at pillar (c) with no remediation path. Plans authored during pre-code phase SHOULD either omit metric declarations or include the deferral ADR upfront.

**Why the triad exists:** "code compiles + unit tests pass" routinely lets dead code, orphan exports, and unobserved metrics ship as if they were wired. The triad forces evidence that the new symbol is actually called from production paths, exercised by an integration test against the real boundary, and (when the plan promised observability) observed firing at least once.

## Workflow

### Step 1 — Pre-condition validation (refuse if any fails)

```bash
# Check 1: plan exists and verdict is acceptable
test -f knowledge-base/plans/{slug}-plan.md
# Check 2: on develop (NEVER on main — main is release-only per Unbreakable Rule 4)
[ "$(git branch --show-current)" = "develop" ]
# Check 3: no uncommitted changes
[ -z "$(git status --porcelain)" ]
# Check 4: project bootstrapped (language toolchain ready)
# Detect by manifest: go.mod, package.json, pyproject.toml, Cargo.toml, etc.
# If absent, surface "pre-code phase — validate gate will skip toolchain-based checks"
# Check 5: language runtime version satisfies project lock (if a lockfile declares one)
# E.g., .nvmrc / .python-version / rust-toolchain.toml — compare to active runtime
```

**Runtime version mismatch handling:** if the active language runtime does not satisfy the project's declared version lock (e.g., `.nvmrc`, `.python-version`, `rust-toolchain.toml`, `go.mod`'s `go` directive), surface honestly. Likely cause on dev machines: default shell PATH points at the system runtime, while a version manager (nvm, pyenv, rustup, gvm) hosts the correct one elsewhere. The fix is environmental — refuse to start the halt-loop and instruct the user to activate the right runtime. Surfacing the mismatch early prevents puzzling test failures.

If any HARD check fails, refuse to start. Surface the missing piece.

### Step 2 — Parse plan into ordered task list

Read `knowledge-base/plans/{slug}-plan.md`. Extract:

- Phase list with dependencies (declared in plan's Dependency Graph section)
- Per-task: Files to edit, TDD section (RED tests), Acceptance Criteria, DoD entries
- Global DoD entries (test/typecheck/lint/coverage gates + runtime-metric proof targets)

Write the ordered task list to `knowledge-base/implementations/{slug}-implementation.md` using `templates/implementation-task-template.md`. This file is the halt-loop's working contract.

### Step 2.5 — Spawn the SEPA (agent + paired knowledge skill)

**Mandatory step. SEPA = Specialist Engineer Per-plan Agent** — a read-only second opinion consulted 3× per iteration (before RED, after GREEN, before COMMIT). Each `/implement` invocation generates a NEW SEPA agent + paired knowledge skill, both composed from the FULL plan + ADRs + edge-case review + deps audit + plan-confidence report + project rules.

The full SEPA protocol — composition, initial brief, per-iteration invocation, log persistence, boundaries, skip conditions — lives in [`reference/sepa.md`](./reference/sepa.md). Read it before invoking. Summary of the steps SEPA generation requires:

1. Read `templates/sepa-staff-engineer-template.md` and write the agent file to `agents/implement-{slug}-{date}/sepa.md`.
2. Read `templates/sepa-knowledge-skill-template.md` and write the paired skill to `skills/implement-{slug}-sepa-knowledge/SKILL.md`.
3. Invoke `Agent` ONCE for the initial brief; persist the response under `knowledge-base/implementations/{slug}/sepa-iterations/initial-brief-response.md`.
4. Each halt-loop iteration consults SEPA 3× via the same `Agent` subagent type.

### Step 3 — Build the halt-loop prompt (file-referenced pattern)

**Read `rules/loop-engine-convention.md § How to invoke ralph-loop:ralph-loop safely` BEFORE this step.** The ralph-loop positional argument is shell-evaluated; inlining a multi-section prompt (backticks / fenced code blocks / `$(...)`) breaks loop startup with a bash parse error.

Build the per-invocation driver file:

1. Read `prompts/implementation-prompt.md` and substitute static placeholders:
   - `{PLAN_SLUG}`, `{PLAN_PATH}`, `{IMPLEMENTATION_PATH}`
   - `{MAX_ITERATIONS}` — default 50 (more than discover-execute because TDD has 3 phases per task; bump to 80 if plan has > 15 tasks)
   - `{TIME_BUDGET}` — default 8h (configurable; warn at 75%, halt at 100%)
   - Leave `{ITERATION}` for ralph-loop to substitute per iteration.
2. Write the substituted text to `halt-loop-prompts/implement-{plan-slug}.md` (gitignored).

### Step 4 — Invoke ralph-loop (shell-safe positional prompt + flags) — MANDATORY

**The halt-loop is the ONLY mode of execution. Driving tasks manually outside of ralph-loop is a contract violation.** The skill exists to wrap a `cycle-plan` output in a long-running TDD halt-loop; bypassing the loop defeats the whole point (audit trail, restart-on-Stop hook, max-iterations safety, promise-marker termination).

Use the Skill tool to invoke `ralph-loop:ralph-loop`:

- Positional prompt (no shell metachars): `Read halt-loop-prompts/implement-{plan-slug}.md and follow its instructions for this halt-loop iteration.`
- `--completion-promise 'IMPLEMENTATION_COMPLETE'`
- `--max-iterations N` (matches `{MAX_ITERATIONS}` from Step 3)

Each iteration, ralph-loop replays the short positional prompt; Claude reads the driver file and drives one TDD step.

#### The loop drives until ONE of these terminal states (no other exit is valid):

| Terminal state | Trigger | Skill action |
|---|---|---|
| `<promise>IMPLEMENTATION_COMPLETE</promise>` | All tasks status=`committed` OR `blocked` with reason; all DoD checkboxes true | Proceed to Step 5 (validation gate) |
| `<promise>IMPLEMENTATION_COMPLETE</promise>` with honest BLOCKED report | `iterations_used >= MAX_ITERATIONS` OR time budget exhausted OR same task fails GREEN 3× OR plan-defect halt | Surface BLOCKED tasks to user; do NOT pretend complete |
| Ralph-loop cancelled externally (Stop hook removed, user `/cancel`, etc.) | User intervention OR fatal environment failure | **See § "Resume after recovered blocker" below — re-invoke ralph-loop with corrected state. NEVER drive remaining tasks manually.** |

Each iteration executes ONE task's complete TDD cycle:

1. **RED phase:** write the failing test from the plan's TDD section, run it, confirm FAIL
2. **GREEN phase:** write minimal production code, run test, confirm PASS
3. **REFACTOR phase:** review code against SOLID/Clean Code/DRY rules; clean up; tests stay green
4. **WIRING phase:** run `python3 skills/implement/scripts/check_wiring.py {symbol-name}` — HALT if any pillar fails
5. **COMMIT phase:** atomic commit with conventional-commit format (`feat(scope): description`, `fix(scope): description`, etc.) referencing plan task ID
6. **PROGRESS:** update `.progress-{slug}.json` audit trail

If a task fails at any phase, the iteration HALTS (no commit), surfaces the failure honestly, and the loop attempts up to 3 retries with revised approach. After 3 attempts, mark task BLOCKED and continue OR escalate to human per stop conditions in cycle rule.

#### Resume after recovered blocker

When ralph-loop is cancelled mid-flight by a legitimate blocker (HIGH CVE, plan revision, env fix), do NOT continue driving tasks manually — re-invoke ralph-loop with the corrected state. The 6-step resume protocol is documented in [`reference/resume-protocol.md`](./reference/resume-protocol.md).

Key invariant: the skill never asks the user for permission between tasks while pending tasks remain. Re-invoking ralph-loop is the canonical resume path.

### Step 5 — Validation gate (single-shot attempt)

After the halt-loop emits `<promise>IMPLEMENTATION_COMPLETE</promise>` (or exhausts), run ONCE:

```bash
python3 skills/implement/scripts/run_validation.py {slug}
```

This script consolidates (per ADR 0002 — `cq-gate-in-validate`) every post-implementation gate into one report:

- Project test runner — exit 0 (skip if no manifest detected — pre-code phase)
- Project type-checker / strict linter — exit 0
- Coverage gate — ≥ 90% on changed files; 100% on critical paths declared in plan
- Wiring summary — aggregated `check_wiring.py` across all changed symbols
- `/code-quality` verdict (invoked internally by the script via `cq_invoke`) — `FAIL_HARD` / `INVALID` map to check `FAIL` and BLOCK handoff; `FAIL_SOFT` / `PASS_WITH_CAVEATS` map to `WARN` (non-blocking)

**Outputs:**

- JSON report on stdout (overall_status, per-check status, summary)
- Markdown summary at `knowledge-base/reviews/{slug}-implement-validate-{date}.md`
- Exit code: `0` for `PASS` or `PARTIAL` (passes with documented SKIPs); `1` for `FAIL`; `2` for invocation error

**Branching:**

- Exit `0` → proceed directly to Step 6 (no fix-loop needed).
- Exit `1` → proceed to **Step 5.5 (Validation halt-loop)** — fix-mode iteration until convergence.
- Exit `2` → invocation error (slug missing, project root not found). Surface to human; do NOT attempt the fix-loop on a broken environment.

The exact commands per language live in `rules/code-quality-languages.txt` and the project's build manifest (`Makefile`, `package.json#scripts`, `pyproject.toml`, etc.).

### Step 5.5 — Validation halt-loop (MANDATORY when Step 5 returns FAIL)

When Step 5 exits with code `1`, the skill re-invokes `ralph-loop:ralph-loop` with a fix-mode driver. This is the **default behavior** — driving validation fixes manually outside ralph-loop is the same contract violation as bypassing Step 4.

**Pre-flight guard (concurrent-loop safety):** before invoking, verify `ralph-loop.local.md` (if present in project root) does NOT have `active: true`. The Step 4 loop terminated by emitting `IMPLEMENTATION_COMPLETE` — its state file should show `active: false`. If `active: true` is observed, ralph-loop did not exit cleanly; HALT and surface to human rather than spawning a concurrent loop on overlapping state (anti-pattern in `rules/loop-engine-convention.md § Anti-patterns`).

**Build the fix-mode driver file:**

1. Read `prompts/validation-fix-prompt.md` and substitute placeholders:
   - `{PLAN_SLUG}`, `{PLAN_PATH}`, `{IMPLEMENTATION_PATH}`
   - `{VALIDATION_REPORT_PATH}` — markdown report from Step 5
   - `{VALIDATION_REPORT_JSON_PATH}` — write the JSON output of Step 5 to `halt-loop-prompts/validate-{slug}-report.json` and reference this path (Step 5 captures stdout to this file before Step 5.5 runs)
   - `{MAX_ITERATIONS}` — default `5` (fix mode is refinement; not bounded by plan task count)
   - `{TIME_BUDGET}` — inherits the budget remaining from Step 4 (no separate budget)
   - Leave `{ITERATION}` for ralph-loop to substitute per iteration.
2. Write the substituted text to `halt-loop-prompts/validate-{plan-slug}.md` (gitignored).

**Invoke ralph-loop (shell-safe positional prompt + flags):**

- Positional prompt: `Read halt-loop-prompts/validate-{plan-slug}.md and follow its instructions for this validation-fix iteration.`
- `--completion-promise 'VALIDATION_GATE_PASSED'`
- `--max-iterations 5`

**Per-iteration contract** (enforced by the driver):

| Failing check class | Iteration objective |
|---|---|
| `npm test` | Identify failing test(s); fix production code OR (new edge case) write failing test FIRST then fix. Forbidden: skip/weaken the test. |
| `npm run typecheck` / `tsc --noEmit` | Resolve types narrowly. Forbidden: `any`, `@ts-ignore`. Multi-file drift → consult SEPA. |
| `npm run lint` | Fix violation; no `// eslint-disable` without inline rule-naming justification. |
| `coverage` | Add tests for uncovered branches (AAA, behavior-not-implementation). Forbidden: lowering threshold. |
| `wiring_triad` (pillar a/b/c with `fail > 0`) | Add functional caller / integration test / fix metric emission. Forbidden: no-op caller, hand-edited `.wiring-evidence.json`. |
| `code_quality` `FAIL_HARD` (`symbol_fabrication_*` / `dead_code_unallowlisted_*`) | Remove fabricated symbol / dead code OR allowlist with rationale per golden rule. Forbidden: ADR-defer these caps. |
| `code_quality` `INVALID` | HALT immediately — contract itself broken. Do NOT iterate inside this loop. |

**Terminal states (no other exit is valid):**

| Terminal state | Trigger | Skill action |
|---|---|---|
| `<promise>VALIDATION_GATE_PASSED</promise>` | Re-run of `run_validation.py {slug}` in current iteration exits 0 | Proceed to Step 6 |
| `<promise>VALIDATION_GATE_PASSED</promise>` with explicit BLOCKED report | `iterations_used >= 5` OR same check FAIL × 3 consecutive iterations OR `code_quality INVALID` OR unremediatable `FAIL_HARD` | Surface BLOCKED to user in Step 6; `/review` and `/release` MUST NOT run |
| Ralph-loop cancelled externally | User intervention OR fatal env failure | Re-invoke per same pre-flight guard once blocker resolved; NEVER drive fixes manually |

The driver enforces: TDD-first applies to new edge cases discovered during fix; commit discipline (`fix(validation): …` conventional format); CHANGELOG `[Unreleased]` updated when fix is consumer-visible; git-safety (no `--no-verify`, no `git checkout`/`revert`/`reset --hard`).

After the promise is emitted, re-run Step 5 ONCE to confirm the report on disk matches the promise (sanity check against a stale promise emission). If the post-promise validation still returns FAIL, the loop emitted a false promise → BLOCKED, escalate to human.

### Step 6 — Recommend next step

Surface the consolidated state from Step 4 (TDD halt-loop) + Step 5 (validation gate) + Step 5.5 (validation halt-loop, if it ran):

```
=== /implement complete ===
Plan: {slug}
Branch: {feature-branch}
TDD halt-loop (Step 4): IMPLEMENTATION_COMPLETE / BLOCKED
  Tasks committed:  N / total
  Tasks blocked:    M (see .progress-{slug}.json)

Validation gate (Step 5 + 5.5): VALIDATION_GATE_PASSED / BLOCKED
  Step 5 (single-shot): PASS / PARTIAL / FAIL
  Step 5.5 (fix-loop):  not-triggered / converged in K iter / BLOCKED at iter 5

Final validation verdict:    PASS / PARTIAL / FAIL
Final code-quality verdict:  PASS / PASS_WITH_CAVEATS / FAIL_SOFT / FAIL_HARD / INVALID

Wiring triad summary:
  (a) Static caller:    N/N symbols wired
  (b) Integration test: N/N symbols covered
  (c) Runtime metric:   N/N metrics observed non-zero

Next: /review {slug}   → 5-7 specialist agents in parallel, severity-classified findings
      then /release    → opens PR develop→main with proposed semver tag (human approves merge)
```

If EITHER halt-loop emitted a BLOCKED report, Step 6 surfaces BLOCKED at the top, recommends the human action required, and **explicitly states that `/review` and `/release` MUST NOT run** until the blocker is resolved.

## Halt-loop invariants

- The skill NEVER commits directly to `main` (Unbreakable Rule 4)
- The skill NEVER uses `git checkout`, `git revert`, `git push --force`, `git reset --hard` (Unbreakable Rule 4) — uses `git switch`, `git restore --staged`, `git stash` instead
- The skill NEVER skips `--no-verify` on pre-commit hooks (Unbreakable: fix the root cause, not bypass)
- The skill NEVER writes production code without a failing test first (TDD-first, Unbreakable Rule 5)
- The skill NEVER fabricates runtime-metric evidence — if `.wiring-evidence.json` is missing, the metric is unproven
- The skill NEVER edits `knowledge-base/plans/{slug}-plan.md` during execution — the plan is the contract; revisions go through `cycle-plan` again
- The skill NEVER scope-creeps mid-task — opportunistic improvements logged to `{slug}-followups.md`, NOT included in current commit
- **The skill NEVER drives implementation tasks manually outside of ralph-loop.** The halt-loop is the ONLY execution mode. If ralph-loop is cancelled mid-flight by a recoverable blocker, the skill re-invokes ralph-loop per § Step 4 "Resume after recovered blocker"; it does NOT continue task-by-task in the foreground session.
- **The skill NEVER asks the user for permission between phases while pending tasks remain.** Once `/implement` is invoked with a SHIPPABLE plan, the only valid stops are the terminal conditions in `cycle-implement.md § Stop conditions`. Pausing to ask "continue?" after every committed task violates the autonomy contract and defeats the halt-loop's purpose. The promise-markers `<promise>IMPLEMENTATION_COMPLETE</promise>` (Step 4) and `<promise>VALIDATION_GATE_PASSED</promise>` (Step 5.5) — OR an honest BLOCKED report — are the only legitimate ways to exit each loop.
- **The skill NEVER drives validation fixes manually after Step 5 returns FAIL.** Step 5.5 (validation halt-loop) is the only valid execution mode for fix-mode iteration. Bypassing Step 5.5 to "just patch quickly" reproduces the same anti-pattern the Step 4 loop exists to prevent.
- **The skill NEVER spawns concurrent ralph-loops on overlapping state.** Step 5.5's pre-flight guard verifies the Step 4 loop's `ralph-loop.local.md` is `active: false` before invocation. Concurrent loops on overlapping state is a documented anti-pattern (`rules/loop-engine-convention.md`).
- **The skill NEVER emits `VALIDATION_GATE_PASSED` without re-running `run_validation.py` in the same iteration.** The promise asserts a measurable fact (exit code 0); emitting it speculatively (without verification) is fabrication.

## When to give up honestly

Per `cycle-implement.md § Stop conditions`:

**Step 4 — TDD halt-loop:**

1. Task fails GREEN 3 times → BLOCKED, surface to human
2. Halt-loop max iterations reached → emit `IMPLEMENTATION_COMPLETE` with honest "tasks N through M remaining"
3. External dependency missing (DB/service down, library not installed) → halt; surface for human to fix environment
4. Plan task assumes behavior contradicted by reality (e.g., referenced pattern doesn't actually exist) → halt; loop back to `cycle-plan` for revision
5. Real-tree validation surfaces a HIGH/CRITICAL CVE on a declared dep (e.g., `pip-audit` / `npm audit` / `govulncheck` / `cargo audit` post-install) → halt; loop back to `cycle-plan` for ADR + dep bump; re-invoke per § Step 4 "Resume after recovered blocker" once the plan is corrected

**Step 5.5 — Validation halt-loop:**

6. Same check FAIL × 3 consecutive iterations with no observable progress (compare `stderr_tail` between iterations) → emit `VALIDATION_GATE_PASSED` with explicit BLOCKED report
7. `iterations_used >= 5` and at least one check still FAIL → emit `VALIDATION_GATE_PASSED` with explicit BLOCKED report
8. `code_quality` verdict `INVALID` (golden-rule missing or allowlist malformed) → HALT immediately; the contract itself is broken — do NOT iterate inside the fix-loop
9. `code_quality` `FAIL_HARD` with `symbol_fabrication_*` / `dead_code_unallowlisted_*` that genuinely cannot be remediated without scope-creeping the plan → emit `VALIDATION_GATE_PASSED` with BLOCKED report; recommend revising plan in `cycle-plan`

Honest BLOCKED > false completion (Unbreakable Rule 3). **"Run out of session context" is NOT a valid halt reason** — the halt-loop's purpose is to span context boundaries via the Stop hook + restart pattern. If the foreground session is exhausting context, the correct response is to let ralph-loop's Stop hook trigger a fresh iteration, NOT to pause and ask the user.

In all BLOCKED cases, `/review` and `/release` MUST NOT run until the human resolves the blocker.

## Related

- Cycle rule (SoT): [`cycle-implement.md`](../../rules/cycle-implement.md)
- Upstream cycle: [`cycle-plan.md`](../../rules/cycle-plan.md) — consumes its output
- Downstream cycle: [`cycle-review.md`](../../rules/cycle-review.md) — consumes this skill's output (when built)
- Templates: `templates/implementation-task-template.md`
- Prompts: `prompts/implementation-prompt.md` (Step 4 TDD halt-loop driver), `prompts/validation-fix-prompt.md` (Step 5.5 validation halt-loop driver)
- Scripts: `scripts/check_wiring.py`, `scripts/run_validation.py`
- Loop engine: `ralph-loop` plugin (must be enabled in `~/.claude/settings.json`)
- Project rules consumed: `architecture.md` (DIP, naming, hygiene), `testing.md` (TDD pyramid)
- Hooks enforced: `hooks/validate-command.sh` (git safety), `hooks/boundary-check.sh` (read-only `knowledge-base/references/` and `knowledge-base/tools/`). DIP is a convention enforced by code review per `rules/architecture.md § 4`, not by a hook.

## Anti-patterns specific to /implement

These are anti-patterns INSIDE the halt-loop that go beyond the cycle-level anti-patterns documented in `cycle-implement.md`:

1. **Marking a task `done` because "tests pass" without running wiring triad** — the triad is the difference between code-that-compiles and code-that-runs-in-the-system.
2. **Skipping REFACTOR phase to "save time"** — refactor is where SOLID/Clean Code violations are caught. Skipping it accumulates debt by the iteration.
3. **Writing tests AFTER code "just to verify"** — that's not TDD; that's regression testing. RED must precede GREEN.
4. **Inventing a Design Pattern not declared in the plan** — if the plan didn't specify Strategy here, don't introduce it mid-task. If a pattern is clearly missing, halt and revise plan.
5. **Wiring a new function with a forced caller** (e.g., adding a no-op call from main just to satisfy pillar (a)) — that's gaming the metric. The caller must be functionally necessary.
