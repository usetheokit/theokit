---
type: Milestone Run
title: Milestone M8: fluent agent builder with type-state
description: A composable agent builder that accumulates type-state so an unsatisfied requirement fails at compile time.
tags: [milestone, builder, types]
status: stable
generated: { by: theokit-agent/unrecorded, at: 2026-07-06T00:00:00Z }
migrated: { by: claude-opus-5/okf-skill, at: 2026-08-06T00:00:00Z, from: knowledge-base/roadmap-runs/M8-2026-07-06.md }
sources:
  - id: origin
    resource: knowledge-base/roadmap-runs/M8-2026-07-06.md
    title: Original document in the pre-wiki tree, preserved verbatim
    last_modified: 2026-07-06
# --- keys carried over from the source document ---
milestone_id: M8
slug: m8-fluent-builder
date: 2026-07-06
record_status: completed
review: reviews/m8-fluent-builder-2026-07-06.md
release: releases/v1.0.0.md
checkbox_flipped_at: 2026-07-06T00:00:00Z
flip_commit_sha: (see chore(roadmap) commit on develop)
---

# Milestone M8 — Fluent agent builder with type-state

## Objective (from)

A composable `agent()` builder — `agent().context(...).tool(...).model(...).build()` — that accumulates **type-state** the way the most-loved TS DX does: a tool whose required context isn't provided is a compile error, tool names accumulate into a union, and `.build()` only type-checks when the agent is complete. Resolves to the SAME branded `AgentDefinition` that `defineAgent` produces.

## Definition of done (from — delivered items)

- [x] `agent()` builder with `.context<C>()`, `.tool(t)`, `.model()`, `.system()`, `.use(preset)`, `.build()` — typed with accumulative generics
- [x] Type-state: `.build()` callable only when required fields (model) present — "forgot the model" is a compile error, proven by `@ts-expect-error` + `expectTypeOf` tests
- [x] Tool-name union accumulates through the chain (`InferAgentToolNames`)
- [x] `.build()` returns the same branded `AgentDefinition`; convergence test proves builder ≡ `defineAgent` ≡ `@Agent` at runtime
- [x] `InferAgentInput<>` type helper for extracting input types from `AgentDefinition`

Note: `examples/code-assistant` builder-form example and `.theokit/agents.d.ts` tool-parts end-to-end deferred to post-V1 doc sprint. Core builder API and type-state are complete.

## Outcome

Fluent builder ships as part of v1.0.0. Three construction surfaces (decorators + `defineAgent` + `agent()` builder) all resolve to one `AgentDefinition`. G6 extraction applied (`streamSdkAgent` pulled out of outer generator). Wiring triad complete: caller, integration tests, runtime metric (`THEO_AGENT_M8_OPTIONS`). Delivered jointly with M7 in PR #86.

# Related
* [m7-run-context](/milestones/m7-run-context.md) — the run-context milestone.
* [m8-fluent-builder-2026-07-06](/reviews/m8-fluent-builder-2026-07-06.md) — the merge review covering both.
* [v1.0.0](/releases/v1.0.0.md) — the release that closed V1.

