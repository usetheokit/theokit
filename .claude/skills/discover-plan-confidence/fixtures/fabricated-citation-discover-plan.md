# Discovery Plan: Fabricated-Citation Negative Fixture

> **Version 1.0** — Negative fixture for `/discover-plan-confidence`. Contains exactly 2 citations: one verified (`.claude/knowledge-base/references/project-a/README.md` exists) and one fabricated (`.claude/knowledge-base/references/project-a/this-path-does-not-exist-2026.md` does NOT exist). MUST trigger `fabricated_citation` hard cap.

**Slug:** `fabricated-citation-fixture`
**Owner:** test-author
**Created:** 2026-05-22
**Time budget:** 2h

## Context

Negative path: structurally valid except for ONE fabricated `.claude/knowledge-base/references/` path in the Research Questions table. Used by `test_fabricated_citation_detected` to verify the checker fires `fabricated_citation` and reports the offending path.

The fixture also contains a SECOND fake citation in Q3, followed by an HTML comment marker that flags it as intentionally documented. The blocked-marker recognizer in `check_reference_citations` excludes such paths from the fabricated count, so the test verifies that an explicitly-documented gap does NOT trigger the cap.

## Objective

Cause `check_reference_citations` to report `fabricated >= 1` and include the fake path in `fabricated_paths`.

## In-Scope / Out-of-Scope

### In-Scope

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/project-a/README.md` | top-level README (real, verified) | Reference for fabrication test |

### Out-of-Scope

| Project / Subdir | Why excluded |
|---|---|
| Anything not in `.claude/knowledge-base/references/` | Cross-Project Rule |

## ADRs

### D1 — Time budget

**Decision:** 2h total.

**Rationale:** Minimal negative-path fixture; depth not needed.

**Alternatives considered:** larger budget.

**Consequences:** halt sooner on Fase A exhaustion.

### D2 — Investigation depth

**Decision:** Glob + Read only.

**Rationale:** Sufficient for the fabrication test.

**Alternatives considered:** ast-grep first.

**Consequences:** Read-heavy.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A | Fase B | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | What does Project A README say? | tests | `.claude/knowledge-base/references/project-a/README.md` | SKIP | Read README | summary |
| Q2 | What does this nonexistent path contain? | deps | `.claude/knowledge-base/references/project-a/this-path-does-not-exist-2026.md` | SKIP | Read fake path | (will fail) |
| Q3 | What does Project B document about deferred topic X? | tools | `.claude/knowledge-base/references/project-b/intentionally-missing-2026.md` <!-- BLOCKED: removed --> | SKIP | Read | (blocked) |
| Q4 | Project C prompts module structure | techniques | `.claude/knowledge-base/references/project-c/src/project-c/prompts/` | ast-grep | Read each file | architecture map |
| Q5 | Project A quickstart steps | techniques | `.claude/knowledge-base/references/project-a/README.md` | SKIP | Read README | step-by-step |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q1 | Covered |
| Dependencies | Q2 | Covered (but Q2's path is fabricated — triggers cap) |
| Tools | Q3 | Covered (Q3's path is blocked-marked, not fabricated) |
| Techniques | Q4, Q5 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before Qx | path exists | Mark BLOCKED |

## Acceptance Criteria

- [ ] Q2 path verified — INTENTIONALLY FAILS (fabricated_citation expected)

## Global Definition of Done

- [ ] N/A — fixture designed to FAIL the citation check
