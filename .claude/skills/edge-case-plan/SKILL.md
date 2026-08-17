---
name: edge-case-plan
version: 0.1.0
requires: [to-plan]
description: Analyzes an implementation plan and identifies unforeseen edge cases. Pragmatic — flags real risks without complicating the design. Use after /to-plan or when reviewing any plan in knowledge-base/plans/.
user-invocable: true
allowed-tools: Read Glob Grep Bash
argument-hint: "[plan-slug|plan-file-path]"
---

# Edge Case Plan Review

Analyze the plan and identify the cases that were NOT foreseen, through **two lenses** (`rules/testing.md` § 4.1): **edge cases** (extremes of valid input — "does it hold at the boundary?") and **negative cases** (invalid input / failures — "does it fail-fast and recover with a typed error?"). Be pragmatic — flag real risks, not fantastical scenarios.

## Cycle contract

This skill is **phase 2** of [`cycle-plan`](../../rules/cycle-plan.md). The cycle rule is the source of truth for chain order, hard gates, anti-patterns at the cycle level, and rollback. **Read `cycle-plan.md` before invoking this skill.** This SKILL.md retains phase-specific detail (the pragmatic checklist for identifying edge cases, the MUST FIX / SHOULD TEST / DOCUMENT classification rubric, report format).

## Argument

- `$ARGUMENTS` = plan slug (resolved against `knowledge-base/plans/{slug}-plan.md`) or a full path
- No argument = analyze the most recent plan in `knowledge-base/plans/`

## Philosophy

**You are NOT the agent that complicates things.** You are the agent that asks: "what if this goes wrong?"

Golden rules:
0. **Cover both lenses** — for every input boundary, ask the EDGE question (largest/smallest valid) AND the NEGATIVE question (first invalid past it). Covering only one is half a review.
1. **Only flag cases that can actually happen** — not scenarios with 0.001% probability
2. **Never suggest adding layers of abstraction** — the fix for an edge case is an `if`, a test, or a `match` arm — never a new module
3. **KISS prevails** — if the fix for an edge case is more complex than the damage of the edge case itself, document the risk and move on
4. **Each flagged edge case MUST come with a suggested fix in ≤3 lines of code or ≤1 sentence of plan change**
5. **Corner cases (multiple edges combined) only if realistic** — "what if the disk fills up during a race condition under a full moon" is not realistic

## Process

### Step 1 — Read the Plan

```!
# Locate the plan
ls knowledge-base/plans/*${ARGUMENTS}* 2>/dev/null || ls -t knowledge-base/plans/*.md | head -5
```

Read the full plan. Understand:
- What is being built
- Which modules / files / packages will be touched
- The inputs and outputs of each task
- Where the system boundaries are (I/O, parsing, network, user input, external calls)

### Step 2 — Map the Boundaries

For each task in the plan, identify:
- **Inputs**: where does the data come from? (user/caller via public interface, webhook, event, another domain module)
- **Outputs**: where does it go? (external system, persistence, audit log, telemetry)
- **State**: what changes? (domain entities, persistence, external resources)

Edge cases live at boundaries. Internal code that processes already-validated data rarely has relevant edge cases.

### Step 3 — Apply the Pragmatic Checklist

Walk each task through **two distinct lenses** — see `rules/testing.md` § 4.1. Cover **both**; a plan reviewed for only one is half reviewed.

- **EDGE** = an extreme of a **valid** scenario. Question: *"does it hold at the boundary?"* Passing behavior: correct result at the extreme.
- **NEGATIVE** = an **invalid / wrong / unexpected** input or a failure. Question: *"does it fail-fast and recover gracefully?"* Passing behavior: a **typed error + clear message, no corruption** — this is where Error Handling (fail-fast, fail-clear, typed errors, validate at the boundary) is proven.

Mark ✅ if the plan already covers it, ❌ if not:

```
INPUTS:
  EDGE     [ ] Largest/smallest VALID value? (exactly min, exactly max, empty-but-valid, single element)
  NEGATIVE [ ] First INVALID value past the boundary? (null, wrong type, bad encoding, out of range, over max size)

STATE:
  EDGE     [ ] Idempotent? (does running twice at the limit produce the same result?)
  NEGATIVE [ ] What happens if the operation fails midway? (crash recovery, partial-write rollback)

I/O:
  EDGE     [ ] Largest valid payload / slowest acceptable response still handled?
  NEGATIVE [ ] Disk/network failure or timeout → typed error, not a hang or a silent swallow?

CONCURRENCY:
  EDGE     [ ] Do two simultaneous VALID calls at the limit interleave correctly?
  NEGATIVE [ ] Is mid-operation cancellation safe? (no corruption / partial state)

INTEGRATION:
  NEGATIVE [ ] Does the caller receive typed errors (not generic / not panics)?
  EDGE     [ ] Is the dependency contract (DIP in `rules/architecture.md`, enforced by `hooks/boundary-check.sh`) respected at its limits?
  EDGE     [ ] Is the public API surface explicit and versioned?
```

**Skip checks that do not apply.** Not every task has I/O. Not every task has concurrency. Mark only what is relevant — but for any input boundary, ask **both** the EDGE and the NEGATIVE question.

### Step 4 — Classify and Report

For each edge case found, classify:

| Level | Meaning | Action |
|---|---|---|
| **MUST FIX** | Will cause crash, data loss, or security hole | Add to the plan as a sub-task |
| **SHOULD TEST** | Unlikely but dangerous if it happens | Add a test to the existing task's TDD |
| **DOCUMENT** | Risk consciously accepted | Add as a note in the plan |
| **IGNORE** | Too theoretical or the fix is worse than the problem | Do not include in the report |

### Step 5 — Save the Report

Save the report at:

```
knowledge-base/reviews/{plan-slug}-edge-cases-{YYYY-MM-DD}.md
```

Create the `reviews/` directory if it does not yet exist. The report serves as the audit trail for `/plan-confidence` (which does NOT auto-cross-reference edge case reports in M2 — that is the M4 jury layer).

**Who absorbs the MUST FIX items into the plan:** this skill does NOT edit `{slug}-plan.md`. The human user (or a future cycle-plan wrapper) reads the report and revises the plan from v1.0 to v1.1, incorporating each MUST FIX as a sub-task or ADR. Then `/plan-confidence` is re-run to validate.

## Report Format

```markdown
# Edge Case Review — {plan}

Date: YYYY-MM-DD
Tasks analyzed: N
Cases found: N (EDGE: N, NEGATIVE: N | MUST FIX: N, SHOULD TEST: N, DOCUMENT: N)

## MUST FIX

### EC-{N}: {short description}
- **Affected task:** T{N}.{M}
- **Kind:** EDGE (extreme of valid) | NEGATIVE (invalid input / failure)
- **Family:** Input / Boundary / Resource / Timing / State / Permission / Format
- **Scenario:** {how it happens}
- **Impact:** {what breaks}
- **Suggested fix:** {≤3 lines of code or ≤1 sentence}

## SHOULD TEST

### EC-{N}: {short description}
- **Affected task:** T{N}.{M}
- **Kind:** EDGE | NEGATIVE
- **Suggested test:** `test_{function}_{case_description}` — {what to assert}
  - EDGE → assert the *correct result at the boundary*.
  - NEGATIVE → assert the *specific typed error + message* (not just "it throws").

## DOCUMENT

### EC-{N}: {short description}
- **Kind:** EDGE | NEGATIVE
- **Accepted risk:** {why it is OK not to address now}

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | N | N | N | N | N |
| T1.2 | N | N | N | N | N |

**Coverage check:** every task touching an input boundary should have at least one EDGE **and** one NEGATIVE case considered (or an explicit note why a lens does not apply).

**Verdict:** PLAN OK / PLAN NEEDS ADJUSTMENT
```

## Anti-Patterns You NEVER Commit

1. **Over-engineering** — "Let's create an ErrorRecoveryManager to handle this edge case" → NO. An `if input.is_empty() { return Err(...) }` solves it.

2. **Speculation** — "What if in the future someone changes this API and…" → NO. Analyze the plan AS IT IS, not as it could be.

3. **Paranoia** — "We need to validate input at EVERY layer" → NO. Validate at the boundary (system entry). Past the boundary, data is trusted.

4. **Scope creep** — "Since we are here, let's also handle…" → NO. Your job is to flag edges IN THE PLAN, not to add features.

5. **Disguised complexity** — "Let's add retry with exponential backoff + circuit breaker + fallback" → NO (unless the plan is ALREADY about resilience). A simple timeout solves 90% of cases.

## Integration

- Runs AFTER `/to-plan` or whenever someone asks for a review of a plan in `knowledge-base/plans/`
- This skill analyzes **plans before implementation** — for deep analysis of existing code, open a PR and use `/review` or `/security-review` (built-in)
- Part of the unbreakable chain documented in `/to-plan` SKILL.md: `/to-plan` → `/edge-case-plan` → `/plan-confidence` → (if needed) `/plan-improve` → `/plan-confidence` re-score
