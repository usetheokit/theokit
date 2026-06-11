# Blueprint: Devtools Viewer Extensions — OpenAPI Route Viewer + Agent Monitor

**Date:** 2026-06-11
**Discovery plan:** `discoveries/plans/devtools-viewer-plan.md`
**Questions answered:** 6/6 (0 blocked)

---

## Coverage Corner 1 — Techniques

### Q1: RoutesTab state shape

**Source:** `packages/theo/src/devtools/components/Tabs/RoutesTab.tsx:10-83`

RoutesTab reads `state.routeManifest` via `useDevtoolsContext()`. Each route has `path`, `absoluteFilePath`, and matched status. The tab renders a file tree with active route highlighting (blue accent) and click-to-open-in-editor (`/__open-in-editor`).

**Extension point for OpenAPI:** The tab already lists routes. Adding an OpenAPI viewer means either:
- (a) Embed Scalar UI inline under the route list (heavy — Scalar is 2MB CDN)
- (b) Add a "View API Docs" button that opens `/__theo/openapi` in a new tab (lightweight)
- (c) Add a mini JSON viewer showing the route's schema inline (moderate — reuse existing `JSONExplorer.tsx`)

**Recommendation:** Option (c) — show the route's Zod schema as JSON inline when clicked. The `JSONExplorer` component already exists at `devtools/components/JSONExplorer.tsx`. Embedding Scalar inside Shadow DOM is over-engineering (EC-5 confirmed: no Scalar dep today).

### Q2: AgentsTab subscription pattern

**Source:** `packages/theo/src/devtools/components/Tabs/AgentsTab.tsx:1-126`

AgentsTab uses **HMR dispatcher queue** (NOT SSE). Events come from `server/cost/track-agent-run.ts` → `dispatcher.onAgentRun()` → reducer `AGENT_RUN_ADD`. Displays: run count, total tokens, total cost, table with time/model/tokens/cost/status.

**Extension point for stream monitor:** The tab shows summary stats but NOT live streaming (no text_delta, tool_call events). To add real-time streaming:
- The HMR bridge needs a new channel: `CHANNEL_AGENT_STREAM = 'theo:devtools:agent-stream'`
- The dispatcher needs `onAgentStreamEvent()` handler
- AgentsTab needs a "Live" sub-view showing SSE events as they arrive

**Recommendation:** Add `CHANNEL_AGENT_STREAM` to hmr-bridge.ts (same pattern as the 5 existing channels). The dispatcher's `queuable()` wrapper handles the pre-mount queue automatically. The agent stream events are already typed (`AgentStreamEvent` discriminated union in agents/bridge/agent-stream-events.ts`).

### Q3: Astro Dev Toolbar plugin system

**Source:** `.claude/knowledge-base/references/astro/packages/astro/src/runtime/client/dev-toolbar/entrypoint.ts:30-277`

Astro uses a **custom elements + app definition** pattern:
- Apps register via `loadDevToolbarApps()` (async dynamic import)
- Each app has: `init(canvas, eventTarget)` lifecycle hook
- Communication via `eventTarget.dispatchEvent()` / `.addEventListener()`
- 4 built-in apps: `astro.js`, `audit/index.js`, `xray.js`, `settings.js`
- Navigation handled via `astro:after-swap` event

**Applicability to TheoKit:** TheoKit devtools uses React components (not custom elements) inside a Shadow DOM portal. The Astro "app" pattern (init + canvas + eventTarget) is too different to borrow directly. However, the **concept of pluggable tabs** is valid. TheoKit could expose a `registerDevtoolsTab()` API for plugins to add custom tabs.

**Recommendation:** DON'T copy Astro's custom-elements pattern. Instead, add new tabs as React components in the existing `components/Tabs/` directory — same pattern that added CsrfReadinessTab and SettingsTab. For plugin extensibility (future): expose `registerDevtoolsTab({ name, icon, component })` via TheoPlugin interface.

## Coverage Corner 2 — Integration Tests

### Q4: Next.js DevOverlay test patterns

**Source:** `.claude/knowledge-base/references/next.js/test/development/client-dev-overlay/index.test.ts:23-150`

Next.js tests overlay with **E2E Playwright** via `nextTestSetup()`:
- Shadow DOM traversal: `document.querySelector('nextjs-portal').shadowRoot.querySelector(selector)`
- Menu structure validated via inline snapshots (lines 136-150)
- Route display IS tested — "Route" appears as menu item in snapshot
- Tests cover: state persistence, preferences, minimization, fullscreen

**Applicable pattern for TheoKit:** TheoKit devtools tests should use the same Shadow DOM traversal pattern. However, TheoKit uses `happy-dom` in vitest (not Playwright) — Shadow DOM support in happy-dom is limited. For real devtools testing, Playwright E2E is the right tool.

**Recommendation:** Devtools tab tests should be Playwright E2E (like Next.js), not vitest unit tests. The tab logic (state reading + rendering) can be unit-tested via the reducer/dispatcher without the DOM.

## Coverage Corner 3 — Dependencies

### Q5: Current devtools dependencies

**Source:** grep of `packages/theo/src/devtools/` imports

| Dependency | Purpose | Shadow DOM safe? |
|---|---|---|
| `react` | Component rendering | ✅ |
| `react-dom` | DOM rendering | ✅ |
| `goober` | CSS-in-JS (scoped) | ✅ (generates `<style>` tags) |
| `vite` | HMR bridge (`import.meta.hot`) | ✅ (dev-only) |

**Scalar UI assessment:** NOT currently imported. Embedding Scalar inside Shadow DOM would require:
1. Adding `@scalar/api-reference` as dep (~2MB)
2. Ensuring Scalar's CSS doesn't leak out of Shadow DOM
3. Handling Scalar's CDN scripts inside shadow root

**Recommendation:** DON'T embed Scalar in devtools. The `createOpenApiHandler()` already serves Scalar at `/__theo/openapi/docs`. The RoutesTab should link to it (1 line: `<a href="/__theo/openapi/docs" target="_blank">`), not embed it.

## Coverage Corner 4 — Tools

### Q6: HMR bridge protocol + extension points

**Source:** `packages/theo/src/devtools/bridge/hmr-bridge.ts:14-23,72-108` + `dispatcher.ts:32-114`

**5 existing channels:**
- `CHANNEL_CSRF_WARN` — CSRF warnings
- `CHANNEL_ERROR` — runtime errors
- `CHANNEL_MANIFEST` — route manifest updates
- `CHANNEL_REQUEST` — HTTP request log
- `CHANNEL_ROUTE_MATCHED` — active route change

**Extension for agent streams:** Add `CHANNEL_AGENT_STREAM` following the exact same pattern:
1. `hmr-bridge.ts`: add `CHANNEL_AGENT_STREAM = 'theo:devtools:agent-stream'`
2. `hmr-bridge.ts`: add `hot.on(CHANNEL_AGENT_STREAM, wrap(dispatcher.onAgentStreamEvent))`
3. `dispatcher.ts`: add `onAgentStreamEvent: queuable((d, event) => d({ type: 'AGENT_STREAM_EVENT', event }))`
4. `reducer.ts`: handle `AGENT_STREAM_EVENT` action
5. `AgentsTab.tsx`: render stream events in a "Live" sub-view

The `queuable()` wrapper (dispatcher.ts:32-54) handles pre-mount queuing automatically. Error wrapping (EC-25 pattern) is built-in.

---

## ADRs

### ADR-1: Link to Scalar UI (don't embed in Shadow DOM)

**Decision:** RoutesTab shows a "View API Docs" button linking to `/__theo/openapi/docs`. Don't embed Scalar inside the devtools Shadow DOM.

**Rationale:** Scalar is ~2MB, its CSS doesn't scope to Shadow DOM without work, and the core already serves Scalar at a standalone endpoint. A link is 1 line; embedding is 100+ lines of Shadow DOM plumbing.

**Alternative rejected:** Embed Scalar via `<iframe>` inside Shadow DOM — fragile, styling issues, doubles memory.

### ADR-2: Agent stream via HMR channel (not separate WebSocket)

**Decision:** Transport agent stream events via a new HMR channel (`CHANNEL_AGENT_STREAM`), not a separate WebSocket connection.

**Rationale:** The existing HMR bridge already handles 5 channels reliably with pre-mount queuing, error wrapping, and manifest sync. Adding a 6th channel is 3 lines in hmr-bridge.ts + 3 lines in dispatcher.ts. A separate WebSocket would duplicate the connection management, lifecycle handling, and error wrapping.

**Alternative rejected:** Separate `new WebSocket()` for agent events — rejected: duplicates bridge infra.

---

## Recommendations for /to-plan

### Phase 1: RoutesTab Enhancement (~30 LoC)
1. Add "View API Docs" button linking to `/__theo/openapi/docs` (1 line)
2. When a route is clicked, show its Zod schema as JSON using existing `JSONExplorer` component
3. Read schema from route manifest (already available in `state.routeManifest`)

### Phase 2: AgentsTab Live Stream (~80 LoC)
1. Add `CHANNEL_AGENT_STREAM` to `hmr-bridge.ts` (3 lines)
2. Add `onAgentStreamEvent` to `dispatcher.ts` (3 lines)
3. Add `AGENT_STREAM_EVENT` handler to `reducer.ts` (~10 lines)
4. Extend `AgentsTab.tsx` with "Live" sub-view showing stream events (~60 lines)
5. Server-side: emit agent stream events to HMR channel from `createRealAgentStream` (~5 lines)

### NOT doing (YAGNI)
- Astro-style plugin extensibility (`registerDevtoolsTab`) — zero plugins exist; build when 3+ plugins ask for it
- Scalar embed — link is sufficient
- Separate WebSocket — HMR channel is simpler
