---
type: holdout-entry
plan_path: knowledge-base/plans/EXAMPLE-plan.md
plan_slug: EXAMPLE
graded_by: reviewer-name
graded_at: 2026-MM-DD
plan_size_lines: 0
plan_size_words: 0
total_grading_time_minutes: 0
---

# Holdout Entry: {plan_slug}

> Copy this file, fill in each field, and save it under `.claude/knowledge-base/concepts/plan-confidence/holdout/{plan-slug}.md`.

## Dimension 1 — Factual completeness (weight 0.30)

**Score:** _0-100_

### Top 3 reasons for the score

1. ...
2. ...
3. ...

## Dimension 2 — Adherence to evidence (weight 0.30)

**Score:** _0-100_

### Top 3 reasons

1. ...
2. ...
3. ...

## Dimension 3 — LLM calibration (weight 0.20)

**Score:** _0-100_ — or `DEFERRED` if the dimension cannot be evaluated manually (e.g., M3+ has not run yet).

### Top 3 reasons

1. ...
2. ...
3. ...

## Dimension 4 — Technical risk (weight 0.20)

**Score:** _0-100_

### Top 3 reasons

1. ...
2. ...
3. ...

## Final Score (computed)

**Composite (SOTA original weights):** `= 0.30·D1 + 0.30·D2 + 0.20·D3 + 0.20·D4 = ___`

**Composite (M2 renormalized per ADR D8, dimensions = [completeness, structural_risk]):** `= 0.60·D1 + 0.40·D4 = ___`

## Hard Caps (manual check)

- [ ] Coverage Matrix 100% — if not → cap 49
- [ ] No fabricated citation (M3) — if any is fabricated → cap 49
- [ ] Every ADR has alternatives listed under Rationale — if not → cap 70
- [ ] Every bug-fix task has TDD RED-GREEN-REFACTOR — if not → cap 70

**Final after caps:** _compute_

## Outcome (filled in post-implementation)

- `cross_validation`: PENDING | PASS | PASS_WITH_CAVEATS | FAIL
- `dogfood`: PENDING | PASS | PASS_WITH_CAVEATS | FAIL | NOT_RUN
- `revisions_required`: 0
- `edge_cases_surfaced`: 0

## Notes

_Reviewer's free-form notes: surprises, context, doubts, etc._
