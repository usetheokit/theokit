# Discovery Plan: Under-Budget Negative Fixture

> **Version 1.0** — Negative fixture: only 4 Research Questions (below minimum of 5). All sections present, all citations real, all methods declared, 2 ADRs present. Triggers `question_budget_violated` (too few).

**Slug:** `under-budget-fixture`
**Owner:** test-author
**Created:** 2026-05-22
**Time budget:** 2h

## Context

Negative path: 4 Qs only, below the 5-10 budget. Used by `test_question_count_below_min_detected`.

## Objective

Cause `check_plan_completeness` to report `budget_violations` containing a "too_few" entry.

## In-Scope / Out-of-Scope

### In-Scope

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/project-a/` | top-level | Reference |

### Out-of-Scope

| Project / Subdir | Why excluded |
|---|---|
| Anything else | Cross-Project Rule |

## ADRs

### D1 — Time budget

**Decision:** 2h total.

**Rationale:** Minimal fixture.

**Alternatives considered:** more.

**Consequences:** halt sooner.

### D2 — Investigation depth

**Decision:** Read only.

**Rationale:** Minimal fixture.

**Alternatives considered:** ast-grep first.

**Consequences:** lower planning cost.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | Project A tests | tests | `.claude/knowledge-base/references/project-a/` | SKIP | Read | text |
| Q2 | Project A deps | deps | `.claude/knowledge-base/references/project-a/` | SKIP | Read | text |
| Q3 | Project A tools | tools | `.claude/knowledge-base/references/project-a/` | SKIP | Read | text |
| Q4 | Project A techniques | techniques | `.claude/knowledge-base/references/project-a/` | ast-grep | Read | text |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q1 | Covered |
| Dependencies | Q2 | Covered |
| Tools | Q3 | Covered |
| Techniques | Q4 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before Qx | path exists | Mark BLOCKED |

## Acceptance Criteria

- [ ] N/A — fixture designed to FAIL budget check

## Global Definition of Done

- [ ] N/A
