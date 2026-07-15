---
slug: ecosystem-integration-guarantee
generated_by: roadmap-feature
milestone_id: M48
date: 2026-07-14
status: completed
---

# Grill — ecosystem-integration-guarantee (M48)

## Q1 — What is this feature and why NOW?

**Answer:** Bring the `theokit ↔ @theokit/sdk` integration seam up to a drift-guaranteed, FAANG-grade
posture. **Why now:** the three ecosystem seams are unequally guarded — `theo-ui` has a cross-repo
contract test (consumer + producer) and TheoCloud has the `services.json` schema-drift guard (EC-7),
but the `@theokit/sdk` seam — the load-bearing one (the SDK is the *only* agent runtime) — has NONE:
~35 symbols consumed via structural types + a dynamic import, an un-tested local `CustomTool` mirror
(`define-agent-tool.ts:29`), an open `>=3.5.0` peer range, and no seam doc. Surfaced concretely today:
filing `theokit-sdk#119` (CustomTool ctx lacks `threadId` → stateful tools leak across sessions) showed
that when the SDK adds that field, theokit's local mirror silently drifts and nothing catches it.

## Q2 — Dependencies (which milestones must be [x] first)?

**Answer:** None blocking — all M0–M47 are `[x]`. Builds on the agent bridge/surface: M31 (builder-only
authoring), M33 (typed-ctx reconciliation), M46 (`thread` core), M47 (`@Expose`).

## Q3 — Verifiable Definition of Done (grill answers folded in)

1. Contract test **consumer + producer** (grill Q3 = theo-ui pattern, `prepublishOnly` gate).
2. Type-assignability gate on the local `CustomTool` mirror (`expectTypeOf().toMatchTypeOf()`).
3. Version gate: close `>=3.5.0` → `^3.5.0` (grill Q2) + fail-fast presence/semver check.
4. Seam manifest doc (`docs/architecture/theokit-sdk-integration.md`) + fix stale CLAUDE.md line.
5. Parity audit: confirm theo-ui contract test + TheoCloud EC-7 still hold (grill Q1 = SDK seam + parity audit).

## Q4 — Top 2 NEW risks

1. Producer-side gate vs blocked SDK CI — the producer contract test must run in `prepublishOnly` (local,
   pre-publish), not a remote workflow, because theokit-sdk's GH Actions is billing-blocked.
2. Closing the range to `^3.5.0` rejects an app that pinned a newer SDK major — intended guardrail;
   mitigated by documenting the conscious-bump procedure (SE36→3.x precedent).

## Grill decisions (AskUserQuestion)

- **Scope breadth:** SDK seam to FAANG parity + audit that theo-ui + TheoCloud seams stay guarded.
- **Version policy:** close `>=3.5.0` → `^3.5.0`.
- **Contract-test rigor:** consumer + producer (both repos, theo-ui pattern, `prepublishOnly` gate).

## Out-of-scope cross-check

No conflict. The roadmap's own out-of-scope #33 states "this initiative is about integration, not
replacement" — M48 *strengthens* theokit-as-consumer-of-the-SDK, reimplements nothing. No item removed.
