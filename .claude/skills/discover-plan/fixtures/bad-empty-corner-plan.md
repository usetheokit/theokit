# Discovery Plan: Project B — Architectural Deep-Dive

> **FIXTURE — NEGATIVE EXAMPLE (subtler).** Plan looks competent at first glance (good questions, ADRs, methods) but violates the four-corner coverage rule by piling all questions on one corner without an ADR justifying deferral. Use to validate `/discover-edge-cases` catches structural violations even when surface quality looks fine.

**Version 1.0** — Investigate Project B's memory architecture in depth.

**Slug:** `project-b-architecture-deep-dive`
**Owner:** OurProject team
**Created:** 2026-05-21
**Time budget:** 4h (Project B-only)

## Context

`docs/agentic-memory-landscape.md § 4.2` describes Project B as MemGPT-shaped with 4 tiers. OurProject's v0.4 reflection design references "sleep-time agents" from Project B. We need a deeper understanding of the architecture.

## Objective

Produce a blueprint capturing Project B's full architectural shape: tier model, function-calling memory ops, sleep-time agents pattern.

## In-Scope / Out-of-Scope

### In-Scope

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/project-b/project-b/` | `agents/`, `agent.py`, `interfaces/`, `orm/`, `schemas/` | Architecture surface |

### Out-of-Scope

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/project-b/llm_api/` | Provider-specific, not architecture |
| `.claude/knowledge-base/references/project-b/sandbox/` | Tool execution, not memory |
| `.claude/knowledge-base/references/project-b/docs/`, `examples/` | Documentation, not source |
| `.claude/knowledge-base/references/project-a/`, `.claude/knowledge-base/references/project-c/` | Separate discoveries |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** 4h on Project B. Per-question Fase A: 3 retries before BLOCKED. Per-project: BLOCKED remaining when budget exhausted.

**Rationale:** Tight focus on architecture.

**Alternatives considered:** include comparison to MemGPT paper (rejected — paper is in `docs/agentic-memory-landscape.md` already).

**Consequences:** Investigation is deep, not broad.

### D2 — Read every agent class end-to-end

**Decision:** Each agent.py / agents/*.py read FULL, not skimmed.

**Rationale:** Agent classes declare architecture authoritatively.

**Alternatives considered:** sample only top 3 (rejected — risks missing important variant).

**Consequences:** Higher read budget, lower question count tolerable.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | How does Project B represent the agent state in code? | techniques | `.claude/knowledge-base/references/project-b/project-b/agent.py`, `agents/` | `ast-grep run --pattern 'class $NAME($BASE): $$$' --lang python .claude/knowledge-base/references/project-b/project-b/agents/` | Read each agent class | Class hierarchy + state fields |
| Q2 | How does Project B implement the 4 MemGPT tiers (core/buffer/recall/archival)? | techniques | `.claude/knowledge-base/references/project-b/project-b/schemas/`, `orm/` | `ast-grep run --pattern 'class $NAME($BASE): $$$' --lang python .claude/knowledge-base/references/project-b/project-b/schemas/` | Read schemas + corresponding ORM models | Tier-to-table mapping |
| Q3 | How does Project B wire memory function-calls to LLM tool execution? | techniques | `.claude/knowledge-base/references/project-b/project-b/agents/`, `project-b/interfaces/` | `ast-grep run --pattern 'def memory_$NAME($$$): $$$' --lang python .claude/knowledge-base/references/project-b/project-b/` | Read each memory function | Function catalog + tool-schema definitions |
| Q4 | Where is the sleep-time agent pattern implemented? | techniques | `.claude/knowledge-base/references/project-b/project-b/agents/` | `ast-grep run --pattern 'class Sleep$$$($$$): $$$' --lang python; OR Grep 'sleep_time'` | Read the matching file(s) | Scheduler design + transaction model |
| Q5 | How is the agent loop structured (turn taking, state machine)? | techniques | `.claude/knowledge-base/references/project-b/project-b/agent.py` | `ast-grep run --pattern 'def step($$$): $$$' --lang python .claude/knowledge-base/references/project-b/project-b/` | Read step / loop method | State machine diagram |
| Q6 | How does Project B serialize agent state for persistence? | techniques | `.claude/knowledge-base/references/project-b/project-b/orm/`, `project-b/schemas/agent.py` | `ast-grep run --pattern 'def to_dict($$$): $$$' --lang python .claude/knowledge-base/references/project-b/project-b/` | Read serialize/deserialize methods | Serialization shape |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | (none) | Not covered — NO ADR for deferral |
| Dependencies | (none) | Not covered — NO ADR for deferral |
| Tools | (none) | Not covered — NO ADR for deferral |
| Techniques | Q1, Q2, Q3, Q4, Q5, Q6 | Covered (6 questions) |

**Coverage: 1/4 corners covered (25%)**

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering any Q | `.claude/knowledge-base/references/project-b/project-b/agents/` exists | Mark BLOCKED |
| Per-question Fase A | At least 1 hotspot OR 3 retries | BLOCKED with reason "Fase A exhausted" |
| Per-project time budget | 4h not exhausted | Mark remaining BLOCKED |
| Before promising complete | All 4 coverage corners populated | Refuse promise |

## Acceptance Criteria

- [ ] Q1-Q6 status `done` or `blocked`
- [ ] All citations resolve
- [ ] `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS

## Global Definition of Done

- [ ] Chain complete
- [ ] No fabricated citations
- [ ] Coverage 4/4 — **BUT THIS PLAN VIOLATES THIS BY DESIGN (see audit below)**

---

## Why this fixture is BAD (auditor notes — not part of the plan itself)

`/discover-edge-cases` should flag the following:

| Anti-pattern | Where | Severity |
|---|---|---|
| **Empty corner without ADR-deferral** | Coverage Matrix — tests, deps, tools all empty; no ADR justifying skip | **MUST FIX (3 entries)** |
| **Question imbalance** | 6/6 questions in techniques — exceeds "max 3 per corner" rule | MUST FIX |
| **Question count high** | 6 questions, all techniques — close to the 10-question ceiling with no diversification | SHOULD TEST |
| **Halt-loop "all 4 coverage corners" assertion will fail unconditionally** | The plan declares the assertion but the plan itself violates it | MUST FIX |

The subtle bug: this plan has good ADRs (D1 with stop conditions, D2 justifying read depth), competent Research Questions (each maps to method + expected answer shape), and proper Halt-loop Checkpoints. It LOOKS thorough. But the Coverage Matrix is structurally broken (1/4 corners) and the plan does NOT include an ADR explaining why tests/deps/tools are deferred.

Expected `/discover-edge-cases` veredict: **DISCOVERY PLAN PRECISA DE AJUSTE** with 5+ MUST FIX entries.

If invoked despite the warnings, `/discover-execute` would produce a blueprint that `/discover-confidence` would mark INVALID (≤49) due to 3 `empty_corner_*` hard caps firing simultaneously.

### How to fix this fixture (would result in good plan)

1. Either add 1 question each to tests/deps/tools corners (preferred), OR
2. Add three ADRs (D3-tests-deferred, D4-deps-deferred, D5-tools-deferred) with rationale ("Project B tooling story covered in landscape doc; deps not load-bearing for this specific architecture question"). Even with deferred ADRs, `/discover-confidence` will still cap the resulting blueprint at SHIPPABLE_WITH_CAVEATS, not SHIPPABLE — explicit deferral acknowledges the limitation.
