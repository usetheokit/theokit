# Implementation Halt-Loop Driver Prompt

You are mid-implementation, iteration {ITERATION}. The user invoked `/implement {PLAN_SLUG}` to drive a TDD halt-loop over the implementation plan.

**Plan:** `{PLAN_PATH}`
**Implementation working contract:** `{IMPLEMENTATION_PATH}`
**Progress file:** `.claude/knowledge-base/implementations/.progress-{PLAN_SLUG}.json` (gitignored)
**SEPA agent file:** `.claude/agents/implement-{PLAN_SLUG}-{DATE}/sepa.md` (Claude Code agent definition — frontmatter `name: implement-{PLAN_SLUG}-sepa`, body = role contract + verbatim plan/ADRs/edge-cases/audits/rules)
**SEPA paired knowledge skill:** `.claude/skills/implement-{PLAN_SLUG}-sepa-knowledge/SKILL.md` (Claude Code Skills-conformant; SEPA invokes via `Skill` tool for WebSearch refresh)
**SEPA per-iteration logs:** `.claude/knowledge-base/implementations/{PLAN_SLUG}/sepa-iterations/iteration-{N}-{phase}.md`

## SEPA invocation discipline (READ BEFORE Step 1)

Claude Code's agent registry is loaded at SESSION START — agent files written by `/implement` Step 2.5 mid-session may NOT be auto-discoverable by `subagent_type='implement-{PLAN_SLUG}-sepa'` until a fresh session starts. Two invocation paths are supported, in priority order:

1. **Primary (fresh session):** `Agent(subagent_type='implement-{PLAN_SLUG}-sepa', prompt=<iteration question>, description='SEPA iter {N} {phase}')`. The agent registry resolves `name:` from the SEPA file's frontmatter. Works only if the SEPA file was written BEFORE this session started.

2. **Fallback (mid-session):** `Agent(subagent_type='general-purpose', prompt='Read .claude/agents/implement-{PLAN_SLUG}-{DATE}/sepa.md for your full role contract + plan/ADR/edge-case context. <iteration-specific question with MODE=TIGHT or MODE=VERBOSE>', description='SEPA iter {N} {phase}')`. The general-purpose agent reads the SEPA file at invocation time, so timing-of-write doesn't matter.

If the Primary path returns "Agent type not found", silently switch to Fallback for the rest of the cycle. Both paths satisfy the SEPA-mandate of `cycle-implement.md` Step 2.5 — the SEPA agent file IS the source of truth either way.

## Your contract for this iteration

1. **Read the progress file.** Find the next task whose status is `pending` AND whose dependencies are `committed` or `done`.

2. **For the picked task, run the complete TDD cycle in order:**

### SEPA consultation 1/3 — Before RED

Before writing any test, invoke the SEPA via `Agent` tool:

- `description`: "SEPA pre-RED brief — task {T-ID}"
- `subagent_type`: `implement-{PLAN_SLUG}-sepa` (Primary) OR `general-purpose` (Fallback — pass SEPA file path in prompt)
- `prompt`: read `.claude/agents/implement-{PLAN_SLUG}-{DATE}/sepa.md` for the role brief, then advise on task {T-ID} — recap what the plan declares for this task; surface gotchas, ADR-link expectations, files-to-edit verification, and TDD shape concerns. Return ONLY the structured advice format from the brief.

The SEPA's response is markdown advice. Read it BEFORE writing the test. If SEPA flags `[CRITICAL]`, treat as HALT trigger unless you have explicit Unbreakable-Rule-1 (95% confidence) justification to proceed.

Append SEPA's response to `.claude/knowledge-base/implementations/{PLAN_SLUG}/sepa-iterations/iteration-{ITERATION}-pre-red.md` for audit trail (NOT `.claude/agents/` — that dir holds agent definitions only per Claude Code spec; logs go under knowledge-base/implementations/).

### RED phase (mandatory first)

- Read the plan's TDD section for this task
- Apply any non-critical SEPA suggestions from the pre-RED brief
- Write the failing test FIRST in the declared `.test.ts` file
- Run `npm test -- {test-file-path}` and CONFIRM it FAILS for the expected reason
- If the test passes BEFORE implementation, the test does not exercise the targeted behavior — HALT, revise the test
- Update progress file: task status → `red`, log iteration outcome

### GREEN phase

- Write the MINIMAL production code that makes the RED test pass
- Run `npm test -- {test-file-path}` and confirm PASS
- If still failing after a reasonable attempt, increment task retry counter (max 3 per task)
- After 3 GREEN failures, mark task BLOCKED with reason "implementation strategy not viable"
- Update progress file: task status → `green`, log iteration outcome

### SEPA consultation 2/3 — After GREEN / Before REFACTOR

Invoke the SEPA via `Agent` tool with the staged diff:

- `description`: "SEPA post-GREEN brief — task {T-ID}"
- `subagent_type`: `general-purpose`
- `prompt`: read `.claude/agents/implement-{PLAN_SLUG}-{DATE}/sepa-staff-engineer.md` for the role brief, then review the diff (captured via `git diff` against last commit). Spot SOLID/Clean Code/DRY violations, missed JSDoc cross-references, naming-convention drift, test-d completeness against ADR invariants.

Append response to `.claude/knowledge-base/implementations/{PLAN_SLUG}/sepa-iterations/iteration-{ITERATION}-post-green.md`.

### REFACTOR phase

Review the new code against quality rules from `SKILL.md § Quality rules` PLUS SEPA's post-GREEN findings:

- **SOLID:** SRP (one reason to change), OCP (composition over inheritance), LSP (subtypes substitute), ISP (role-shaped interfaces), DIP (`src/core/` ↛ `src/local|cloud/`)
- **Clean Code:** naming conventions, function size, no dead code, no `any`, no `console.log`
- **DRY:** rule of three for extraction; don't merge code that looks similar but represents different concepts
- **Design Patterns:** apply established patterns when the problem matches; don't invent
- **SEPA-flagged items:** address each `[MAJOR]` or `[MINOR]` finding (or document explicit justification to skip)

If any violation found, fix it. Tests stay green throughout. If tests break, revert REFACTOR changes and continue (refactor was wrong shape).

Update progress file: task status → `refactor`, log iteration outcome.

### WIRING phase (HARD GATE — the main rule)

Identify the new public symbols introduced by this task (functions, classes, types exported from the changed files). For each symbol, run:

```bash
python3 .claude/skills/implement/scripts/check_wiring.py \
  --symbol {symbol-name} \
  --project-root .
```

The script emits JSON with three pillars:

- **(a) Static caller** — must find ≥1 production caller (non-test file under `src/`)
- **(b) Integration test** — must find ≥1 file under `tests/integration/` referencing the symbol OR an explicit `<!-- ADR-DEFER-WIRING-B: reason -->` marker in the implementation task contract
- **(c) Runtime metric** — if the plan's task or Global DoD declared a metric (`metric:name`), `.wiring-evidence.json` must show `name: count > 0`. If no metric declared, this pillar is `n/a`.

**Failure handling:**

- Pillar (a) FAIL: do NOT commit. Add a caller in production code (the caller must be functionally necessary — never a no-op call gaming the metric). If no real caller justifies this symbol, the symbol is dead code; remove it.
- Pillar (b) FAIL: add an integration test that exercises the symbol via a real boundary scenario, OR add `<!-- ADR-DEFER-WIRING-B: <rationale> -->` with reason (prototype phase, third-party API not yet stable, etc.).
- Pillar (c) FAIL: run the integration test that should fire the metric; if it doesn't fire, the wiring is wrong (metric is declared but not exercised). Fix and re-check.

After triad passes, update progress file: task status → `wired`, log iteration outcome.

### COMMIT phase

**Model routing (teacher/student split — experimental):**

Before composing the commit message, check `.claude/rules/implement-model-routing.txt`. If a `commit:` entry exists (e.g., `commit: haiku ...`), delegate the commit-message composition to a nested `Agent` tool invocation with `model: <resolved>` and a phase-focused sub-prompt (stage facts + plan task ref + wiring summary as input; let the student model author only the one-line description + body). Main session retains the stage + commit execution (so git operations stay observable in the halt-loop transcript).

If the rule file is **missing** OR the `commit:` entry is **absent**, fall back to inline composition on the session model (status quo, no Agent nesting). See `.claude/rules/cycle-implement.md § Model routing` for the contract.

### SEPA consultation 3/3 — Before COMMIT

Stage the files first (`git add` with specific paths), then invoke the SEPA:

- `description`: "SEPA pre-COMMIT brief — task {T-ID}"
- `subagent_type`: `general-purpose`
- `prompt`: read `.claude/agents/implement-{PLAN_SLUG}-{DATE}/sepa-staff-engineer.md` for the role brief, then audit the staged diff (`git diff --cached`) + draft commit message against the task's DoD checkboxes from the plan. Verify: conventional-commit format, T-id reference, Wiring summary completeness, wiring triad sanity (pillar (a) callers are FUNCTIONAL not no-op stubs).

Append response to `.claude/knowledge-base/implementations/{PLAN_SLUG}/sepa-iterations/iteration-{ITERATION}-pre-commit.md`.

If SEPA flags `[CRITICAL]` on this consultation, do NOT commit. Unstage (`git restore --staged`), address the finding, re-invoke SEPA. Repeat up to 2 retries; on third [CRITICAL] mark task BLOCKED.

Standard commit instructions (apply whether routed or inline):

- Stage ONLY the files modified by this task (`git add` with specific file paths — NEVER `git add -A` or `git add .`)
- Commit with conventional-commit format:
  ```
  {type}({scope}): {one-line description}

  T{N.M}: {plan task reference}
  Wiring: a={pass/defer} b={pass/defer} c={pass/n/a}
  Closes: {issue-ref if applicable}
  ```
  Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- NEVER `git commit --no-verify` — if pre-commit hook fails, fix the underlying issue (Unbreakable Rule)
- Capture the commit SHA from `git rev-parse HEAD`

Update progress file: task status → `committed`, log SHA + iteration outcome.

### PROGRESS update

Append to `.claude/knowledge-base/implementations/.progress-{PLAN_SLUG}.json`:

```json
{
  "task_id": "T1.1",
  "status": "committed",
  "wiring": {"a": "pass", "b": "pass", "c": "n/a"},
  "commit_sha": "abc123...",
  "iterations_used": 7,
  "phases_completed": ["red", "green", "refactor", "wiring", "commit"]
}
```

## Re-evaluate halt conditions

After completing a task (or marking it BLOCKED), verify:

1. **Every task in the progress file has status `committed` OR `blocked` with reason.** Pending tasks remain → continue iterating.
2. **No task is `red`, `green`, `refactor`, or `wired` without `committed`.** A stuck mid-phase task → continue iterating to finish.
3. **All Acceptance Criteria checkboxes from the implementation task contract are TRUE.**

If ALL conditions hold, emit the promise marker AT THE VERY END of your response — **plain text, isolated on its own line, NO backticks, NO fenced code blocks, NO markdown wrapping**. Ralph-loop's regex matches the literal sequence `<promise>IMPLEMENTATION_COMPLETE</promise>` outside of inline code. Wrapping the marker in backticks (` `` `) or triple-fence code blocks BREAKS detection and forces another iteration.

Correct form (emit exactly this on its own line at end of response):

<promise>IMPLEMENTATION_COMPLETE</promise>

INCORRECT forms (will NOT terminate the loop):

- Wrapped in backticks: `<promise>IMPLEMENTATION_COMPLETE</promise>`
- Inside a fenced code block (triple backticks)
- Indented as part of a list item or quote
- Embedded mid-sentence

After emitting, you may follow with a one-paragraph summary, but the promise marker MUST be on its own isolated line before any trailing prose. Report: tasks completed / tasks blocked / iterations used / wiring triad summary / next step recommendation (run `scripts/run_validation.py`).

If conditions NOT met, do NOT emit the promise. STOP your current turn — the Stop hook will restart you in iteration {ITERATION + 1}.

## Inviolable rules (cycle-implement.md § Anti-patterns)

- NEVER write production code without a failing test first (TDD-first)
- NEVER mark a task `done` with red/skipped tests
- NEVER edit the implementation plan (`{PLAN_PATH}`) mid-iteration — the plan is the contract
- NEVER commit directly to `main` (verify `git branch --show-current` != `main` before each commit)
- NEVER use `git checkout`, `git revert`, `git push --force`, `git reset --hard` — use `git switch`, `git restore --staged`, `git stash`
- NEVER `--no-verify` to skip hooks
- NEVER scope-creep mid-task — opportunistic improvements go to followups, not current commit
- NEVER fabricate wiring evidence — if pillar (c) needs a metric that the system doesn't emit, mark BLOCKED, not faked

## When the loop should give up

If the same task fails GREEN 3 times in a row with no observable progress OR an external dependency is missing (DB/service down, library not installed) OR the plan declares behavior contradicted by reality OR real-tree validation surfaces a HIGH/CRITICAL CVE:

- Mark the affected task as `blocked` with an explicit reason in `.progress-{PLAN_SLUG}.json`
- HALT this iteration. Do NOT emit `<promise>IMPLEMENTATION_COMPLETE</promise>` — the implementation gate has NOT passed
- Write an explicit BLOCKED report listing the blocked tasks, the blocker reason for each, and the recommended human action (typically: loop back to `cycle-plan` for revision OR fix the environment OR address the CVE)
- Surface the BLOCKED report to the user

The completion promise `<promise>IMPLEMENTATION_COMPLETE</promise>` is emitted EXCLUSIVELY when every task is `committed` OR honestly `blocked` with reason AND every DoD checkbox is true. There is no graceful-exit path that emits the promise on a partial state. The downstream validation gate (`run_validation.py`) would catch incomplete work regardless, but the gate exists so the LLM does not stage a partial implementation as complete. Honest BLOCKED over false completion (Unbreakable Rule 3).
