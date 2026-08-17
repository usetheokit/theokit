# Discovery Plan: Method-Missing Negative Fixture

> **Version 1.0** — Negative fixture: Q3 has empty Fase A cell AND Fase A is NOT the literal token `SKIP`. Triggers `method_missing` violation on Q3.

**Slug:** `method-missing-fixture`
**Owner:** test-author
**Created:** 2026-05-22
**Time budget:** 2h

## Context

Negative path: 5 Qs with all sections present and 2 ADRs, but Q3's Fase A column is empty (whitespace only, not SKIP). Used by `test_methodless_question_detected`.

## Objective

Cause `check_plan_completeness` to report `methodless_questions: ["Q3"]`.

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

**Decision:** 2h.

**Rationale:** minimal.

**Alternatives considered:** more.

**Consequences:** halt sooner.

### D2 — Investigation depth

**Decision:** Read only.

**Rationale:** minimal.

**Alternatives considered:** ast-grep.

**Consequences:** Read-heavy.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | tests q | tests | `.claude/knowledge-base/references/project-a/` | SKIP | Read | text |
| Q2 | deps q | deps | `.claude/knowledge-base/references/project-a/` | SKIP | Read | text |
| Q3 | tools q with empty Fase A | tools | `.claude/knowledge-base/references/project-a/` |  | Read | text |
| Q4 | tech q | techniques | `.claude/knowledge-base/references/project-a/` | ast-grep | Read | text |
| Q5 | tech q2 | techniques | `.claude/knowledge-base/references/project-a/` | ast-grep | Read | text |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q1 | Covered |
| Dependencies | Q2 | Covered |
| Tools | Q3 | Covered |
| Techniques | Q4, Q5 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before Qx | path exists | Mark BLOCKED |

## Acceptance Criteria

- [ ] N/A — fixture designed to FAIL method check

## Global Definition of Done

- [ ] N/A
