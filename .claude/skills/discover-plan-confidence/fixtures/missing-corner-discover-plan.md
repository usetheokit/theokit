# Discovery Plan: Missing-Corner Negative Fixture

> **Version 1.0** — Negative fixture for `/discover-plan-confidence` tests. Identical shape to `good-discover-plan.md` EXCEPT the `tests` coverage corner has zero questions mapped AND no deferral marker. This MUST trigger the `empty_corner_tests` hard cap.

**Slug:** `missing-corner-fixture`
**Owner:** test-author
**Created:** 2026-05-22
**Time budget:** 4h

## Context

Negative path: structurally valid in every dimension except Coverage Corner 1. Used by `test_missing_corner_detected_in_matrix` and `test_questions_table_missing_corner_detected` to verify the checker fires `empty_corner_tests`.

## Objective

Cause `check_research_coverage` to report `corners_populated = 3` and `empty_corners = ["tests"]`.

## In-Scope / Out-of-Scope

### In-Scope

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/project-a/` | project-a-ts source | Project A-shape reference |
| `.claude/knowledge-base/references/project-b/` | services layer | Pgvector reference |
| `.claude/knowledge-base/references/project-c/` | prompts module | Procedural memory pattern |

### Out-of-Scope

| Project / Subdir | Why excluded |
|---|---|
| Anything not in `.claude/knowledge-base/references/` | Cross-Project Rule |

## ADRs

### D1 — Time budget

**Decision:** 4h total.

**Rationale:** Smaller than good fixture; negative-path doesn't need depth.

**Alternatives considered:** longer / shorter budgets.

**Consequences:** halt sooner if Fase A exhausted.

### D2 — Investigation depth

**Decision:** Glob + Read for all candidate files.

**Rationale:** Sufficient for the question shapes in this fixture.

**Alternatives considered:** ast-grep first, Read second.

**Consequences:** higher Read cost, lower planning cost.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | What pgvector versions does Project B support? | deps | `.claude/knowledge-base/references/project-b/` | SKIP — text-shape | Read pyproject.toml | Version range |
| Q2 | What is Project A's local-dev story? | tools | `.claude/knowledge-base/references/project-a/` | SKIP — text-shape | Read docker-compose + README | Steps + deps |
| Q3 | Project C procedural memory pattern | techniques | `.claude/knowledge-base/references/project-c/` | ast-grep classes in prompts/ | Read each class | Architecture description |
| Q4 | Compare add() across Project A and Project B | techniques | `.claude/knowledge-base/references/project-a/`, `.claude/knowledge-base/references/project-b/` | ast-grep both languages | Read both methods | Side-by-side table |
| Q5 | How does Project B document pgvector indexing strategy? | techniques | `.claude/knowledge-base/references/project-b/` | Glob docs/ | Read each doc | Index strategy summary |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | (none) | NOT covered — no questions, no deferral marker |
| Dependencies | Q1 | Covered |
| Tools | Q2 | Covered |
| Techniques | Q3, Q4, Q5 | Covered |

**Coverage: 3/4 corners covered (75%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before Qx | path exists | Mark BLOCKED |

## Acceptance Criteria

- [ ] Per-corner ≥ 1 question — INTENTIONALLY VIOLATED for `tests` corner

## Global Definition of Done

- [ ] N/A — this fixture is designed to FAIL the gate
