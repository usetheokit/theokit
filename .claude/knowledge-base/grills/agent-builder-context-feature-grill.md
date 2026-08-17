---
slug: agent-builder-context
generated_by: roadmap-feature
status: completed
date: 2026-07-06
adds_milestones: [M7, M8]
---

# Roadmap-feature grill — agent run-context + fluent builder

## Q1 — What is this feature and why NOW?

Agent + tool construction lacks two patterns the three reference agent-SDKs have and TheoKit does
not:

1. **Run-context / dependency injection for tools.** ai-sdk (`execute(input, { context })`,
   `tool-loop-agent.test-d.ts:292`), mastra (`execute(inputData, context)`, `tools/tool.ts:70`), and
   openai-agents-js (`RunContext<Context>`, `tool.ts`) all inject a shared run/agent-level context
   into every tool. TheoKit's `@theokit/sdk` `CustomTool.handler` is `(input) => string` — **no
   context arg** (`run-D22b53SU.d.ts:60`). Symptom, found dogfooding the `code-assistant` example:
   `projectRoot` is baked into every `@theokit/sdk-tools` factory
   (`createReadFileTool({ projectRoot })` × N) instead of being set once at the agent.
2. **A fluent builder with type-state.** The most loved TS DX (Zod, tRPC `t.procedure.input().query()`,
   Hono, Drizzle) accumulates type through the chain. TheoKit has `AgentRunner.builder()` but it is
   shallow (`reflection`/`stream`/`compaction`/`build` only) and only *runs*, not *defines*.

**Why now:** V1 (M0–M6) shipped and is hardened/published; this is the V2 DX/semantics layer for the
core product. The `code-assistant` dogfood surfaced the concrete pain (`projectRoot` repetition).

## Q2 — Dependencies

- **M7 (run-context)** depends on **M6** (V1 complete).
- **M8 (builder)** depends on **M7** — the builder's `.context()` is cosmetic without the SDK
  handler-context seam to deliver it to tools. Foundation before crown.

## Q3 — Structure (operator decision, AskUserQuestion 2026-07-06)

Two milestones, not one: **M7 = run-context/DI** (foundation, cross-repo with `@theokit/sdk`),
**M8 = fluent builder** (depends on M7). Rationale: each fits one manageable single-maintainer cycle
with its own release; a combined milestone crossing 2 repos + 4 packages risks never closing.

## Q4 — Top 2 new risks (per milestone; see ROADMAP blocks)

- Cross-repo dependency on `@theokit/sdk` (the handler-context seam is external) — version-floor +
  coordination risk (M6 `>=2.13.0` lesson).
- Type-gymnastics maintenance burden for a single maintainer (accumulative generics) — mitigated by
  minimal scope.

## SOTA delta (operator decision)

Clone **trpc/trpc** (MIT, verified via `gh api`) — the canonical fluent-builder-with-accumulative-
inference reference for M8's `/discover-plan`. Zod (node_modules) + Hono (already cloned) cover the
rest. ai-sdk / mastra / openai-agents-js (already cloned) cover the M7 context seams.
