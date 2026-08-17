# Discovery Plan: Project A / Project B / Project C — General Investigation

> **FIXTURE — NEGATIVE EXAMPLE.** Demonstrates anti-patterns `/discover-plan` is designed to prevent. Use this file to validate that `/discover-edge-cases` correctly identifies and flags the issues listed at the bottom.
>
> **Version 0.1** — Investigate stuff about the three memory projects we have.

**Slug:** `general-investigation`
**Owner:** OurProject team
**Created:** 2026-05-21
**Time budget:** TBD

## Context

We have .claude/knowledge-base/references/. We want to learn from it.

## Objective

Understand the projects better and decide what to do next.

## In-Scope / Out-of-Scope

### In-Scope

Everything in `.claude/knowledge-base/references/`.

### Out-of-Scope

Things that don't seem relevant.

## ADRs

(none — investigation is exploratory)

## Research Questions

| # | Question | Corner | Reference project(s) | Planned method | Expected answer shape |
|---|---|---|---|---|---|
| Q1 | Is Project A good? | techniques | Project A | Read it carefully | A judgment |
| Q2 | How does Project B work? | techniques | Project B | Look around | Explanation |
| Q3 | What can we learn from these projects? | techniques | All three | Use intuition | Insights |
| Q4 | Explain the architecture | techniques | All three | We'll figure it out | Architectural overview |
| Q5 | Are there any patterns? | techniques | All three | TBD | List of patterns |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | (none) | Not covered |
| Dependencies | (none) | Not covered |
| Tools | (none) | Not covered |
| Techniques | Q1, Q2, Q3, Q4, Q5 | Covered (5 questions) |

**Coverage: 1/4 corners covered (25%)**

## Halt-loop Checkpoints

(none)

## Acceptance Criteria

- [ ] Done when we feel done

## Global Definition of Done

- [ ] Read the projects
- [ ] Have some thoughts

---

## Why this fixture is BAD (auditor notes — not part of the plan itself)

`/discover-edge-cases` should flag, at minimum, the following:

| Anti-pattern | Where | Severity |
|---|---|---|
| **Unanswerable questions** | Q1 ("Is X good?") — judgment, not factual | MUST FIX |
| **Vague questions** | Q2, Q3, Q4 — no specific behavior to investigate | MUST FIX |
| **No method** | Q1-Q5 columns "Read it carefully", "TBD", "We'll figure it out" | MUST FIX |
| **No corner coverage** | Tests / Deps / Tools corners empty, no ADR-deferral | MUST FIX (Coverage Matrix < 100% → hard cap INVALID) |
| **Question imbalance** | 5/5 questions in techniques (max 3 per corner rule violated) | MUST FIX |
| **Missing time budget** | "TBD" | MUST FIX |
| **No ADRs** | "(none)" | MUST FIX (D1 mandatory per template) |
| **Vague out-of-scope** | "Things that don't seem relevant" — explicit rule violation | MUST FIX |
| **No acceptance criteria** | "Done when we feel done" — unverifiable | MUST FIX |
| **No halt-loop checkpoints** | section empty | MUST FIX |

Expected `/discover-edge-cases` veredict for this plan: **DISCOVERY PLAN PRECISA DE AJUSTE** with ≥ 8 MUST FIX entries.

If invoked despite the warnings, `/discover-execute` would produce a blueprint that `/discover-confidence` would mark INVALID (≤49) due to empty coverage corners and fabricated/missing citations.
