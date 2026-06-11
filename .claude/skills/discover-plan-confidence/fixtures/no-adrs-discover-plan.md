# Discovery Plan: No-ADRs Negative Fixture

> **Version 1.0** — Negative fixture: `## ADRs` section header present but EMPTY (no `### D1`, no `### D2`). Triggers `insufficient_adrs` cap (adr_count == 0, < 2 required).

**Slug:** `no-adrs-fixture`
**Owner:** test-author
**Created:** 2026-05-22
**Time budget:** 2h

## Context

Negative path: 5 Qs, all sections present, all citations real, all methods declared. Only the ADRs section is empty (no D1/D2 headers under it). Used by `test_adr_count_below_two_detected`.

## Objective

Cause `check_plan_completeness` to report `adr_count == 0`.

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

(intentionally left empty — no D1/D2 headers below; this fixture exercises the insufficient-ADRs cap)

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | tests q | tests | `.claude/knowledge-base/references/project-a/` | SKIP | Read | text |
| Q2 | deps q | deps | `.claude/knowledge-base/references/project-a/` | SKIP | Read | text |
| Q3 | tools q | tools | `.claude/knowledge-base/references/project-a/` | SKIP | Read | text |
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

- [ ] N/A — fixture designed to FAIL ADR check

## Global Definition of Done

- [ ] N/A
