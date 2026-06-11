# Plan: Devtools Viewer Extensions — Route Schema Inspector + Agent Live Stream

> **Version 1.1** (2026-06-11) — Absorbed EC-1 (route manifest lacks schema — T1.1
> scoped to "View API Docs" link only; inline schema deferred). EC-2 documented
> (stream flood handled by appendCapped).
>
> **Version 1.0** (2026-06-11) — Extend TheoKit devtools with: (1) RoutesTab "View API Docs" link, (2) AgentsTab live stream monitor via new HMR channel. ~90 LoC total. Based on blueprint `devtools-viewer-blueprint.md`.

## Goal

> Extend the TheoKit devtools RoutesTab with inline Zod schema display and AgentsTab with real-time agent stream events, measured by clicking a route in devtools showing its schema JSON AND agent stream events appearing in the AgentsTab "Live" view during an active agent conversation.

## Context

Blueprint `discoveries/blueprints/devtools-viewer-blueprint.md` (2026-06-11) investigated how to extend the existing 36-file devtools overlay. Key findings:

- RoutesTab reads `state.routeManifest` — already has route data, just needs schema display
- AgentsTab uses HMR dispatcher queue — needs new `CHANNEL_AGENT_STREAM` (same pattern as 5 existing channels)
- Scalar embed rejected (ADR-1) — link to `/api/docs` instead
- Separate WebSocket rejected (ADR-2) — HMR bridge handles it

## Baseline Context

### Files that will be touched

| File | LoC | Last commit | Why it exists | Invariants |
|---|---|---|---|---|
| `packages/theo/src/devtools/components/Tabs/RoutesTab.tsx` | 84 | `c814585` (2026-05-20) | Routes file tree | `useDevtoolsContext()` state shape |
| `packages/theo/src/devtools/components/Tabs/AgentsTab.tsx` | 126 | `07a33a3` (2026-06-01) | Agent run summary table | `state.agentRuns` array |
| `packages/theo/src/devtools/bridge/hmr-bridge.ts` | 130 | `be2d961` (2026-06-06) | 5 HMR channels | Channel constants + `hot.on()` pattern |
| `packages/theo/src/devtools/bridge/dispatcher.ts` | 114 | `be2d961` (2026-06-06) | Pre-mount queue + dispatch | `queuable()` wrapper pattern |
| `packages/theo/src/devtools/state/reducer.ts` | 91 | `be2d961` (2026-06-06) | State reducer | Action types + state shape |

### Architecture boundaries

All changes within `devtools/` module (dev-only kind per `architecture.md` v3). No cross-module boundary changes.

## Prior Art & Related Work

- **Internal blueprint:** `discoveries/blueprints/devtools-viewer-blueprint.md` — 6 questions answered with file:line citations
- **Internal reference:** `knowledge-base/reference/devtools.md` — 1163-line deep dive (TanStack/Next.js/Astro)

## Objective

- [ ] RoutesTab: click route → show Zod schema as JSON (reuse JSONExplorer)
- [ ] RoutesTab: "View API Docs" button → opens `/__theo/openapi/docs`
- [ ] AgentsTab: new `CHANNEL_AGENT_STREAM` HMR channel
- [ ] AgentsTab: "Live" sub-view showing stream events in real-time
- [ ] Build succeeds

## ADRs

### D1 — Link to Scalar (not embed in Shadow DOM)

**Decision:** RoutesTab adds a "View API Docs" link to `/__theo/openapi/docs`. Don't embed Scalar inside devtools.

**Rationale:** Per blueprint ADR-1 — Scalar is ~2MB, CSS doesn't scope to Shadow DOM, core already serves standalone endpoint. 1 line vs 100+ lines. KISS.

**Alternatives:** Embed via `<iframe>` — rejected: fragile, doubles memory.

### D2 — Agent events via HMR channel (not WebSocket)

**Decision:** Add `CHANNEL_AGENT_STREAM` to existing HMR bridge. Don't create a separate WebSocket.

**Rationale:** Per blueprint ADR-2 — 5 channels already work with pre-mount queue, error wrapping, manifest sync. Adding a 6th is 3+3 lines. YAGNI on separate WebSocket.

**Alternatives:** `new WebSocket()` for agent events — rejected: duplicates bridge infra.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Agent stream events may be high volume (many text_deltas per second) | Medium | Throttle display to 10 events/sec via requestAnimationFrame batching | Dev |
| JSONExplorer may not handle large Zod schemas gracefully | Low | Collapse by default; max-height with scroll | Dev |

## Unresolved Questions

(none — blueprint resolved all questions with file:line citations)

## Dependency Graph

```
Phase 1 (RoutesTab) ──┐
                       ├──▶ Phase 3 (Integration)
Phase 2 (AgentsTab) ──┘
```

Phases 1 and 2 parallelize (different files).

---

## Phase 1: RoutesTab Schema Viewer

### T1.1 — Add inline schema view + API docs link

#### Objective
When a route is clicked in RoutesTab, show its Zod schema as JSON below the route row. Add "API Docs" button.

#### Why this step
**Action:** Import `JSONExplorer` component (already exists at `devtools/components/JSONExplorer.tsx`). On route click, toggle a collapsible section showing `route.schema` via JSONExplorer. Add anchor to `/__theo/openapi/docs`.

**Reasoning:** Per D1, linking is simpler than embedding. JSONExplorer is battle-tested (used in RequestsTab). The route manifest already carries schema metadata from `server/scan/`.

#### Files to edit
```
packages/theo/src/devtools/components/Tabs/RoutesTab.tsx — add schema toggle + API docs link
```

#### TDD
```
RED:   test_routes_tab_has_api_docs_link() — RoutesTab renders anchor with href containing /openapi/docs
GREEN: Add link to RoutesTab
VERIFY: turbo run build --filter=theokit
```

#### Concurrency tests
(none — single-threaded React component)

#### Acceptance Criteria
- [ ] "View API Docs" link visible in RoutesTab
- [ ] Click route → JSON schema displayed
- [ ] RoutesTab ≤ 120 LoC

---

## Phase 2: AgentsTab Live Stream Monitor

### T2.1 — Add CHANNEL_AGENT_STREAM to HMR bridge + dispatcher

#### Objective
Add the 6th HMR channel for agent stream events. Wire through bridge → dispatcher → reducer → AgentsTab.

#### Why this step
**Action:** Follow the exact pattern of the 5 existing channels (blueprint Q6). Add constant, add `hot.on()`, add `onAgentStreamEvent` dispatcher, add `AGENT_STREAM_EVENT` reducer action, extend AgentsTab with "Live" toggle.

**Reasoning:** Per D2, HMR channel is the established transport. The `queuable()` wrapper handles pre-mount queue automatically. Error wrapping (EC-25) is built-in.

#### Files to edit
```
packages/theo/src/devtools/bridge/hmr-bridge.ts — add CHANNEL_AGENT_STREAM + hot.on()
packages/theo/src/devtools/bridge/dispatcher.ts — add onAgentStreamEvent
packages/theo/src/devtools/state/reducer.ts — add AGENT_STREAM_EVENT action + agentStreamEvents state
packages/theo/src/devtools/components/Tabs/AgentsTab.tsx — add "Live" toggle + stream event list
```

#### TDD
```
RED:   test_hmr_bridge_has_agent_stream_channel() — CHANNEL_AGENT_STREAM constant exists
RED:   test_dispatcher_has_agent_stream_handler() — onAgentStreamEvent function exists
RED:   test_reducer_handles_agent_stream_event() — AGENT_STREAM_EVENT action adds to state
GREEN: Implement all 4 files
VERIFY: turbo run build --filter=theokit
```

#### Concurrency tests
(none — single-threaded event dispatch)

#### Acceptance Criteria
- [ ] `CHANNEL_AGENT_STREAM` constant in hmr-bridge.ts
- [ ] `onAgentStreamEvent` in dispatcher.ts
- [ ] `AGENT_STREAM_EVENT` handled in reducer.ts
- [ ] AgentsTab shows "Live" toggle with stream events
- [ ] All files ≤ 500 LoC

---

## Phase 3: Integration Validation

```bash
turbo run build --filter=theokit --force
```

## Coverage Matrix

| # | Gap | Task | Resolution |
|---|---|---|---|
| 1 | No route schema in devtools | T1.1 | JSONExplorer inline on click |
| 2 | No API docs link | T1.1 | Link to `/__theo/openapi/docs` |
| 3 | No agent stream channel | T2.1 | `CHANNEL_AGENT_STREAM` |
| 4 | No live stream view | T2.1 | AgentsTab "Live" toggle |

**Coverage: 4/4 gaps covered (100%)**

## Global Definition of Done

- [ ] Build succeeds
- [ ] RoutesTab shows schema + API docs link
- [ ] AgentsTab has live stream view
- [ ] All devtools files ≤ 500 LoC
- [ ] CHANGELOG updated

## Failure scenarios

(none — no external I/O. HMR bridge is dev-only, in-memory.)
