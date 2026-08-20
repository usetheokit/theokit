# ROADMAP — framework surface parity

Sixteen milestones, one per framework surface. Each surface is a `*-specialist` skill under
`.claude/skills/`; a milestone closes when the published packages meet that surface's contract and
`/acceptance` says so against the released artifact.

## What "done" means here

**The target is the specification, not a competitor's release.** Parity is measured against
WHATWG / W3C / RFC where a specification exists, and against the surface's own documented contract
where one does not. "Next.js does it this way" is prior art; it is never the criterion — the same
rule gate G5 enforces at intake (`.claude/rules/cycle-backlog.md § Hard gates`).

**The artifact is the released build, never the working tree.** These are internal packages, so
`/acceptance` builds from the released tag in a clean checkout and consumes the result the way a
real consumer does (`.claude/rules/cycle-acceptance.md § Target kinds`). `pnpm dev` against a dirty
tree is not an acceptance run.

**The checkbox is flipped by `/acceptance`, never by hand.** `[x]` claims *"we shipped it and
watched it work"*. Only `ACCEPTED` or `ACCEPTED_WITH_CAVEATS` may flip it, and only one flips per
release (`.claude/rules/cycle-acceptance.md § Hard gates`).

## Three-target parity is transversal

`.claude/rules/three-target-parity.md` (owner-declared, 2026-08-19) constrains every milestone
rather than adding one of its own. Each Definition of done therefore carries three lines naming
which targets the surface applies to and how the other two reach it.

They are written as gradeable criteria rather than as plain declarations on purpose: the rule's own
anti-patterns say that *"declaring a target supported because a package exists for it"* is the
failure mode, and that *"the evidence is an exercised path"*. A line `/acceptance` cannot grade is a
declaration, which is exactly what the rule refuses to accept.

`not applicable` is a complete answer when the reason is intrinsic — a terminal has no viewport. It
is not an answer when the reason is that nobody wired it.

The instrument for those lines is the north-star application
(`.claude/rules/northstar-app.md`): one backend, one presenter, a Web and a TUI front-end rendering
the same runs. It is what turns *"Tauri reaches this in-process"* from a declaration into an
exercised path.

It does not replace `/acceptance`. Acceptance grades the **released** artifact against the criteria
below; the north-star app runs continuously against the working framework and catches the
regression before it ships. A milestone naming the app as its instrument still has to pass
acceptance against the published build.

## The gap files are not evidence

Eleven of the sixteen `theokit-gap.md` files came back materially wrong on re-measurement
(2026-08-19): capabilities listed as missing that exist, capabilities listed as present that are
dead code. Building this roadmap on them would have scheduled the reimplementation of finished work
and declared finished what was never built.

**No criterion below cites a gap file.** Each cites the measurement, an issue, or a `file:line`.
Four surfaces re-measured clean (i18n, asset-optimization, dev-experience, multi-zone) and two with
fine corrections (navigation-prefetching, route-conventions).

## Wave 0.5 — wire what exists, first

The re-measurement found a pattern rather than a gap: **subsystems built, tested, and never
connected.** `initCacheEngine` has zero callers; the cache's `opts.defaults` is destructured and
dropped; `createObservabilityPlugin` and `resolveAdapter` appear only in tests; `trackAgentRun`
appears only in comments; `csrf-multi-header` is implemented and never exported; `action-encryption`
is exercised only by its own test. The repository already records the shape: *"1,715 LOC of
observability and cost … none of it was reachable"*.

This is the cheapest work in the programme — the code exists and is merely disconnected — and it is
a **precondition for measuring anything else**: with observability unwired, the agent-axis benchmark
has no instrument.

It is tracked as items in [`BACKLOG.md`](BACKLOG.md), not as a milestone, because it is repair
spread across surfaces rather than a surface of its own. Wave 1 criteria that depend on a wired
subsystem say so explicitly.

## Dependencies

Only dependencies on the three core milestones are declared, and each is a mechanism rather than a
sequencing preference: a surface depends on M1 when it crosses the server boundary, on M2 when it
consumes or alters rendered output, on M3 when it depends on what the build emits. Wave order is
not itself a dependency — two milestones in the same wave may run in either order.

## Wave 1 — the core

### M1 — [ ] server-boundary-security

**Surface:** `.claude/skills/server-boundary-security-specialist/` — what may cross from server to client, and what must never be reachable from a browser.
**Dependencies:** none — core surface

**Definition of done (all must hold):**

- [ ] the HITL approval path rejects an unauthenticated caller and an authenticated non-owner, verified against the published build; the open private security advisory is resolved and its fix released
- [ ] an owner check exists and is exercised: approving a run as a caller who does not own it is refused, not merely undocumented
- [ ] importing a server-only module from client code fails the build with an error naming both the module and the importing file
- [ ] CSRF protection on the Web handler is on by default — a cross-origin POST with no token is rejected by a build that sets no CSRF option (`packages/theo/src/server/http/web-handler.ts:314,482`, where absent currently means off)
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: the same authn/authz and owner checks run on the IPC path, through the in-process caller — not a second implementation
- [ ] TUI: the same authn/authz and owner checks run in-process; CSRF is *not applicable* — there is no browser origin to forge a request from

### M2 — [ ] rendering-pipeline

**Surface:** `.claude/skills/rendering-pipeline-specialist/` — where markup is produced, when it streams, and what the client re-executes.
**Dependencies:** none — core surface

**Definition of done (all must hold):**

- [ ] `curl` of the root route against a published build with `ssrStreaming: true` returns a parseable document containing both `<head>` and the hydration data script (#343)
- [ ] the generated Web entry is executed against a real `Request` in a test and returns a `Response` without throwing — asserting `toContain` over the template string is what let #344 ship, and does not satisfy this
- [ ] the first streamed chunk carries `<head>`, observed chunk-by-chunk rather than on the final buffered document
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: the webview renders through the same pipeline; no Tauri-specific renderer
- [ ] TUI: *not applicable* — a terminal has no HTML document. The same run renders through `packages/presenter`'s terminal presenter, and that path is exercised

### M3 — [ ] bundler-architecture

**Surface:** `.claude/skills/bundler-architecture-specialist/` — how modules are graphed, split, transformed and emitted.
**Dependencies:** none — core surface

**Definition of done (all must hold):**

- [ ] two clean builds of the same commit, with different on-disk file creation order, produce byte-identical client bundles (#346)
- [ ] the build emits a manifest and the served document carries `modulepreload` for the route's chunks, observed over the wire against the published build
- [ ] a determinism check runs in CI and fails the build when output is not reproducible
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: consumes the same emitted assets as Web; no separate build
- [ ] TUI: *not applicable* — no client bundle is shipped to a terminal. The core it imports is the same build output, and that is what the parity check covers

## Wave 2

### M4 — [ ] route-conventions

**Surface:** `.claude/skills/route-conventions-specialist/` — how a file path becomes a URL, and what a route file is allowed to export.
**Dependencies:** M2, M3

**Definition of done (all must hold):**

- [ ] `/api/users/settings` resolves to `/api/users/:id` and not to `/api/:resource/settings` against a published build (#348)
- [ ] precedence is compared per segment, and a regression test fails when the tiebreak is a whole-path `localeCompare`
- [ ] route precedence is documented as a specified contract rather than left to sort order
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: reaches the same route table through the in-process caller
- [ ] TUI: reaches the same route table through the in-process caller

### M5 — [ ] caching-revalidation

**Surface:** `.claude/skills/caching-revalidation-specialist/` — what is cached, under which key, for how long, and who may invalidate it.
**Dependencies:** M2

**Definition of done (all must hold):**

- [ ] `initCacheEngine` has a production caller and a cached route serves a hit on the second request, observed through the cache signal in a published build (#347)
- [ ] `opts.defaults` reaches the engine — a cache configured only through defaults produces the configured TTL behaviour, where today the option is destructured away
- [ ] N concurrent requests against a stale entry trigger exactly one background refresh, counted at the route layer
- [ ] `defineCachedFunction` refuses by name a function capturing a value that is not part of its cache key
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: the same cache engine runs in-process; entries are not re-implemented per target
- [ ] TUI: the same cache engine runs in-process

### M6 — [ ] navigation-prefetching

**Surface:** `.claude/skills/navigation-prefetching-specialist/` — what a client transition fetches, keeps, and shows in between.
**Dependencies:** M2, M3

**Definition of done (all must hold):**

- [ ] a viewport containing N prefetchable links issues at most the configured budget of requests, counted in the network log against a published build
- [ ] scroll position is restored on back navigation — `<ScrollRestoration/>` is mounted in the generated entry
- [ ] the prefetch budget is a declared, documented number rather than an implicit consequence of viewport size
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: the same client router runs in the webview
- [ ] TUI: *not applicable* — a terminal has no viewport to observe and no scroll position to restore

### M7 — [ ] dev-experience

**Surface:** `.claude/skills/dev-experience-specialist/` — how fast a change is visible, what state survives it, and what an error says.
**Dependencies:** M3

**Definition of done (all must hold):**

- [ ] a prod-like local run is one documented command, not two steps
- [ ] each of the three `full-reload` sites either preserves state across HMR or emits a named reason for the reload
- [ ] the share of errors naming the failing action does not regress below the 72% measured on 2026-08-19 (29 of a 179-error sample), and the measurement is re-run and recorded rather than assumed
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: the same dev server drives the desktop shell
- [ ] TUI: the same dev server drives the terminal client

### M8 — [ ] observability

**Surface:** `.claude/skills/observability-specialist/` — what a running application emits, and how a request is followed across a boundary.
**Dependencies:** M1

**Definition of done (all must hold):**

- [ ] a request carrying a W3C `traceparent` produces spans continuing that trace id — no `randomUUID()` is minted where a parent context exists (`packages/theo/src/server/http/request-handler.ts:216`, `agent-middleware.ts:122,199`)
- [ ] a run emits spans for run start and end, every tool call, every HITL pause and resume, and token usage, read back from an exported trace against a published build
- [ ] the exported signal is produced by a production caller, not only by a test
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: emits the same spans over the in-process path, with the trace continuing across the IPC boundary
- [ ] TUI: emits the same spans over the in-process path

## Wave 3

### M9 — [ ] metadata

**Surface:** `.claude/skills/metadata-specialist/` — titles, canonicals, social cards, robots directives and structured data.
**Dependencies:** M2

**Definition of done (all must hold):**

- [ ] with streaming on, the first flushed chunk contains the resolved `<title>` and `og:` tags — the same hoist defect as #343, measured on the first chunk
- [ ] a configured base URL makes `og:image` absolute in the served document, and a relative value is refused by name at build time rather than shipped broken
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: the webview document carries the same resolved tags
- [ ] TUI: *not applicable* — a terminal is not crawled and has no document head

### M10 — [ ] asset-optimization

**Surface:** `.claude/skills/asset-optimization-specialist/` — how images, fonts and static files are processed, addressed and cached.
**Dependencies:** M3

**Definition of done (all must hold):**

- [ ] a published build serves a transformed image — resized and re-encoded — for a declared source image
- [ ] declaring `srcSet` without `sizes` fails by name at build time
- [ ] a fonts module exists and emits preload links with the correct `crossorigin` attribute
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: the webview consumes the same optimized assets
- [ ] TUI: *not applicable* — a terminal renders neither raster images nor webfonts

### M11 — [ ] content-pipeline

**Surface:** `.claude/skills/content-pipeline-specialist/` — how authored content becomes a route and a rendered document.
**Dependencies:** M2, M3

**Status:** The safe pipeline **already exists** — `@theokit/ui` in the scaffold does sanitize-then-jsx with a streaming preprocess. This milestone closes two gaps in it and must not re-plan what is built.

**Definition of done (all must hold):**

- [ ] markdown `![]()` renders through the framework `Image` component in a scaffolded project's published build
- [ ] markdown `[]()` pointing at an external origin renders through `Link` and carries `rel="noopener noreferrer"`
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: the webview renders the same sanitized output
- [ ] TUI: the same content is parsed once in the core and rendered through the terminal presenter

### M12 — [ ] i18n

**Surface:** `.claude/skills/i18n-specialist/` — how a locale is negotiated, routed, and carried through rendering.
**Dependencies:** M2

**Status:** Nothing exists yet. This milestone is a build, not a repair.

**Definition of done (all must hold):**

- [ ] the served document carries `<html lang>` matching the negotiated locale — today the served template has no `lang` attribute at all
- [ ] a locale negotiated from the request is reachable both in a route handler and inside an agent run, against a published build
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: the webview document carries the same negotiated `lang`
- [ ] TUI: negotiation is reachable in-process; `<html lang>` is *not applicable* — there is no document

### M13 — [ ] middleware-edge

**Surface:** `.claude/skills/middleware-edge-specialist/` — what runs before a route resolves, and under which runtime constraints.
**Dependencies:** M1

**Definition of done (all must hold):**

- [ ] a middleware authored with the public `middleware()` builder is invoked by the file-scan runner in a published build (#345)
- [ ] a middleware declares a path matcher and runs only for the routes it matches
- [ ] a middleware requiring a runtime capability the target lacks is refused by name rather than skipped
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: the same middleware chain runs in-process before the route resolves
- [ ] TUI: the same middleware chain runs in-process before the route resolves

## Wave 4

### M14 — [ ] build-adapters

**Surface:** `.claude/skills/build-adapters-specialist/` — what the build emits, and what a deploy target consumes.
**Dependencies:** M3

**Definition of done (all must hold):**

- [ ] a streaming `/api/*` route streams on every listed adapter — chunks observed arriving before the response completes — or the adapter is delisted; the `web-shim` buffering the whole response is the current blocker across six targets
- [ ] declaring a capability the target cannot serve (WebSockets on a target without them) fails the build by name instead of deploying silently degraded
- [ ] no adapter is listed that nobody exercises in acceptance
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: the desktop build is produced by the same emitted output
- [ ] TUI: *not applicable* — the terminal client runs the core in-process and consumes no adapter; there is no hop for an adapter to bridge

### M15 — [ ] draft-preview

**Surface:** `.claude/skills/draft-preview-specialist/` — how unpublished content is rendered for an authorized reader only.
**Dependencies:** M1, M2

**Status:** Nothing exists yet. There is no `robots` or `noindex` field anywhere in `packages/theo/src`.

**Definition of done (all must hold):**

- [ ] an unpublished document is served only to a request carrying a valid preview credential; without it the published build serves the published version or 404, never the draft
- [ ] a preview response carries `noindex`, so a leaked preview URL is not indexed
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: the webview reaches preview through the same authorized path
- [ ] TUI: the authorization check is reachable in-process; `noindex` is *not applicable* — a terminal is not crawled

### M16 — [ ] multi-zone

**Surface:** `.claude/skills/multi-zone-specialist/` — how independently built applications compose behind one origin.
**Dependencies:** M3

**Status:** **Deprioritized, deliberately.** No blocker was measured on 2026-08-19 — this is the one surface where measurement found nothing to fix. It stays declared so the surface is not forgotten, and it is not scheduled. Pick it up only when a second zone actually exists; until then, every criterion below grades a need nobody has.

**Definition of done (all must hold):**

- [ ] two independently built zones compose behind one origin and a client navigation across the boundary preserves the session
- [ ] a zone boundary is declared explicitly rather than inferred from a path prefix
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely declared
- [ ] Tauri: *not applicable while deprioritized* — a desktop shell composes no zones today
- [ ] TUI: *not applicable* — there is no origin behind which to compose

## Programme completion

Closing all sixteen milestones satisfies the **parity** condition. It does not close the programme:
the second condition is **measured superiority on the agent axis**, and it is deliberately not a
milestone here because it spans every surface rather than any one of them.

The agent-axis benchmark measures ten canonical journeys — tool call, human-in-the-loop, streaming,
thread, multi-step, retry, rate limit, tenant, observability, deploy — on four dimensions:

| Dimension | Unit |
|---|---|
| Files touched | count |
| Glue lines written | count |
| Concepts required before the first run | count |
| Time to first green run | wall-clock |

It has no milestone block and no checkbox, so nothing here flips on it. It cannot run before Wave
0.5 wires observability — the benchmark needs an instrument. When it is ready to be run and graded,
it earns its own milestone through `/backlog-item` and `/discover`, not by being asserted here.

## Explicitly out of scope

- Cloning the App Router.
- Writing an in-house bundler.
- Treating RSC as a premise. If it is adopted, it is adopted through a measured ADR.
- Listing a deploy adapter nobody can exercise — M14 grades what is exercised, not what is named.

## Cross-references

- Transversal target constraint: `.claude/rules/three-target-parity.md`
- Acceptance contract that grades these criteria: `.claude/rules/cycle-acceptance.md`
- Checkbox flip invariant: `.claude/skills/release/scripts/flip_milestone_checkbox.py`
- Session binding for a milestone: `.claude/skills/cycle-goal/SKILL.md`
- Maintenance registry, including all Wave 0.5 items: `BACKLOG.md`
