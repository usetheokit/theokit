---
type: Milestone Run
title: Milestone M7: run-context dependency injection for tools
description: A shared typed run-context set at the agent and injected into every tool handler.
tags: [milestone, di, tools]
status: stable
generated: { by: theokit-agent/unrecorded, at: 2026-07-06T00:00:00Z }
migrated: { by: claude-opus-5/okf-skill, at: 2026-08-06T00:00:00Z, from: knowledge-base/roadmap-runs/M7-2026-07-06.md }
sources:
  - id: origin
    resource: knowledge-base/roadmap-runs/M7-2026-07-06.md
    title: Original document, absorbed into this bundle verbatim
    last_modified: 2026-07-06
# --- keys carried over from the source document ---
milestone_id: M7
slug: m7-run-context
date: 2026-07-06
record_status: completed
review: reviews/m8-fluent-builder-2026-07-06.md
release: releases/v1.0.0.md
checkbox_flipped_at: 2026-07-06T00:00:00Z
flip_commit_sha: (see chore(roadmap) commit on develop)
---

# Milestone M7 — Run-context / dependency injection for tools

## Objective (from)

Give agents and their tools a shared, typed **run-context** — set once at the agent (and overridable per-run) and injected into every tool handler — so tool config like `projectRoot` is declared in ONE place.

## Definition of done (from — delivered items)

- [x] `CustomTool.handler` extended to accept optional `ctx?: { signal?, context? }` (strictly additive, byte-compatible with existing 1-arg handlers)
- [x] `defineAgent({ context })` declares agent-level context; per-run override via `createSdkAgentStream(..., { runContext })` wins over agent-level
- [x] Context propagates to every tool handler through the bridge (theokit adapter layer, no SDK change required)
- [x] Verified end-to-end: agent-level + per-run override + no-regression; `defineAgentTool` ctx forwarding confirmed
- [x] Type-level: `defineAgentTool` / `contextualTool` type `ctx.context` for callers

Note: `@theokit/sdk-tools` factory migration (`createReadFileTool` etc.) and `examples/code-assistant` guide update deferred to post-V1 (original scope exceeded by SDK-side coordination). Core DI seam is complete and production-usable; the guide migration is a doc-only follow-up.

## Outcome

Run-context DI ships as part of v1.0.0. The adapter injects `context` at the theokit layer — not the SDK layer — so it works against the published SDK without a coordinated release. Per-run override (`runContext` in `RuntimeOverrides`) wins over agent-level context (no merge). Wiring triad complete: caller, integration tests, runtime metric (`THEO_AGENT_M7_RUN_CONTEXT`). Delivered jointly with M8 in PR #86.

# Related
* [m8-fluent-builder](/milestones/m8-fluent-builder.md) — the fluent-builder milestone.
* [m8-fluent-builder-2026-07-06](/reviews/m8-fluent-builder-2026-07-06.md) — the merge review covering both.
* [v1.0.0](/releases/v1.0.0.md) — the release that closed V1.

