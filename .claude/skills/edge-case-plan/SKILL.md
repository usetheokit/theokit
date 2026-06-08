---
name: edge-case-plan
description: Analyzes an implementation plan and identifies unforeseen edge cases. Pragmatic — flags real risks without complicating the design. Use after /to-plan or when reviewing any plan in knowledge-base/plans/.
user-invocable: true
allowed-tools: Read Glob Grep Bash
argument-hint: "[plan-slug|plan-file-path]"
---

# Edge Case Plan Review

Analyze the plan and identify edge cases that were NOT foreseen. Be pragmatic — flag real risks, not fantastical scenarios.

## Cycle contract

This skill is **phase 2** of [`cycle-plan`](../../rules/cycle-plan.md). The cycle rule is the source of truth for chain order, hard gates, anti-patterns at the cycle level, and rollback. **Read `cycle-plan.md` before invoking this skill.** This SKILL.md retains phase-specific detail (the pragmatic checklist for identifying edge cases, the MUST FIX / SHOULD TEST / DOCUMENT classification rubric, report format).

## Argument

- `$ARGUMENTS` = plan slug (resolved against `knowledge-base/plans/{slug}-plan.md`) or a full path
- No argument = analyze the most recent plan in `knowledge-base/plans/`

## Philosophy

**You are NOT the agent that complicates things.** You are the agent that asks: "what if this goes wrong?"

Golden rules:
1. **Only flag edge cases that can actually happen** — not scenarios with 0.001% probability
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

For each task, walk through this checklist. Mark ✅ if the plan already covers it, ❌ if not:

```
INPUTS:
  [ ] What happens with empty/null input?
  [ ] What happens with input at the maximum boundary?
  [ ] What happens with malformed input? (wrong type, bad encoding)

STATE:
  [ ] What happens if the operation fails midway? (crash recovery)
  [ ] Is the operation idempotent? (does running twice produce the same result?)

I/O:
  [ ] What happens if disk/network fails?
  [ ] What happens on timeout?

CONCURRENCY:
  [ ] Do two simultaneous calls cause problems?
  [ ] Is mid-operation cancellation safe?

INTEGRATION:
  [ ] Does the caller receive typed errors (not generic / not panics)?
  [ ] Is the dependency contract (DIP in `rules/architecture.md`, enforced by `hooks/boundary-check.sh`) respected?
  [ ] Is the public API surface explicit and versioned?
```

**Skip checks that do not apply.** Not every task has I/O. Not every task has concurrency. Mark only what is relevant.

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
Edge cases found: N (MUST FIX: N, SHOULD TEST: N, DOCUMENT: N)

## MUST FIX

### EC-{N}: {short description}
- **Affected task:** T{N}.{M}
- **Family:** Input / Boundary / Resource / Timing / State / Permission / Format
- **Scenario:** {how it happens}
- **Impact:** {what breaks}
- **Suggested fix:** {≤3 lines of code or ≤1 sentence}

## SHOULD TEST

### EC-{N}: {short description}
- **Affected task:** T{N}.{M}
- **Suggested test:** `test_{function}_{edge_description}` — {what to assert}

## DOCUMENT

### EC-{N}: {short description}
- **Accepted risk:** {why it is OK not to address now}

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | N | N | N | N |
| T1.2 | N | N | N | N |

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
