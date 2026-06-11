---
slug: devtools-viewer
version: "1.0"
created: 2026-06-11
question: "How should TheoKit extend its existing devtools overlay with an OpenAPI route viewer and agent monitor tab?"
---

# Discovery Plan: Devtools Viewer Extensions

## Context

TheoKit already has a comprehensive devtools overlay (3936 LoC, 36 files) implemented 2026-05-19 per blueprint at `knowledge-base/reference/devtools.md` (1163-line deep dive). The overlay has 7 tabs: Routes, Requests, Actions, Agents, Errors, CSRF Readiness, Settings.

**What exists:** Shadow DOM portal, Vite HMR bridge, goober CSS, drag handle, keyboard shortcuts, theme switching, server-side broadcast with redaction.

**What's missing:** The existing tabs show basic info. The gaps:
1. **RoutesTab** — shows routes but no interactive OpenAPI spec viewer (the core now ships `createOpenApiHandler`)
2. **AgentsTab** — shows agent names but no live streaming monitor (tool calls, tokens, cost in real-time)

**NOT investigating:** building devtools from scratch (already done). Only investigating how to extend the existing tabs with richer content.

## Objective

> Produce a blueprint describing how to extend RoutesTab with an embedded OpenAPI viewer and AgentsTab with a real-time streaming monitor, measured by the blueprint having file:line citations for both the existing tab components AND the reference implementations (Next.js DevOverlay, Astro Dev Toolbar).

## In-scope

| Reference | Directories | Focus |
|---|---|---|
| TheoKit devtools (local) | `packages/theo/src/devtools/components/Tabs/` | Existing RoutesTab.tsx + AgentsTab.tsx structure |
| TheoKit OpenAPI serve | `packages/theo/src/server/openapi/` | `createOpenApiHandler` — Scalar UI already available |
| Next.js DevOverlay | `.claude/knowledge-base/references/next.js/packages/next/src/next-devtools/dev-overlay/` | How Next.js renders route info + error details in overlay |
| Astro Dev Toolbar | `.claude/knowledge-base/references/astro/packages/astro/src/runtime/client/dev-toolbar/` | How Astro plugins extend the toolbar (app pattern) |

## Out-of-scope

- TanStack Router devtools (already analyzed in blueprint `reference/devtools.md`)
- Remix/SvelteKit/Nitro/Hono (verified to not ship devtools)
- Building a standalone devtools app (Chrome extension pattern — over-engineering for v1)

## Research Questions

### Corner: Techniques

**Q1.** How does the existing RoutesTab.tsx render route data — what state does it read, what format? (`packages/theo/src/devtools/components/Tabs/RoutesTab.tsx`)

**Q2.** How does the existing AgentsTab.tsx render agent data — does it subscribe to SSE events? (`packages/theo/src/devtools/components/Tabs/AgentsTab.tsx`)

**Q3.** How does the Astro Dev Toolbar plugin system work — can we borrow the "app" extension pattern for custom devtools panels? (`.claude/knowledge-base/references/astro/packages/astro/src/runtime/client/dev-toolbar/`)

### Corner: Integration tests

**Q4.** Does Next.js DevOverlay have tests for its route display? What test patterns do they use? (`.claude/knowledge-base/references/next.js/test/e2e/app-dir/dev-overlay/`)

### Corner: Dependencies

**Q5.** What dependencies does the TheoKit devtools overlay currently import? Can we embed Scalar UI inside a Shadow DOM tab without new deps? (`packages/theo/src/devtools/`)

### Corner: Tools

**Q6.** How does the Vite HMR bridge (`devtools/bridge/hmr-bridge.ts`) transport data — can we extend it to carry agent stream events? (`packages/theo/src/devtools/bridge/`)

## Coverage Matrix

| # | Question | Corner | Method | Expected answer |
|---|---|---|---|---|
| Q1 | RoutesTab state | Techniques | Read `RoutesTab.tsx` | State shape + data source |
| Q2 | AgentsTab subscription | Techniques | Read `AgentsTab.tsx` | SSE vs polling vs HMR |
| Q3 | Astro plugin pattern | Techniques | Read `astro/dev-toolbar/` | Extension API shape |
| Q4 | Next.js overlay tests | Tests | Read `next.js/test/e2e/app-dir/dev-overlay/` | Test patterns for overlay |
| Q5 | Devtools deps | Deps | Grep imports in `devtools/` | Dep list + Scalar feasibility |
| Q6 | HMR bridge protocol | Tools | Read `hmr-bridge.ts` | Message types + extension points |

**Coverage: 6/6 questions across 4 corners (100%)**

## Halt-loop checkpoints

1. Q1+Q2 answered (existing tab architecture understood) before designing extensions
2. Q3 answered (Astro pattern evaluated) before deciding extension model
3. Q5 answered (deps checked) before proposing Scalar embed
4. All 6 questions answered → blueprint draft → `/discover-confidence`

## Acceptance Criteria

- [ ] Every question answered with file:line citation
- [ ] Blueprint describes RoutesTab extension (OpenAPI viewer)
- [ ] Blueprint describes AgentsTab extension (stream monitor)
- [ ] ADR: embed Scalar in Shadow DOM vs link to `/api/docs`
- [ ] ADR: extend HMR bridge for agent events vs separate WebSocket

## Global DoD

- Blueprint at `knowledge-base/discoveries/blueprints/devtools-viewer-blueprint.md`
- `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
