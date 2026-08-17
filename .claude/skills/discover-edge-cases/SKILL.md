---
name: discover-edge-cases
version: 0.1.0
requires: [discover-plan]
description: Analyzes a discovery plan and identifies unforeseen edge cases — focused on deep research over sources declared in the plan (local references under .claude/knowledge-base/references/ and/or allowlisted URLs). Pragmatic — flags real risks without complicating the plan. Use after /discover-plan or when reviewing any plan under .claude/knowledge-base/discoveries/plans/.
user-invocable: true
allowed-tools: Read Glob Grep Bash
argument-hint: "[plan-slug|plan-file-path]"
---

# Discover Edge Case Review

Analyze the discovery plan and identify edge cases that were NOT foreseen for the execution phase. Be pragmatic — flag real risks, not fantastical scenarios.

Sibling of `/edge-case-plan` — same philosophy, same output format, different scope: it investigates risks of the **discovery execution** (not of the code implementation).

## Cycle contract

This skill is **phase 2** of [`cycle-discover`](../../rules/cycle-discover.md). The cycle rule is the source of truth for chain order, hard gates, anti-patterns at the cycle level, and rollback. **Read `cycle-discover.md` before invoking this skill.** This SKILL.md retains phase-specific detail (the pragmatic checklist for identifying edge cases in discovery plans, the classification rubric, and the report format).

## Argument

The skill receives the slug or path via the user message (free text, not a native slash-command). It resolves as follows:

- Text contains a slug (`my-discovery`): `Glob` search under `.claude/knowledge-base/discoveries/plans/*my-discovery*.md`
- Text contains a `.md` path: use it directly
- No hint: read the most recent file under `.claude/knowledge-base/discoveries/plans/` by mtime

The `${ARGUMENTS}` placeholder in the bash block of Step 1 is substituted by the agent — it is not shell expansion. If the skill runs with no argument, use `ls -t ... | head -1`.

## Philosophy

**You are NOT the agent that complicates things.** You are the agent that asks: "what if this discovery goes wrong?"

Golden rules:
1. **Only flag edge cases that can actually happen during `/discover-execute`** — not theoretical scenarios
2. **Never suggest expanding the plan's scope** — the fix for an edge case is an extra question or a fallback method, not a new phase
3. **KISS prevails** — if the fix for an edge case requires rewriting the entire plan, document the risk and move on
4. **Each flagged edge case MUST come with a suggested fix in ≤1 method line or ≤1 sentence of plan change**
5. **Corner cases (multiple edges combined) only if realistic in the context of `.claude/knowledge-base/references/`** — forgetting that a version may be out of date is realistic; "what if Postgres changes its spec mid-read" is not

## Process

### Step 1 — Read the discovery plan

```!
# Locate the plan
ls .claude/knowledge-base/discoveries/plans/*${ARGUMENTS}* 2>/dev/null || ls -t .claude/knowledge-base/discoveries/plans/*.md | head -5
```

Read the full plan. Understand:

- Which reference projects are in scope (Project A, Project B, Project C)
- Which subdirectories will be touched in each
- Which research questions were declared
- The time budget per project
- Which ADRs justify deferral

### Step 2 — Map the boundaries of the investigation

For each research question in the plan, identify:

- **Investigator inputs**: what will be read? `Read`, `Grep`, `find`, `git log`? In which version of the clone?
- **Expected outputs**: what shape will the blueprint give the answer? Table? Snippet? Diagram?
- **Dependencies between questions**: does question 7 assume question 3 has already been answered? Does it break if the order flips?

Discovery edge cases live at the boundaries: version of the clones, circular dependency between questions, realistic time budget, fallback if the reference differs from what was expected.

### Step 3 — Apply the pragmatic checklist

For each research question, walk through this checklist. Mark ✅ if the plan covers it, ❌ if not:

```
REFERENCES:
  [ ] Does the path in .claude/knowledge-base/references/ actually exist?
  [ ] Is the clone version (--depth 1, date) mentioned when relevant?
  [ ] Does the subdirectory contain the expected content? (Project A switched from Python to TS — the file may have moved)

METHOD:
  [ ] Is the method (Read / Grep / find) appropriate for the target size?
  [ ] Is there a fallback if the file does not exist? (e.g. "if project-a-ts is missing, fall back to project-a-python")
  [ ] Does the time budget cover this question?

INTERPRETATION:
  [ ] Does the question have a deterministic answer, OR does it require interpretation? (LSP-style "is this a wrapper?" requires judgment)
  [ ] Does the blueprint know how to format this answer? (does the template have the right section?)

DEPENDENCIES:
  [ ] Does this question depend on another being answered first?
  [ ] If so, does the plan list the order explicitly?

SCOPE:
  [ ] Is there a risk of scope creep during the halt-loop? (e.g. "see how Project A does dedup" becomes "see how Project A does dedup, embeddings, indexing, …")
  [ ] Is there a clear stop criterion?

COVERAGE:
  [ ] Are all 4 corners (tests/deps/tools/techniques) mapped?
  [ ] If a corner was deferred, is there an ADR justifying it?

CITATIONS:
  [ ] Is every path mentioned under Evidence verifiable (does Read work)?
  [ ] Does the plan cite concrete examples or just placeholders ("see file X")?
```

**Skip checks that do not apply.** Some questions have no dependencies. Some need no fallback. Mark only what is relevant.

### Step 4 — Classify and report

For each edge case found, classify:

| Level | Meaning | Action |
|---|---|---|
| **MUST FIX** | Will break `/discover-execute` or produce an invalid blueprint | Edit the discovery plan and incorporate it |
| **SHOULD TEST** | Unlikely but dangerous — add a checkpoint in the halt-loop | Add a note in the plan under "Halt-loop checkpoints" |
| **DOCUMENT** | Risk consciously accepted | Add as an ADR in the plan |
| **IGNORE** | Too theoretical or the fix is worse than the problem | Do not include in the report |

### Step 5 — Save the report

Save the report at:

```
.claude/knowledge-base/reviews/{discovery-plan-slug}-edge-cases-{YYYY-MM-DD}.md
```

Create the `reviews/` directory if it does not yet exist. The report serves as the audit trail before `/discover-execute` runs.

**Who absorbs the MUST FIX items into the discovery plan:** this skill does NOT edit `{slug}-plan.md`. The human user reads the report and bumps the plan from v1.0 to v1.1, incorporating each MUST FIX (typically: refining research questions, adding methods, fixing reference paths). Then `/discover-execute` is invoked on the revised plan.

## Report Format

```markdown
# Discover Edge Case Review — {plan}

Date: YYYY-MM-DD
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/{slug}-plan.md
Research questions analyzed: N
Edge cases found: N (MUST FIX: N, SHOULD TEST: N, DOCUMENT: N)

## MUST FIX

### EC-{N}: {short description}
- **Affected question:** Q{N}
- **Family:** Reference path / Method / Interpretation / Dependency / Scope / Coverage / Citation
- **Scenario:** {how it happens during /discover-execute}
- **Impact:** {what breaks in the blueprint}
- **Suggested fix:** {≤1 sentence of plan change}

## SHOULD TEST

### EC-{N}: {short description}
- **Affected question:** Q{N}
- **Suggested halt-loop checkpoint:** {assertion to add — e.g. "before iterating to the next question, validate that path X exists"}

## DOCUMENT

### EC-{N}: {short description}
- **Accepted risk:** {why it is OK not to address now — ADR-style rationale}

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | N | N | N | N |
| Q2 | N | N | N | N |

**Verdict:** DISCOVERY PLAN OK / DISCOVERY PLAN NEEDS ADJUSTMENT
```

## Anti-Patterns You NEVER Commit

1. **Suggesting a new reference project** — "What if we also look at Zep?" → NO. The plan has already declared scope. An edge case lives inside what was planned, not outside.

2. **Speculating about future versions** — "What if Project A changes the API in the next release?" → NO. Analyze the plan against the clone that EXISTS under `.claude/knowledge-base/references/`.

3. **Citation paranoia** — "We need to verify every word in every file" → NO. Trust the plan; only flag claims that are verifiable and wrong.

4. **Scope creep** — "Since we're here, let's also investigate…" → NO. Your job is to flag edges, not add questions.

5. **Disguised complexity** — "Let's add retry + fallback + caching in the halt-loop" → NO. A single clear method + stop criterion solves 90% of cases.

## Integration

- Runs AFTER `/discover-plan` or whenever someone asks for a review of a discovery plan
- This skill analyzes **discovery plans before execution**; for analysis of the produced blueprint, use `/discover-confidence`
- Part of the unbreakable chain documented in `/discover-plan` SKILL.md
