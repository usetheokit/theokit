# Plan Template (Lite) — for small/focused tasks

> **Use this template when:** a task needs structure but doesn't merit the full
> 500+ LoC ceremony of `plan-template.md`. Typical use: single-file refactors,
> dependency bumps, doc-sync PRs, infra hook additions (~3-7 hours of work).
>
> **Do NOT use this template when:** the task introduces a new module under
> `src/`, touches DIP boundaries, or carries cross-cycle dependencies. Use
> the full `plan-template.md` for those.
>
> Lightweight contract:
> - SAME Goal SMART format (one sentence + one metric)
> - SAME ADR discipline (alternatives mandatory)
> - SAME Coverage Matrix (every requirement → at least one task)
> - **REDUCED** Dependency Graph (one paragraph instead of ASCII art)
> - **REDUCED** Followups (only what's blocking; defer the rest)
> - **OPTIONAL** Integration Validation phase (only if real test suite exists)

---

<plan-template-lite>

# Plan: {Title}

> **Version 1.0** — one paragraph: what + why + outcome metric.

## Goal

<!--
WHAT: One sentence, action-oriented, one named observable metric.
WHY:  This is the contract /plan-confidence, /implement, and /review cite.
       Vague verbs (improve, enhance, optimize) are FORBIDDEN.
EXAMPLE: "Enable `croner` to fire SleepTimeReflectionPolicy every 15 min so
         that scope-bound reflection runs without operator intervention,
         measured by `tests/integration/sleep-time-tick.test.ts` passing."
-->

> "Enable {who} to {capability} so that {observable outcome}, measured by {metric}."

## Context

<!--
WHAT: What exists today, what's broken/missing, what triggered this work.
WHY:  Anchors the plan in REAL evidence (logs, PRs, ADRs, benchmarks).
WHEN: Write this BEFORE the Objective. If you can't cite evidence, the
       work might be speculative — reconsider scope.
-->

What exists today: ...
What's missing/broken: ...
Evidence triggering this: ...

## Objective

<!--
WHAT: Sub-goals (checkboxes) that compose the Goal above.
WHY:  When ALL checkboxes tick AND the Goal's named metric is observed,
       the plan is DONE.
WHEN: If you have more than ~5 sub-goals, the Goal is too broad — split.
-->

- [ ] Sub-goal 1 — specific
- [ ] Sub-goal 2 — specific
- [ ] Sub-goal 3 — specific

## ADRs

<!--
WHAT: Architecture Decision Records. Each has ID + Decision + Rationale + Alternatives + Consequences.
WHY:  Alternatives column is MANDATORY per `plan-confidence-golden-rule.md`.
       "Picked X because it works" is NOT rationale; "Picked X over Y because Y requires Z infra we don't ship" IS.
WHEN: One ADR per LOAD-BEARING decision. If you have 0 ADRs, the plan
       likely has no decisions worth recording — review scope.
-->

### D1 — {decision}

**Decision:** What was decided.
**Rationale:** Why (cite project rules + evidence).
**Alternatives:** What was rejected and why.
**Consequences:** What this enables, what it constrains.

(repeat for each load-bearing decision)

## Dependency Graph (paragraph form)

<!--
WHAT: How phases depend on each other, in 1-3 sentences (NOT ASCII art).
WHY:  Light tasks rarely have rich parallel structure. If yours does,
       use the full plan-template.md with the ASCII diagram.
-->

Phases run sequentially: T0 → T1 → T2 → ... → TN. Final phase TN is integration validation.
[OR] T0 + T1 in parallel; T2 depends on both; T3 sequential after T2.

## Phase T0 — {title}

**Objective:** one sentence.

### T0.1 — {task title}

**Files:** `src/foo.ts` (NEW), `tests/foo.test.ts` (NEW)
**TDD:**
- RED: write `test_foo_returns_bar` asserting the contract; fail.
- GREEN: implement minimal `foo()` to pass.
- REFACTOR: extract helpers if file > 200 LoC.
**Acceptance:** test passes, lint passes, typecheck passes.
**DoD:** `npm test -- tests/foo.test.ts && npm run typecheck && npm run lint` exits 0.

(repeat T0.x for each task in phase)

## Phase T1 — {title}

(same shape as T0)

## Coverage Matrix

<!--
WHAT: Every original requirement maps to AT LEAST ONE task.
WHY:  Hard cap `coverage_lt_100` in `/plan-confidence` fires if any
       requirement is unmapped.
-->

| Requirement | Source | Task(s) |
|---|---|---|
| Requirement 1 | issue #N | T0.1 |
| Requirement 2 | ADR-XXX | T0.1 + T1.2 |

**Coverage: N/N = 100%.**

## Dependencies

<!--
WHAT: Existing/New/Removed packages per `deps-audit-golden-rule.md`.
WHY:  /deps-audit blocks INVALID_PLAN_DEPS if section missing.
-->

### Existing

| Package | Version | Used by |
|---|---|---|
| ... | ... | ... |

### New

| Package | Version | Why | Rule 9 evaluation |
|---|---|---|---|
| ... | ... | ... | ADOPT vs A (REJECT because X) vs B (DEFER because Y) |

### Removed

None [or list]

## Global Definition of Done

- [ ] All Phase Tx tasks complete with per-task DoD satisfied
- [ ] `npm test` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] No file in NEW directories exceeds 500 LoC (per `architecture.md § Module hygiene`)
- [ ] CHANGELOG.md entry under `[Unreleased]`
- [ ] Plan archived to `.claude/knowledge-base/plans/completed/{slug}-plan.md` post-merge

## Followups

| # | Item | Why deferred |
|---|---|---|
| F-1 | ... | ... |

## Related

- Cycle rule: `.claude/rules/cycle-plan.md`
- ... (cite other plans, ADRs, rules)

</plan-template-lite>
