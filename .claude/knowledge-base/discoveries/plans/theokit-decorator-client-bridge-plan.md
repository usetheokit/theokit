# Discovery Plan: TheoKit Decorator → Client Bridge

> **Version 1.1** (2026-06-09) — Absorbed EC-1 from edge-case review: Q1 evidence path corrected from `packages/theo/src/vite-plugin/app-typed-client.test.ts` (does not exist) → `tests/unit/app-typed-client-plugin.test.ts` + `tests/unit/fixture-typed-client.test.ts` + `tests/type/app-client-proxy.test-d.ts` (all verified). Added halt-loop checkpoints per EC-2 (Q6 filePath scope check) + EC-3 (Q4 multi-method handling).
>
> **Version 1.0** — Investigate how to extend TheoKit's G1 `@theo/client` typed Proxy so that BOTH `defineRoute` file-system routes AND `@theokit/http-decorators` controllers feed the same auto-typed client. The consumer writes `@Controller('cats')` + `@Get()` on server, and `client.cats.get()` is automatically typed on the frontend — zero manual API wiring.

**Slug:** `theokit-decorator-client-bridge`
**Owner:** paulohenriquevn
**Created:** 2026-06-09
**Time budget:** 4h total (2h internal code audit + 2h Hono client reference)

## Context

`@theokit/http-decorators` v0.1.0-alpha.0 shipped (commits `0b7cef6..6c91b4b` on develop, 2026-06-08/09) with 74 GREEN tests, 24 decorators, `createDecoratorServer` standalone mount, AND `httpDecoratorsPlugin` TheoKit integration via `onRequest` hook. The package is 100% functional end-to-end.

HOWEVER: the G1 `@theo/client` typed Proxy (shipped 2026-06-01, commit `29b4bcd`) only scans `server/routes/` via `generateManifest()` → `scanServerRoutes()`. Controllers registered via `httpDecoratorsPlugin` are invisible to the client codegen — the `.theo/client.d.ts` module declaration doesn't include decorator-defined routes. This means consumers using decorators lose the auto-typed client DX that factory-function users get for free.

The user's vision (2026-06-09): "ter algo que comunica automaticamente frontend-backend" — the shared typed contract is the framework's differentiator vs Next.js (no shared typing), NestJS (no auto-client), Remix (no Proxy DX).

## Objective

Produce a blueprint that answers: **how should TheoKit's `generateManifest()` + `generateClientDts()` pipeline be extended so that WalkResult[] from decorator metadata merges into the same ManifestRoute[] that drives `.theo/client.d.ts` codegen?** Measured by: blueprint scores SHIPPABLE_WITH_CAVEATS or higher on `/discover-confidence`.

## In-Scope

### TheoKit internal (primary — 2h budget)

- **`packages/theo/src/vite-plugin/app-typed-client.ts`** — G1 .d.ts codegen. `emitClientDts()`, `generateClientDts()`, `buildOneRoute()`, `TreeNode` structure. The integration seam.
- **`packages/theo/src/server/scan/manifest.ts`** — `ManifestRoute` interface, `generateManifest()`. The data source that needs extending.
- **`packages/theo/src/server/scan/scan.ts`** — `scanServerRoutes()`. File-system route discovery.
- **`packages/theo/src/client/app-client.ts`** — Runtime Proxy. Does it need changes or is `client.d.ts` sufficient?
- **`packages/http-decorators/src/bridge/walk-metadata.ts`** — `WalkResult[]` shape. The decorator-side data source.
- **`packages/http-decorators/src/theokit-plugin.ts`** — `httpDecoratorsPlugin`. Where the decorator routes register.

### Hono client (comparative reference — 2h budget)

- **`.claude/knowledge-base/references/hono/src/client/`** — How Hono's `hc<AppType>()` creates a zero-codegen typed client from router type. `client.ts` (223 LoC), `types.ts` (393 LoC), `utils.ts` (114 LoC).

### Out of scope

- tRPC internals (no clone in `knowledge-base/references/`; tRPC's pattern is well-documented in the patterns skill's cross-cutting comparison)
- Blitz.js / Telefunc (compiler-transform patterns — different approach than TheoKit's codegen model)
- React Query adapter (`packages/theo/src/client/react-query.ts`) — downstream of the bridge; adapts whatever `client.d.ts` declares
- `.claude/knowledge-base/references/next.js/` — Next.js has no shared client typing
- `.claude/knowledge-base/references/nitro/` — Nitro has no typed client surface

## ADRs

### D1 — Codegen (.d.ts) approach over pure-type-inference approach

**Decision:** Investigate the codegen path (extend `generateClientDts()`) rather than tRPC-style pure runtime type inference.

**Rationale:** TheoKit already ships a codegen path (G1 `.theo/client.d.ts`). Switching to pure inference would require rewriting the entire client surface. Per Rule 9 (Don't Reinvent) + YAGNI — extend what exists.

**Alternatives considered:**
- (a) Pure type inference like tRPC — would require a shared router type that both `defineRoute` and `@Controller` classes emit. Fundamental rewrite of G1. Deferred.

### D2 — Merge at ManifestRoute level (NOT at TreeNode level)

**Decision:** Investigate merging decorator routes into `ManifestRoute[]` before `generateClientDts()` processes them — NOT by patching the TreeNode builder.

**Rationale:** `ManifestRoute` is the stable interface between scanner and codegen. Adding routes at this level means the ENTIRE downstream pipeline (tree building, .d.ts emission, collision detection, kebab→camelCase normalization) works unchanged. Per architecture.md v3.1 § "contracts in core/contracts/ are canonical".

**Alternatives considered:**
- (a) Patch TreeNode builder to accept a second source — couples codegen to decorator internals; fragile.

### D3 — Hono client as comparative (NOT adoptive) reference

**Decision:** Study Hono's `hc<AppType>()` for insights on typed-client DX (naming conventions, error handling, serialization), NOT to adopt their pattern (which is pure-inference, incompatible with G1's codegen model).

**Alternatives considered:**
- (a) Adopt Hono's `hc()` pattern wholesale — would require abandoning G1's Proxy in favor of Hono's fetch-wrapper. Breaking change.

### D4 — Time budget: 2h internal + 2h Hono

**Decision:** Internal code audit gets 2h (primary value — this is where the bridge code lands). Hono client reference gets 2h (comparative insights only).

## Research Questions

### Coverage Corner 1 — Integration Tests

**Q1:** How does TheoKit's existing G1 test suite verify that `.theo/client.d.ts` accurately reflects the routes in `server/routes/`? What test shape would a decorator-bridge test follow?

- **Corner:** Integration tests
- **Method:** Read `packages/theo/src/vite-plugin/app-typed-client.test.ts` (or equivalent) + Read `tests/unit/app-client-proxy.test.ts`. Identify the assertion pattern (snapshot? structural? parse the .d.ts?).
- **Expected answer shape:** Table of existing test patterns + proposed test shape for decorator-augmented .d.ts.
- **Evidence:** `tests/unit/app-typed-client-plugin.test.ts`, `tests/unit/fixture-typed-client.test.ts`, `tests/type/app-client-proxy.test-d.ts`

### Coverage Corner 2 — Dependencies

**Q2:** What new dependencies (if any) would the bridge require beyond what `@theokit/http-decorators` and `theokit` already declare? Does Hono's client pull in any deps TheoKit doesn't have?

- **Corner:** Dependencies
- **Method:** Read `packages/http-decorators/package.json` (existing deps), `packages/theo/package.json` (G1 deps), `.claude/knowledge-base/references/hono/package.json` (Hono client deps).
- **Expected answer shape:** Dependency delta table: current → proposed. Expected: zero new deps (bridge is a codegen function, not a runtime library).
- **Evidence:** `packages/http-decorators/package.json`, `.claude/knowledge-base/references/hono/package.json`

### Coverage Corner 3 — Tools

**Q3:** How does the G1 Vite plugin (`appTypedClientPlugin`) trigger `.d.ts` regeneration on file changes? What file-watcher pattern would need extending for `server/controllers/**/*.ts`?

- **Corner:** Tools
- **Method:** Read `packages/theo/src/vite-plugin/app-typed-client.ts` lines 280-405 (the Vite plugin `configureServer` + `buildStart` hooks). Identify the watcher scope.
- **Expected answer shape:** File-watcher extension spec: current glob `server/routes/**` → proposed glob `server/routes/** + server/controllers/**`.
- **Evidence:** `packages/theo/src/vite-plugin/app-typed-client.ts:280-405`

### Coverage Corner 4 — Techniques

**Q4:** What is the exact `ManifestRoute` shape that `generateClientDts()` consumes? How does each field map to WalkResult[] from `walkControllerMetadata()`?

- **Corner:** Techniques
- **Method:** Read `packages/theo/src/server/scan/manifest.ts` interface `ManifestRoute`. Read `packages/http-decorators/src/bridge/walk-metadata.ts` interface `WalkResult`. Produce a field-by-field mapping table.
- **Expected answer shape:** Mapping table: `ManifestRoute.filePath` ↔ `WalkResult.???`, `ManifestRoute.routePath` ↔ `WalkResult.fullPath`, `ManifestRoute.methods` ↔ `WalkResult.verb`, `ManifestRoute.paramNames` ↔ extracted from `WalkResult.fullPath`.
- **Evidence:** `packages/theo/src/server/scan/manifest.ts:18-25`, `packages/http-decorators/src/bridge/walk-metadata.ts:23-36`

**Q5:** How does Hono's `hc<AppType>()` type-level client infer route types from the server definition? What does the `ClientRequest<T>` / `ClientResponse<T>` type machinery look like?

- **Corner:** Techniques
- **Method:** Read `.claude/knowledge-base/references/hono/src/client/types.ts` (393 LoC) + `.claude/knowledge-base/references/hono/src/client/client.ts` (223 LoC). Identify the type-level transformation pipeline.
- **Expected answer shape:** Flow diagram: Hono `app.get('/path', handler)` → `AppType` → `hc<AppType>()` → `client.path.$get()` typed. Comparative note: what TheoKit can borrow vs what's incompatible.
- **Evidence:** `.claude/knowledge-base/references/hono/src/client/types.ts`, `.claude/knowledge-base/references/hono/src/client/client.ts`

**Q6:** What `generateClientDts()` function signature + internal transform would accept a combined `ManifestRoute[]` (file-routes + decorator-routes) and produce a SINGLE `.theo/client.d.ts` that types both sources? What's the minimal code change?

- **Corner:** Techniques
- **Method:** Read `packages/theo/src/vite-plugin/app-typed-client.ts` lines 120-250 (`buildOneRoute`, `generateClientDts`, `renderTreeNode`). Identify the input→output pipeline. Draft the extension point.
- **Expected answer shape:** Pseudo-code for `generateManifestWithDecorators(serverDir, controllers) → ManifestRoute[]` that merges both sources. Max 30 LoC delta in `app-typed-client.ts`.
- **Evidence:** `packages/theo/src/vite-plugin/app-typed-client.ts:120-250`

## Coverage Matrix

| # | Question | Corner | Method | Evidence path | Expected shape |
|---|---|---|---|---|---|
| Q1 | G1 test shape for .d.ts accuracy | Tests | Read test files | `tests/unit/app-typed-client-plugin.test.ts` + `tests/unit/fixture-typed-client.test.ts` + `tests/type/app-client-proxy.test-d.ts` | Test pattern table |
| Q2 | Dependency delta (expect: zero) | Deps | Read package.json × 3 | `packages/http-decorators/package.json`, `packages/theo/package.json`, `hono/package.json` | Delta table |
| Q3 | Vite plugin watcher scope extension | Tools | Read app-typed-client.ts:280-405 | `packages/theo/src/vite-plugin/app-typed-client.ts` | Watcher extension spec |
| Q4 | ManifestRoute ↔ WalkResult mapping | Techniques | Read manifest.ts + walk-metadata.ts | Both files | Field mapping table |
| Q5 | Hono hc<AppType> type machinery | Techniques | Read hono/src/client/{types,client}.ts | Both files | Flow diagram + comparative |
| Q6 | generateClientDts extension spec | Techniques | Read app-typed-client.ts:120-250 | The file | Pseudo-code 30 LoC |

**Coverage: 6/6 questions mapped (100%). All 4 corners represented (Tests:1, Deps:1, Tools:1, Techniques:3).**

## Halt-Loop Checkpoints

1. After Q1 + Q4: confirm ManifestRoute shape is compatible with WalkResult (if NOT → the merge strategy D2 needs revision → HALT).
2. After Q4 (EC-3): verify that `generateClientDts()` handles multiple ManifestRoute entries with the SAME filePath but DIFFERENT routePath+methods. If not, bridge must split WalkResult[] into one ManifestRoute per (verb, fullPath) pair with synthetic filePaths.
3. After Q5: confirm Hono's pattern is comparative-only (if it reveals a better approach → surface for human decision → HALT).
4. After Q6 (EC-2): before drafting pseudo-code, verify that ManifestRoute.filePath is ONLY used for import-path generation (not file-existence checks). If used for module-loading, a virtual-module approach adds scope beyond 30 LoC — surface for decision.
5. After Q6: confirm the extension is ≤ 50 LoC delta in `app-typed-client.ts` (if larger → the scope is wrong → HALT).

## Acceptance Criteria

- [ ] Every question answered with `file:line` citations resolving to real paths.
- [ ] ManifestRoute ↔ WalkResult mapping table complete with zero fabricated fields.
- [ ] Extension pseudo-code for `generateManifestWithDecorators()` ≤ 30 LoC.
- [ ] Hono comparative section explains what's borrowed vs what's incompatible.
- [ ] All 4 coverage corners have at least one populated section in the blueprint.
- [ ] At least one ADR in the blueprint synthesizing the recommended bridge approach.

## Global Definition of Done

- Blueprint scored ≥ SHIPPABLE_WITH_CAVEATS by `/discover-confidence`.
- Zero fabricated citations.
- All 4 coverage corners populated.
- ≥ 1 ADR in the blueprint.
