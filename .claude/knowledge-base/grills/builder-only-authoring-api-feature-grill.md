---
slug: builder-only-authoring-api
generated_by: roadmap-feature
milestone_id: M31
date: 2026-07-08
status: completed
---

# Grill — builder-only-authoring-api (M31)

## Q1 — What is this feature and why NOW?

**Answer (from the DX analysis + user decision this session):**
Make the **fluent builder the ONLY authoring surface across all 8 define-surfaces**
(agent · tool · route · action · websocket · middleware · config · plugin), and
**remove** every `define*` function + the `@theokit/agents` decorators
(`@Agent/@Tool/@Toolbox/@HumanInTheLoop/@Guardrails/@Skills/@Checkpoint/@MainLoop/@Mixin/@SubAgents`).

**Why now:** the DX audit against Mastra + Vercel AI SDK surfaced a "paradox of choice"
papercut — TheoKit ships **three** ways to author an agent (decorators, `defineAgent`,
`agent()` builder). Successful frameworks bless ONE. The user's decision (verbatim):
"o builder vai seguir o padrão builder EM TODAS AS FRENTES TODAS — se é para seguir um
padrão, esse vai ser o nosso padrão." Locked forks: **builder-only (remove define* +
decorators now — breaking major)** + **all 8 surfaces**.

**De-risking finding (inventory-grounded):** all 8 `define*` are identity functions; the
consumer reads the plain shape (`RouteConfig`, `ActionConfig`, `TheoConfig`, `CustomTool`,
`AgentDefinition`). So each `.build()` emits that exact shape → runtime/discovery untouched,
only the authoring surface changes. Proven already by `agent().build()` → `defineAgent`.

## Q2 — Dependencies (which milestones must be [x])

M8 (Fluent agent builder with type-state — the machinery this generalizes), M9 (Guardrails),
M13 (Skills runtime), M14 (HITL surface). All `[x]` → schedulable immediately.

## Q3 — Definition of Done

1. Fluent builder for all 8 surfaces; each `.build()` emits the exact branded/identity shape the
   runtime consumer already reads (route→RouteConfig, config→TheoConfig, tool→CustomTool,
   agent→AgentDefinition …) → runtime untouched. Agent builder gains `.guardrail(s)/.approval(s)/.skills`.
2. Every `define*` export + every `@theokit/agents` decorator REMOVED. `@theokit/http` `@Controller`
   stays intact (out-of-scope preserved).
3. Decorator-only features (`@Checkpoint/@MainLoop/@Toolbox/@Mixin/@SubAgents`) get a builder method
   OR are dropped via ADR — no silent capability loss.
4. Consumers migrated: theo-code-v2 (agent + 12 tools + 7 routes), create-theokit default template,
   fixtures (the tests). `examples/` (code-assistant + agent-saas) DELETED, not migrated.
5. Green gates (theokit + theo-code-v2 suites/typecheck/lint) + npm-strict dev smoke (web + health +
   agent stream + TUI) + CHANGELOG breaking-change + migration guide.

## Q4 — Top 2 NEW risks

1. Breaking blast radius (~110 call-sites) + fixtures-are-tests → bad migration = false green.
   Mitigation: identical branded shape (runtime untouched), surface-by-surface TDD, pilot `tool()` first.
2. Decorator-only feature homelessness + `config()` weak-fit. Mitigation: ADR (builder-method vs drop)
   + fix `config()` grammar (full builder vs `.set(partial)`) BEFORE coding.

## Out-of-scope cross-check (Step 3)

Keyword overlap detected with: **"Breaking the `@theokit/http` decorator path"** (keywords: decorator,
breaking). **Adjudication (human): FALSE POSITIVE** — the migration removes `@theokit/agents`
decorators + theokit-core `define*`; the `@theokit/http` `@Controller` path is NOT touched and stays
protected. `out_of_scope_overlap_false_positive: "Breaking the @theokit/http decorator path"`. No edit
to the out-of-scope section.

## examples/ decision (grill Q3)

Human confirmed: `theokit/examples/` (`code-assistant` + `agent-saas`) DELETED as part of M31 DoD
(removes the 7 hardest decorator sites). Not migrated.
