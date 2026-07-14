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

### ADR-1 — Reuse `@theokit/http` `walkControllerMetadata` + swc-loader + `registerControllers`; do NOT reimplement a decorator engine in `theo`
**Decision:** the theokit app's controller scan/dispatch call `@theokit/http`'s existing public surface: `walkControllerMetadata` (route metadata + `bodySchema`), the swc-loader (compile param decorators), and **`registerControllers(classes) → RouteRegistration[]`** (mount + Web-Standard handler). `theo` only WIRES these into its dev/start request path + typed-client codegen.
**Rationale:** Rule 9 (don't reinvent) + Patterns D-1/D-2 already solved decorator metadata + swc compilation, and `registerControllers` already builds the Web-Standard dispatch handler; a second engine = DRY violation + 2× bug surface (`sdk-runtime.md`-style incoherence).
**Rejected:** (a) reimplement a decorator reader/dispatcher in `theo` — duplicates `walk-metadata.ts`/`registerControllers`, drifts. (b) shell out to a standalone `TheoApp.listen()` per request — wrong runtime, no Vite/SSR/typed-client. (c) `@theokit/http`'s `createTypedClient` for the typed client — REJECTED for the codegen: it needs a HAND-DECLARED `contract()` RouteMap, so it does NOT auto-generate from controllers the way `theo`'s codegen does from route files (verified in `packages/http/dist/index.d.ts`). The codegen must synthesize controller entries itself (ADR-2).

### ADR-2 — Typed-client entries for controllers are emitted as TYPE expressions over the class (deferred to tsc), mirroring the file-based `InferResponse` model
**Decision:** for a controller method `Ctrl.method`, emit `Promise<Awaited<ReturnType<InstanceType<typeof Ctrl>['method']>>>` for the response, and derive the body type from the captured `@Body` Zod schema (`z.infer<typeof schema>` when the schema is an exported const) OR the method's first param type (`Parameters<...>[n]`) when not.
**Rationale:** mirrors `app-typed-client.ts`'s existing "emit a type expression, let tsc resolve" model — no type computation in the Vite plugin. Preserves "Zod is SSoT" (D-2) for the request side.
**Rejected:** (a) runtime-only parity, no typed client — fails the user's core requirement (parity with `route()` INCLUDES the typed client). (b) full static analysis of controller types in the plugin — re-implements tsc; brittle.
**Decision checkpoint (Phase 3 gate):** if a spike shows body/param inference from classes is not reliably expressible as a type expression (e.g., `@Body('key')` named extraction, or un-typed method params), FALL BACK to: response-typed + body typed as `unknown` (documented), and file a follow-up — but the route is still SERVED + appears in the client. Runtime parity (Phases 1–2) ships regardless.

### ADR-3 — Controller mounting is a NEW `controller-dispatch.ts` (reusing `registerControllers`), shared by dev + start; `api-middleware.ts`/`app-typed-client.ts` are NOT inflated
**Decision:** new `server/http/controller-dispatch.ts` owns "scan `server/controllers/`, `registerControllers` → a controller route table, and given a Web Request match+run it through the shared handler path (`incomingMessageToHandlerRequest`)". `api-middleware` calls it AFTER `matchRoute` misses a file route (a ~5-line branch).
**Rationale:** G6 (both files near 500 LoC BLOCK); SRP (`architecture.md § 3`); Rule 9 (reuse `registerControllers`).
**Rejected:** inline in `api-middleware.ts` — pushes it over budget, blocks commit.

### ADR-4 — `controllers/**` are compiled by swc via a dedicated Vite transform; file-based routes stay on esbuild
**Decision:** a Vite plugin `enforce:'pre'` transform routes only `serverDir/controllers/**` through `@theokit/http`'s swc-loader (Legacy decorators + `emitDecoratorMetadata`); everything else untouched.
**Rationale:** esbuild cannot emit param-decorator metadata (documented in swc-loader.ts:124); scoping to `controllers/**` keeps the common path fast + zero-config for non-decorator apps.
**Rejected:** swc for the whole app — slower, unnecessary, changes the default compile for every file.

### ADR-5 — Controllers are a PARALLEL route path; `generateManifest`/`ManifestRoute` are NOT touched (zero adapter ripple)
**Decision:** controllers do NOT enter the shared file-based `generateManifest`/`ManifestRoute`. Their scan → dispatch (ADR-3) and their typed-client emit (ADR-2) are a parallel path, sitting alongside the file-based routes in the dev/start request handler and the codegen — never folded into `generateManifest`.
**Rationale:** the file-based manifest is SYNC (static file scan) and consumed by 10+ callers incl. every deploy adapter (`adapters/{bun,deno,netlify,vercel,…}`). Folding controllers in would force `generateManifest` ASYNC (controllers need `walkControllerMetadata` on a loaded module for `bodySchema`) and ripple `await` across the whole adapter matrix — high blast radius for zero benefit (routing works fine parallel). Keeping controllers parallel means a routes-only app's manifest + `.theokit/client.d.ts` are byte-identical (regression-proof). This also fixes the Task 1.1 decomposition defect surfaced at implement-time (a scanner folded into the sync manifest conflated static routing with runtime `bodySchema`, forcing the ripple + a non-wireable scanner).
**Rejected:** (a) async `generateManifest` + controller entries (the original plan) — 10+-adapter `await` ripple, regression risk, no upside. (b) static AST parse of decorators into the sync manifest — reimplements `walk-metadata`'s path derivation (Rule 9 violation) and still can't capture `bodySchema` for dispatch. **Consequence:** deploy adapters (Vercel/CF/…) do not serve controllers until a separate follow-up wires the parallel path into each adapter (dev/start parity ships now; adapter parity is a tracked follow-up).

## Dependency Graph

```
Task 1.1 (swc transform for controllers/**)  ── blocks ──▶ Task 1.2 (scan + dispatch/mount = RUNTIME parity)
Task 1.2 ── blocks ──▶ Task 2.1 (typed-client emit = TYPED parity)   [ADR-2 checkpoint]
Task 1.2 + Task 2.1 ── block ──▶ Task 3.1 (integration validation + release)
```
Each task is independently WIREABLE (its own production caller) and NONE touch `generateManifest` (ADR-5 — zero adapter ripple).

## Phases

### Phase 1 — Runtime parity (controllers served in a theokit app)

**Task 1.1 — Vite transform compiles `controllers/**` through the swc-loader.**
- **Files to edit:** `packages/theo/src/vite-plugin/controller-swc-transform.ts` (NEW), `packages/theo/src/vite-plugin/index.ts` (register the plugin).
- **Why this step:** parameter decorators (`@Body`/`@Param`/`@Query`) need swc — esbuild can't emit their metadata (swc-loader.ts:124); without it, dispatch (Task 1.2) can't validate/inject. This is the foundation. **Wireable:** the caller is the Vite plugin array in `index.ts` (the transform is registered = invoked on `controllers/**`).
- **Deep dependency analysis:** `enforce:'pre'` transform; matches only `id` under `serverDir/controllers/`. Reuses `@theokit/http`'s swc-loader config (ADR-1/ADR-4).
- **TDD:** `tests/unit/controller-swc-transform.test.ts` — transforming a controller source with `@Body(z…)` + `@Param('id')` yields code where `walkControllerMetadata` on the loaded module returns the route + `bodySchema` (i.e. the transform enabled the metadata that plain esbuild would drop). A non-controller `id` returns identity (untouched). RED first.
- **Failure scenarios (external tooling):** `@swc/core` missing → the transform throws a clear DX error naming `@swc/core` (mirror swc-loader.ts:124), not a cryptic esbuild failure. Test asserts the message.
- **Concurrency tests:** (none — single-threaded transform).
- **Acceptance:** controller module loaded via the transform exposes param metadata; non-controller files untouched.
- **DoD:** `npx vitest run tests/unit/controller-swc-transform.test.ts` green; new file < 200 LoC; registered in `index.ts`.

**Task 1.2 — `controller-dispatch.ts` (scan `server/controllers/` + `registerControllers` → route table + match/dispatch on the shared Web-Request path); `api-middleware` (+ start) call it after a file-route miss.**
- **Files to edit:** `packages/theo/src/server/http/controller-dispatch.ts` (NEW — owns `scanControllers(dir, loadModule)` + `matchController` + `dispatchController`), `packages/theo/src/vite-plugin/api-middleware.ts` (~5-line "no file route → try controller" branch), `packages/theo/src/cli/commands/start/*` (same branch).
- **Why this step:** runtime parity — a controller ACTUALLY SERVES in `theokit dev`/`start`. Reuses `@theokit/http`'s `registerControllers` (ADR-1) for the Web-Standard handler + `walkControllerMetadata` for routing; reuses `incomingMessageToHandlerRequest` (#119/ADR-0028 R3a) so `ctx`/plugins/CSRF/session behave identically to file routes. **Wireable:** the caller is `api-middleware.ts` (production dev request path). **ADR-5:** `generateManifest` is NOT touched — controllers are a parallel table.
- **Deep dependency analysis:** `api-middleware.ts` (391 LoC, near G6 500) gains only the small branch; all scan/match/dispatch logic is in the NEW `controller-dispatch.ts`. CSRF (`enforceCsrf`) + security headers + plugin `onRequest` already run in api-middleware BEFORE the branch, so controllers inherit them.
- **TDD:** `tests/integration/controller-serve.test.ts` — a real request to `POST /api/v2/tasks` on a controller-backed app returns 200 + the created task; `@Body(zod)` rejects a bad body with the typed 400; `GET /api/v2/tasks/:id` binds `@Param`; a routes-only app is unaffected (file routes still served; `generateManifest` output byte-identical). RED first.
- **Failure scenarios:** malformed controller (no `@Controller`) → clear scan error, not a silent skip (test). `@swc/core` absent → the Task 1.1 DX error surfaces.
- **Concurrency tests:** (none — dispatch holds no shared mutable state; the controller route table is built once at startup).
- **Acceptance:** controller routes served with CSRF/session/plugin parity; zero regression to file routes + the manifest.
- **DoD:** integration test green; new file < 300 LoC; `api-middleware.ts` stays < 500.

### Phase 2 — Typed parity (controllers in `@theo/client`) — ADR-2 checkpoint

**Task 2.1 — Emit `client.<controller>.<method>()` entries into `.theokit/client.d.ts`; wire the orphan `controllersGlob`.**
- **Files to edit:** `packages/theo/src/vite-plugin/controller-client-emit.ts` (NEW), `packages/theo/src/vite-plugin/app-typed-client.ts` (call the new emitter; the `controllersGlob` watch — currently orphan — now feeds it, reusing `scanControllers` from Task 1.2).
- **Why this step:** parity's decisive half — the user's requirement is decorators keep the typed client `route()` gives. Emits type expressions over the controller class (ADR-2), mirroring the file-based `InferResponse` model. **Wireable:** the caller is `app-typed-client.ts` (production codegen). Reuses `scanControllers` (Task 1.2) — no second scan.
- **Deep dependency analysis:** `app-typed-client.ts` (424 LoC, near budget) → the emitter is a NEW file; app-typed-client imports it + merges its entries into the same client tree; the `controllersGlob` watch now triggers a re-emit that includes controllers.
- **TDD:** `tests/unit/controller-client-emit.test.ts` — given the tasks controller, the emitted `.d.ts` contains `tasks: { get; post }`; a `tsc` type-test (`expectTypeOf` / `.test-d.ts`) asserts `client.tasks.get()` response resolves to the method return type, and (checkpoint-dependent) `client.tasks.post` body resolves to the `@Body` schema OR `unknown`. A routes-only fixture's `.theokit/client.d.ts` stays byte-identical. RED first.
- **Checkpoint (ADR-2):** run the type-test spike FIRST. If class-based body inference isn't reliably expressible, ship response-typed + body `unknown` + a follow-up issue (runtime parity from Phase 1 already ships). Record the decision in `## Unresolved Questions`.
- **Concurrency tests:** (none — build-time codegen).
- **Acceptance:** controller entries appear in the client with correct response type; file-based client entries byte-unchanged.
- **DoD:** unit + type-test green; new file < 250 LoC; `app-typed-client.ts` stays < 500.

### Phase 3 — Integration Validation (the "eat your own cooking" gate)

**Task 3.1 — End-to-end: a decorator controller served + called through the typed client, in a real fixture; showcase example.**
- **Files to edit:** `tests/integration/controller-parity.test.ts` (NEW), `fixtures/decorator-fullstack/` (add an `app/` + `theo.config` so it's a real theokit app, OR a new minimal fixture), optional `apps/showcase` variant.
- **Why this step:** the Goal's single metric. Proves the full chain: scan → swc → serve → typed client → call.
- **TDD:** boot the fixture through the theokit dev/build path; assert (a) `GET /api/v2/tasks` served 200, (b) `.theokit/client.d.ts` has the `tasks` entry, (c) a `tsc` type-test over `client.tasks.get()` resolves the response type.
- **Failure scenarios:** malformed controller (missing `@Controller`) → clear scan error, not a silent skip; `@swc/core` absent → DX error.
- **DoD:** full suite green (`vitest run tests/`), `tsc --noEmit` clean, `eslint --max-warnings=0`, changeset (`minor`) added, ADR-0057 written, CHANGELOG via changeset.

## Coverage Matrix

| Requirement (from #122 / Goal) | Task(s) |
|---|---|
| swc compile controllers in dev (param decorators) | 1.1 |
| Scan `server/controllers/` (`scanControllers`) | 1.2 |
| Serve controllers in `theokit dev`/`start` (runtime parity, reuse `registerControllers`) | 1.2 |
| CSRF/session/plugin parity with file routes (#119/ADR-0028) | 1.2 |
| `generateManifest` untouched → zero adapter ripple (ADR-5) | 1.2 |
| Typed-client entries for controllers (`@theo/client`) | 2.1 |
| Request/response inference from classes (ADR-2 + checkpoint) | 2.1 |
| Wire (not orphan) the `controllersGlob` watch | 2.1 |
| Zero regression to file-based routes + typed client | 1.2, 2.1, 3.1 |
| End-to-end parity proof | 3.1 |

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Class-based body/param inference may not be expressible as a type expression (`@Body('key')`, untyped params) | HIGH | ADR-2 checkpoint spike FIRST; fall back to response-typed + body `unknown` + follow-up; runtime parity (Phase 1) ships regardless | plan author |
| swc-in-Vite adds a compile path + `@swc/core` requirement | MEDIUM | Scope transform to `controllers/**` (ADR-4); clear DX error when swc missing; zero impact on non-decorator apps | plan author |
| G6: `api-middleware.ts` (391) / `app-typed-client.ts` (424) near 500 BLOCK | MEDIUM | All new logic in NEW files (ADR-3); the two files gain only a small call site each | plan author |
| Two decorator engines drift (`@theokit/http` vs a `theo` reader) | MEDIUM | ADR-1: reuse `walkControllerMetadata` + `registerControllers`; never reimplement | plan author |
| Deploy adapters (Vercel/CF/…) do not serve controllers until separately wired (ADR-5 keeps controllers out of the shared manifest) | LOW | Documented follow-up; dev/start parity ships now; a routes-only app + all adapters are byte-unaffected (regression test) | plan author |

## Unresolved Questions

- Q1: Body/param type inference from decorated classes — resolved at Phase 2 (Task 2.1) by a spike; the checkpoint (ADR-2) picks full-inference vs response-only fallback. Not blocking runtime parity.
- Q2: Guards/interceptors (`@UseGuards`/`@UseInterceptors`) in the app path — out of scope here (the patterns skill's guards→middleware pattern maps them to `defineMiddleware`; wiring that into the app dispatch is a follow-up). Controllers here support routing + `@Body`/`@Param`/`@Query` + CSRF/session; guards/interceptors deferred with an explicit note.
- Q3: Deploy adapters serving controllers — this plan ships controllers in `dev`/`start` only (ADR-5). Adapter (Vercel/CF/…) emission is a tracked follow-up; the parallel path keeps adapters byte-unaffected meanwhile.

## Failure scenarios

- **`@swc/core` missing** — the Task 1.1 Vite transform throws a DX error naming `@swc/core` (test asserts message); not an esbuild crash.
- **Malformed controller** (no `@Controller`, or a method with no HTTP decorator) — `scanControllers` (Task 1.2) reports a clear error, not a silent skip (test).
- **`@Body()` without schema and without `emitDecoratorMetadata`** — mirror `walk-metadata.ts:74` WARN; validation skipped with a documented warning (D-2).

## Global DoD

- All tasks' tests green; `tsc --noEmit` clean; `eslint packages/ --max-warnings=0`.
- New files < 500 LoC (G6); `api-middleware.ts` / `app-typed-client.ts` stay < 500.
- Zero regression: full `tests/` suite green (3815 baseline) + a routes-only fixture's `.theokit/client.d.ts` byte-unchanged.
- ADR-0057 written; changeset (`minor`) added; #122 referenced.
- Respects ADR-0028 R3a / #119 (Web Request), `type-safety.md` (Zod SSoT / no `any` in prod), Rule 9 (reuse `@theokit/http`).
