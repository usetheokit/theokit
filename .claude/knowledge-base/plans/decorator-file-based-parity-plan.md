---
slug: decorator-file-based-parity
created_at: 2026-07-13
goal: Make `@theokit/http` decorator controllers first-class in a theokit app (served by `theokit dev`/`start` AND present in the generated typed client), at parity with file-based `route()`.
---

# Decorator ↔ file-based parity in a theokit app (#122)

## Goal

Make a `server/controllers/*.controller.ts` (decorator `@Controller`/`@Get`/`@Post`/`@Body`) served by `theokit dev`/`start` **and** emitted into `.theokit/client.d.ts` with inferred request/response types — verified by one integration test that calls a decorated controller through the generated typed client (`client.tasks.get()`) and asserts the response type + a 200.

**Single metric:** the new integration test `tests/integration/controller-parity.test.ts` passes (controller served + typed-client entry present + inference correct).

## Context

Closes #122. Prior investigation (this conversation) established:
- **No controller scanner exists** in `packages/theo/src/server/scan/` (only `scan.ts` = routes). `grep scanController|compileController` → 0.
- **Dev/start serve routes only** — `api-middleware.ts` uses `scanServerRoutes(serverDir)` + `matchRoute`.
- **Typed client is routes-only** — `app-typed-client.ts` `buildOneRoute` imports `GET`/`POST` from route files.
- **Decorators run in a standalone runtime** — `@theokit/http` `TheoApp.listen(port)` (`packages/http/src/app.ts`, 688 LoC) with its own `walkControllerMetadata`.
- **`controllersGlob` watch is orphan** — `app-typed-client.ts § configureServer` watches `serverDir/controllers` but nothing consumes it.

The decorator SURFACE already exists and is designed (patterns skill `theokit-http-decorators-pattern-from-nestjs-patterns`, blueprint). This plan does **integration**, not redesign: reuse `walkControllerMetadata` (D-2 — `@Body(zodSchema)` captured as `bodySchema: z.ZodType`), the swc-loader (D-1 — Legacy decorators), and feed them into the theokit app's scan → mount → typed-client pipeline.

## Prior Art & Related Work

- **Patterns skill `theokit-http-decorators-pattern-from-nestjs-patterns`** (blueprint `theokit-http-decorators-pattern-from-nestjs`): D-1 (Legacy decorators + `emitDecoratorMetadata` + `reflect-metadata` peer), D-2 (explicit Zod on `@Body(schema)`, Zod is SSoT — `rules/type-safety.md`), D-3 (`@UseGuards`→`defineMiddleware`). This plan CONSUMES D-1/D-2 (reuses the captured `bodySchema`) and does not re-derive them.
- **`@theokit/http` `walkControllerMetadata`** (`packages/http/src/bridge/walk-metadata.ts`, 144 LoC) — already returns per-method `{ path, method, bodySchema?, paramsSchema?, paramEntries }`. Reuse, don't reinvent (Rule 9).
- **`@theokit/http` swc-loader** (`packages/http/src/bridge/swc-loader.ts`, 251 LoC) — already compiles parameter decorators. Reuse for the Vite transform.
- **File-based codegen** (`app-typed-client.ts`) — the emission model (`InferResponse<typeof GET>` deferring to tsc) is the template to mirror for controllers (via `ReturnType`/`z.infer`).
- **#117 / #119 / ADR-0028 R3a / ADR-0056** — handlers + plugin hooks get a Web `Request`; controller adapters MUST preserve this (controllers dispatch through the same request path).

## Baseline Context

### Files that will be touched

| File | LoC | Last touch | Role today |
|---|---|---|---|
| `packages/theo/src/server/scan/scan.ts` | 156 | efe63ed 2026-06-11 | walks `serverDir/routes/`; **template** for controller-scan |
| `packages/theo/src/server/scan/controller-scan.ts` | (NEW) | — | walk `serverDir/controllers/` → controller route entries |
| `packages/theo/src/server/scan/manifest.ts` | 155 | a2fcb62 2026-07-08 | `generateManifest` (routes → `ManifestRoute[]`); add controller source |
| `packages/theo/src/vite-plugin/api-middleware.ts` | 391 | a3cf6e8 2026-07-13 | dev request dispatch (routes); **at 391/500 budget → extract, don't inflate (G6)** |
| `packages/theo/src/server/http/controller-dispatch.ts` | (NEW) | — | mount + dispatch a walked controller route (shared dev/start) |
| `packages/theo/src/vite-plugin/app-typed-client.ts` | 424 | 17430c1 2026-06-19 | typed-client codegen; **at 424/500 → extract controller emit; wire the orphan controllersGlob** |
| `packages/theo/src/vite-plugin/controller-swc-transform.ts` | (NEW) | — | Vite transform routing `controllers/**` through swc-loader (esbuild can't do param decorators) |
| `packages/http/src/bridge/walk-metadata.ts` | 144 | efe63ed 2026-06-11 | REUSED read-only (may add an exported helper) |

### Current callers / dependents

`scanServerRoutes` / `generateManifest` are consumed by: `vite-plugin/{api-middleware,app-typed-client,server-routes-hmr,index}.ts`, `vite-plugin/openapi-emit/dev-emit.ts`, `cli/commands/build.ts`, and every deploy adapter (`adapters/{bun,deno-deploy,netlify,vercel,...}.ts`). **Adding controllers to the manifest touches the whole adapter matrix** → controller entries MUST be additive + adapter-opt-in (adapters that don't support decorators skip them with an INFO, mirroring how non-TheoCloud adapters reject `services`).

### Domain glossary

- **Controller** — a class decorated with `@Controller(prefix)` whose methods (`@Get`/`@Post`/…) become routes.
- **`walkControllerMetadata(Class)`** — reflect-metadata walk → `WalkResult[]` (path, method, bodySchema, paramsSchema, paramEntries) per method.
- **swc-loader** — @swc/core transform that compiles parameter decorators (`@Body`/`@Param`/`@Query`) esbuild cannot.
- **Typed client** — `.theokit/client.d.ts` (`@theo/client`), `client.<resource>.<method>()` with `InferResponse`.

### Architecture boundaries affected

- G1 dependency direction: `theo` (server/vite-plugin) MAY import `@theokit/http` (http is lower-level; `agents`→`http`, and `theo` already references `@theokit/http` in `app-typed-client.ts`/`generate.ts`). Controller-scan/dispatch live in `packages/theo` and import `@theokit/http` walker — allowed.
- G6 file budgets: `api-middleware.ts` (391) + `app-typed-client.ts` (424) are near the 500 BLOCK → new logic goes in NEW files, not inflating these.
- ADR-0028 R3a / #119: controller dispatch reuses the existing Web-`Request` handler path (`incomingMessageToHandlerRequest`), never a second request shape.

## ADRs

### ADR-1 — Reuse `@theokit/http` `walkControllerMetadata` + swc-loader; do NOT reimplement a decorator engine in `theo`
**Decision:** the theokit app's controller-scan/dispatch call `@theokit/http`'s existing walker + swc-loader.
**Rationale:** Rule 9 (don't reinvent) + Patterns D-1/D-2 already solved decorator metadata + swc compilation; a second engine = DRY violation + 2× bug surface (`sdk-runtime.md`-style incoherence).
**Rejected:** (a) reimplement a lightweight decorator reader in `theo` — duplicates `walk-metadata.ts`, drifts. (b) shell out to a standalone `TheoApp` per request — wrong runtime, no Vite/SSR/typed-client.

### ADR-2 — Typed-client entries for controllers are emitted as TYPE expressions over the class (deferred to tsc), mirroring the file-based `InferResponse` model
**Decision:** for a controller method `Ctrl.method`, emit `Promise<Awaited<ReturnType<InstanceType<typeof Ctrl>['method']>>>` for the response, and derive the body type from the captured `@Body` Zod schema (`z.infer<typeof schema>` when the schema is an exported const) OR the method's first param type (`Parameters<...>[n]`) when not.
**Rationale:** mirrors `app-typed-client.ts`'s existing "emit a type expression, let tsc resolve" model — no type computation in the Vite plugin. Preserves "Zod is SSoT" (D-2) for the request side.
**Rejected:** (a) runtime-only parity, no typed client — fails the user's core requirement (parity with `route()` INCLUDES the typed client). (b) full static analysis of controller types in the plugin — re-implements tsc; brittle.
**Decision checkpoint (Phase 3 gate):** if a spike shows body/param inference from classes is not reliably expressible as a type expression (e.g., `@Body('key')` named extraction, or un-typed method params), FALL BACK to: response-typed + body typed as `unknown` (documented), and file a follow-up — but the route is still SERVED + appears in the client. Runtime parity (Phases 1–2) ships regardless.

### ADR-3 — Controller mounting is extracted into `controller-dispatch.ts`, shared by dev + start; `api-middleware.ts`/`app-typed-client.ts` are NOT inflated
**Decision:** new `server/http/controller-dispatch.ts` owns "given a walked controller route + a Web Request, run it through the shared handler path"; `api-middleware` calls it after `matchRoute` misses a file route.
**Rationale:** G6 (both files near 500 LoC BLOCK); SRP (`architecture.md § 3`).
**Rejected:** inline in `api-middleware.ts` — pushes it over budget, blocks commit.

### ADR-4 — `controllers/**` are compiled by swc via a dedicated Vite transform; file-based routes stay on esbuild
**Decision:** a Vite plugin `enforce:'pre'` transform routes only `serverDir/controllers/**` through `@theokit/http`'s swc-loader (Legacy decorators + `emitDecoratorMetadata`); everything else untouched.
**Rationale:** esbuild cannot emit param-decorator metadata (documented in swc-loader.ts:124); scoping to `controllers/**` keeps the common path fast + zero-config for non-decorator apps.
**Rejected:** swc for the whole app — slower, unnecessary, changes the default compile for every file.

## Dependency Graph

```
Phase 1 (controller-scan + manifest source)  ── blocks ──▶ Phase 2 (swc transform + dispatch/mount = runtime parity)
Phase 1 ── blocks ──▶ Phase 3 (typed-client emit for controllers)   [Phase 3 gated by ADR-2 checkpoint]
Phase 2 + Phase 3 ── block ──▶ Phase 4 (integration validation + showcase example)
```
Phase 2 and Phase 3 are parallelizable after Phase 1.

## Phases

### Phase 1 — Controller scan → manifest routes

**Task 1.1 — `controller-scan.ts` walks `serverDir/controllers/**` into route entries.**
- **Files to edit:** `packages/theo/src/server/scan/controller-scan.ts` (NEW), `packages/theo/src/server/scan/manifest.ts`.
- **Why this step:** the typed client + dispatch both need a manifest of controller routes; today none exists (Baseline: no controller-scan). Mirrors `scan.ts` (routes) — same directory-walk shape, different extractor (`walkControllerMetadata`).
- **Deep dependency analysis:** `generateManifest` (manifest.ts:86,131) is consumed by 10+ files incl. all adapters — so controller routes are ADDED to `ManifestRoute[]` as additive entries carrying `{ routePath, methods, source: 'controller', filePath, exportName }`; adapters that ignore `source==='controller'` are unaffected.
- **TDD:** `tests/unit/controller-scan.test.ts` — given a fixture `controllers/tasks.controller.ts` (reuse `fixtures/decorator-fullstack`), `scanControllers(dir)` returns entries for `GET /api/v2/tasks`, `GET /api/v2/tasks/:id`, `POST /api/v2/tasks` with the captured `bodySchema` present on POST. RED first (no scanner). GWT.
- **Concurrency tests:** (none — single-threaded build-time scan).
- **Acceptance:** entries include path+method+source; no route-file entries regress (`generateManifest` still returns the same file-based routes for a routes-only app).
- **DoD:** `npx vitest run tests/unit/controller-scan.test.ts` green; `wc -l controller-scan.ts` < 200.

### Phase 2 — swc transform + runtime mount (runtime parity)

**Task 2.1 — Vite transform compiles `controllers/**` through swc-loader.**
- **Files to edit:** `packages/theo/src/vite-plugin/controller-swc-transform.ts` (NEW), `packages/theo/src/vite-plugin/index.ts` (register plugin).
- **Why this step:** parameter decorators need swc (esbuild limitation, swc-loader.ts:124); without this, `@Body`/`@Param` metadata is missing at runtime → dispatch can't validate/inject. Scoped to `controllers/**` (ADR-4) so the default path is untouched.
- **Deep dependency analysis:** the transform runs `enforce:'pre'`; only matches `id` under `serverDir/controllers/`. Reuses `swc-loader`'s config (strip `$schema`, Legacy decorators).
- **TDD:** `tests/unit/controller-swc-transform.test.ts` — a controller source with `@Body(z...)` transformed by the plugin yields code where `reflect-metadata` param metadata is emitted (assert the transform output contains the decorator metadata calls / that `walkControllerMetadata` on the loaded module returns the body schema). RED first.
- **Failure scenarios (external tooling):** `@swc/core` missing → the transform throws a clear DX error naming `@swc/core` (mirror swc-loader.ts:124), not a cryptic esbuild failure. Test asserts the error message.
- **Acceptance:** a controller module loaded via the transform exposes param metadata; a non-controller file is untouched (identity).

**Task 2.2 — `controller-dispatch.ts` mounts a walked controller route on the shared Web-Request handler path; `api-middleware` + start call it.**
- **Files to edit:** `packages/theo/src/server/http/controller-dispatch.ts` (NEW), `packages/theo/src/vite-plugin/api-middleware.ts` (call after file-route miss), `packages/theo/src/cli/commands/start/*` (same).
- **Why this step:** runtime parity — the whole point is a controller ACTUALLY SERVES in `theokit dev`. Reuses `incomingMessageToHandlerRequest` (ADR-0028 R3a / #119) so `ctx`/plugins/CSRF/session behave identically to file routes.
- **Deep dependency analysis:** `api-middleware.ts` (391 LoC, near G6 500) → dispatch logic lives in the NEW file; api-middleware only adds a ~5-line "if no route match, try controller match" branch. Preserves CSRF (`enforceCsrf`) + security headers + plugin hooks already in api-middleware.
- **TDD:** `tests/integration/controller-serve.test.ts` — a real request to `POST /api/v2/tasks` on a controller-backed app returns 200 + the created task; `@Body(zod)` validation rejects a bad body with the typed error; CSRF enforced on POST. RED first.
- **Concurrency tests:** (none — single request per test; dispatch holds no shared mutable state).
- **Acceptance:** controller routes served; file-based routes still served (no regression); CSRF/session identical.

### Phase 3 — Typed-client emit for controllers (ADR-2; gated by checkpoint)

**Task 3.1 — Emit `client.<controller>.<method>()` entries into `.theokit/client.d.ts`; wire the orphan `controllersGlob`.**
- **Files to edit:** `packages/theo/src/vite-plugin/controller-client-emit.ts` (NEW), `packages/theo/src/vite-plugin/app-typed-client.ts` (call the new emitter; the `controllersGlob` watch now feeds it).
- **Why this step:** parity's decisive half — the user's requirement is decorators keep the typed client `route()` gives. Emits type expressions over the controller class (ADR-2), mirroring the file-based `InferResponse` model.
- **Deep dependency analysis:** `app-typed-client.ts` (424 LoC, near budget) → the controller emitter is a NEW file; app-typed-client imports it + merges its entries into the same client tree. The `controllersGlob` watch (currently orphan) now triggers a re-emit that includes controllers.
- **TDD:** `tests/unit/controller-client-emit.test.ts` — given the tasks controller manifest, the emitted `.d.ts` contains `tasks: { get: ... ; post: ... }` whose types resolve to the method return + `@Body` schema; a `tsc` type-test (`expectTypeOf`) asserts `client.tasks.post` body is `{ title: string; priority: ... }` and response is the task. RED first.
- **Checkpoint (ADR-2):** run the type-test spike FIRST; if class-based body inference is not reliably expressible, ship response-typed + body `unknown` + follow-up issue, and note it in the plan's Unresolved Questions resolution.
- **Acceptance:** controller entries appear in the client with correct response type; file-based client entries unchanged (byte-diff on a routes-only fixture).

### Phase 4 — Integration Validation (the "eat your own cooking" gate)

**Task 4.1 — End-to-end: a decorator controller served + called through the typed client, in a real fixture; showcase example.**
- **Files to edit:** `tests/integration/controller-parity.test.ts` (NEW), `fixtures/decorator-fullstack/` (add an `app/` + `theo.config` so it's a real theokit app, OR a new minimal fixture), optional `apps/showcase` variant.
- **Why this step:** the Goal's single metric. Proves the full chain: scan → swc → serve → typed client → call.
- **TDD:** boot the fixture through the theokit dev/build path; assert (a) `GET /api/v2/tasks` served 200, (b) `.theokit/client.d.ts` has the `tasks` entry, (c) a `tsc` type-test over `client.tasks.get()` resolves the response type.
- **Failure scenarios:** malformed controller (missing `@Controller`) → clear scan error, not a silent skip; `@swc/core` absent → DX error.
- **DoD:** full suite green (`vitest run tests/`), `tsc --noEmit` clean, `eslint --max-warnings=0`, changeset (`minor`) added, ADR-0057 written, CHANGELOG via changeset.

## Coverage Matrix

| Requirement (from #122 / Goal) | Task(s) |
|---|---|
| Scan `server/controllers/` | 1.1 |
| Controllers in the manifest (adapter-additive) | 1.1 |
| swc compile controllers in dev (param decorators) | 2.1 |
| Serve controllers in `theokit dev`/`start` (runtime parity) | 2.2 |
| CSRF/session/plugin parity with file routes (#119/ADR-0028) | 2.2 |
| Typed-client entries for controllers (`@theo/client`) | 3.1 |
| Request/response inference from classes (ADR-2 + checkpoint) | 3.1 |
| Wire (not orphan) the `controllersGlob` watch | 3.1 |
| Zero regression to file-based routes + typed client | 1.1, 2.2, 3.1, 4.1 |
| End-to-end parity proof | 4.1 |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Class-based body/param inference may not be expressible as a type expression (`@Body('key')`, untyped params) | HIGH | ADR-2 checkpoint spike FIRST; fall back to response-typed + body `unknown` + follow-up; runtime parity ships regardless | plan author |
| Blast radius: adding controller routes to the shared manifest could affect 10+ adapters | HIGH | Controller entries are additive + `source:'controller'`; adapters ignore unknown source (test: routes-only manifest byte-identical) | plan author |
| swc-in-Vite adds a compile path + `@swc/core` requirement | MEDIUM | Scope transform to `controllers/**` (ADR-4); clear DX error when swc missing; zero impact on non-decorator apps | plan author |
| G6: `api-middleware.ts` (391) / `app-typed-client.ts` (424) near 500 BLOCK | MEDIUM | All new logic in NEW files (ADR-3); the two files gain only a small call site each | plan author |
| Two decorator engines drift (`@theokit/http` vs a `theo` reader) | MEDIUM | ADR-1: reuse `walkControllerMetadata`; never reimplement | plan author |

## Unresolved Questions

- Q1: Body/param type inference from decorated classes — resolved at Phase 3 by a spike; the checkpoint (ADR-2) picks full-inference vs response-only fallback. Not blocking runtime parity.
- Q2: Guards/interceptors (`@UseGuards`/`@UseInterceptors`) in the app path — out of scope here (the patterns skill's guards→middleware pattern maps them to `defineMiddleware`; wiring that into the app dispatch is a follow-up). Controllers in this plan support routing + `@Body`/`@Param`/`@Query` + CSRF/session; guards/interceptors deferred with an explicit note.
- Q3: Deploy adapters serving controllers — this plan makes controllers work in `dev`/`start`; adapter (Vercel/CF/…) emission of controllers is a follow-up (the manifest is additive so it doesn't break them, but they won't serve controllers until wired).

## Failure scenarios

- **`@swc/core` missing** — the Vite transform (2.1) throws a DX error naming `@swc/core` (test asserts message); not an esbuild crash.
- **Malformed controller** (no `@Controller`, or a method with no HTTP decorator) — scan (1.1) reports a clear error, not a silent skip (test).
- **`@Body()` without schema and without `emitDecoratorMetadata`** — mirror `walk-metadata.ts:74` WARN; validation is skipped with a documented warning (D-2).

## Global DoD

- All tasks' tests green; `tsc --noEmit` clean; `eslint packages/ --max-warnings=0`.
- New files < 500 LoC (G6); `api-middleware.ts` / `app-typed-client.ts` stay < 500.
- Zero regression: full `tests/` suite green (3815 baseline) + a routes-only fixture's `.theokit/client.d.ts` byte-unchanged.
- ADR-0057 written; changeset (`minor`) added; #122 referenced.
- Respects ADR-0028 R3a / #119 (Web Request), `type-safety.md` (Zod SSoT / no `any` in prod), Rule 9 (reuse `@theokit/http`).
