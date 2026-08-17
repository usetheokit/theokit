# Discovery Plan: Good Fixture for Discover-Plan-Confidence Tests

> **Version 1.0** — Reference discovery plan used as the positive fixture in `/discover-plan-confidence` unit tests. All four coverage corners populated; all `.claude/knowledge-base/references/` citations resolve via `Path.exists()`; question budget 6 (within 5-10); each Q has a method.

**Slug:** `good-discover-plan-fixture`
**Owner:** test-author
**Created:** 2026-05-22
**Time budget:** 6h (Project A: 3h, Project B: 2h, Project C: 1h)

## Context

This fixture exists to drive the happy-path tests of every `discover-plan-confidence` checker. The shape mirrors a realistic discovery plan that would emerge from `/discover-plan` against the `.claude/knowledge-base/references/` clones, so the checker is exercised against production-shape input rather than synthetic noise.

## Objective

Validate that the four deterministic checkers (`check_research_coverage`, `check_reference_citations`, `check_plan_completeness`, `check_spec_smells`) all accept a structurally complete discovery plan and emit `verdict in {SHIPPABLE, SHIPPABLE_WITH_CAVEATS}` when invoked through `run_discover_plan_score.py`.

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated for every in-scope reference project
- [ ] `/discover-confidence` verdict on the future blueprint is at least SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/project-a/` | project-a-ts source | Project A-shape architecture is locked for v0.1 |
| `.claude/knowledge-base/references/project-b/` | services + orm layers | Pgvector schema reference |
| `.claude/knowledge-base/references/project-c/` | procedural memory module | v0.4 reference shape |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/project-a/` build artifacts | Generated outputs are not source of truth |
| Any project NOT cloned into `.claude/knowledge-base/references/` | Cross-Project Rule — never claim a feature without reading source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** Project A gets 3h, Project B 2h, Project C 1h.

**Rationale:** Project A is the deepest analog; Project B's pgvector layout is targeted; Project C is reference for v0.4 procedural memory.

**Alternatives considered:** equal split, single-project deep dive.

**Stop condition — per question (mandatory):** after 3 Fase A retries with different query variants, mark question BLOCKED with reason "Fase A exhausted".

**Anti-pattern:** Never fabricate Fase B answers to close a question whose Fase A was exhausted.

**Consequences:** the halt-loop stops iterating on a project when its budget is exhausted; remaining questions surface in the blueprint's `## Blocked questions` section.

### D2 — Investigation depth

**Decision:** Read each cited file end-to-end during Fase B.

**Rationale:** ast-grep hotspots in Fase A might be misleading without context; Read provides ground truth.

**Alternatives considered:** grep-only summary, fast skim.

**Consequences:** slower investigation per question, but lower fabrication risk.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does Project A test the LLM-extraction pipeline against Postgres? | tests | `.claude/knowledge-base/references/project-a/` | ast-grep run --pattern describe blocks --lang typescript | Read each test fixture + setup block | Table: test name → fixture used → assertion type |
| Q2 | What pgvector versions does Project B support? | deps | `.claude/knowledge-base/references/project-b/` | SKIP — text-shape; Glob pyproject.toml | Read each match in context | Version range + supported index types |
| Q3 | What is Project A's local-dev story? | tools | `.claude/knowledge-base/references/project-a/` | SKIP — text-shape; Glob docker-compose + Makefile | Read each file fully | Step-by-step instructions + dependency list |
| Q4 | Project C procedural memory: prompt rewriting or structured class? | techniques | `.claude/knowledge-base/references/project-c/` | ast-grep run --pattern class definitions --lang python .claude/knowledge-base/references/project-c/src/project-c/prompts/ | Read each candidate class | Architecture description + key citations |
| Q5 | Compare add() operation across Project A TS and Project B Python | techniques | `.claude/knowledge-base/references/project-a/`, `.claude/knowledge-base/references/project-b/` | ast-grep TS add() + ast-grep Python add() | Read both methods side-by-side | Side-by-side signature table |
| Q6 | How does Project B seed integration tests with pgvector data? | tests | `.claude/knowledge-base/references/project-b/` | ast-grep run --pattern pytest fixture --lang python | Read each fixture body | Setup pattern catalog |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q1, Q6 | Covered |
| Dependencies | Q2 | Covered |
| Tools | Q3 | Covered |
| Techniques | Q4, Q5 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | Cited `.claude/knowledge-base/references/` paths exist | Mark Qx BLOCKED |
| Per-question Fase A budget | Returns at least one hotspot OR 3 retries attempted | After 3 retries, mark Qx BLOCKED |
| After answering Qx | Blueprint section has at least one citation | Re-iterate Qx (1 retry max) |
| Per-project time budget | Project budget not exhausted | When exhausted, mark remaining Qx BLOCKED |
| Before promising complete | All 4 coverage corners have populated sections | Refuse promise, continue iterating |

## Acceptance Criteria

- [ ] All 6 questions answered with citations to `.claude/knowledge-base/references/`
- [ ] All 4 coverage corners populated in the blueprint
- [ ] Every citation points to a real `.claude/knowledge-base/references/{...}` path
- [ ] At least one ADR in the blueprint synthesizes decisions
- [ ] `/discover-confidence` verdict on the blueprint is SHIPPABLE_WITH_CAVEATS or higher

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → execute → confidence → improve if needed)
- [ ] Final `/discover-confidence` verdict recorded
- [ ] No fabricated citations
- [ ] Coverage Matrix 100% covered
- [ ] ADRs cite project rules (architecture.md, testing.md) or principles (SOLID/DRY/KISS/YAGNI)
