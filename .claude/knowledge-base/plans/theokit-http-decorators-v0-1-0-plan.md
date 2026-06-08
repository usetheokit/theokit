---
slug: theokit-http-decorators-v0-1-0
created_at: 2026-06-08
goal: Ship a new `@theokit/http-decorators` package at v0.1.0 that bridges NestJS-style decorators to TheoKit's `defineRoute` + `defineMiddleware` via metadata-walk emission, with zero changes to TheoKit core and a Vitest pass for every adopted Pattern (D1-D6) from the registered patterns skill.
---

# Plan: `@theokit/http-decorators` v0.1.0 — NestJS decorator bridge over `defineRoute`

> **Version 1.1** (2026-06-08) — Absorbed 5 MUST FIX items from edge-case review `theokit-http-decorators-v0-1-0-edge-cases-2026-06-08.md`: EC-1 mount mechanism (NEW ADR D7 — Vite plugin writes generated route files to gitignored `server/routes/__decorated__/`), EC-2 missing @Controller throws (T3.2), EC-3 path normalization in joinPath (T3.2), EC-4 missing emitDecoratorMetadata throws (T3.2), EC-5 duplicate controller dedup + warn (T3.3). Plus 6 SHOULD TEST + 3 DOCUMENT items folded into respective tasks. Plus EC-15 CLI help string fix in T5.1.
>
> **Version 1.0** — Ship a new opt-in package `@theokit/http-decorators` that lets NestJS-migrating teams write `@Controller`/`@Get`/`@Body`/`@UseGuards` decorators while the runtime translates them at build-time / startup-time into TheoKit's existing `defineRoute` + `defineMiddleware` factory contracts. Zero changes to TheoKit core (`packages/theo/src/server/define/define-route.ts`, `packages/theo/src/core/contracts/route-config.ts`); the package consumes only the public `theokit/server` barrel per Pattern D6. Decision provenance comes from the registered patterns skill `theokit-http-decorators-pattern-from-nestjs-patterns` (6 Patterns D1-D6 + 9 Recommendations + 13 key citations from blueprint scored SHIPPABLE_WITH_CAVEATS 89.0).

## Goal

> Enable NestJS-migrating TheoKit consumers to author HTTP routes with `@Controller(prefix)` + `@Get`/`@Post`/`@Body`/`@Param`/`@UseGuards`/`@UseInterceptors` decorators on a class so that the equivalent `defineRoute({...})` + `defineMiddleware(...)` calls are emitted automatically at startup, measured by `pnpm --filter @theokit/http-decorators test` returning exit code 0 with ≥ 1 contract test per Pattern D1-D6 (≥ 6 distinct passing test files) AND a Pattern-2 boundary smoke (`startDevServer` + native `fetch`) PASS against a fixture controller in `fixtures/http-decorators-basic/`.

## Context

The macro [`../../../CLAUDE.md` § "Backend DX packages"](../../../CLAUDE.md) declares `@theokit/http-decorators` as P3 (after P2 `@theokit/orm@0.1.0-next.1` shipped 2026-06-01). The user invoked `/discover-plan` with the canonical NestJS Controllers chapter as the spec input (iter 79, 2026-06-07). The cycle-discover chain ran end-to-end and registered the patterns skill on 2026-06-08 (commits `3775c4c..284ebed`, full chain in `.claude/knowledge-base/reviews/skill-register-theokit-http-decorators-pattern-from-nestjs-patterns-2026-06-08.md`).

The blueprint scored SHIPPABLE_WITH_CAVEATS (89/100; only cap was `soft_floor_citation_density_low`) with 16 verified citations / 0 fabricated. Six ADRs (D1-D6) are locked design decisions that THIS plan adopts verbatim; no re-derivation is permitted without an ADR override per `/to-plan` quality rule #4.

The package fills the "NestJS-equivalent backend DX" slot that currently has `@theokit/di` (DI container) and `@theokit/orm` (Repository pattern) shipped but no HTTP decorator surface. v0.1.0 is opt-in: non-opt-in consumers pay 0KB bundle cost; opt-in consumers add ~8-13KB (`reflect-metadata` ~3KB + new package ~5-10KB).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/theo/src/server/define/define-route.ts` | 24 | `29b4bcd` (2026-05-31) | Identity factory `defineRoute<TQuery,TBody,TParams,TCtx,TResponse>(config) => config` enabling TS inference over RouteConfig | **READ-ONLY in this plan.** Must remain the public `defineRoute` consumed by the bridge via `import { defineRoute } from 'theokit/server'`. Zero edits per Pattern D6. |
| `packages/theo/src/server/define/define-middleware.ts` | 12 | `e761aac` (2026-05-25) | `defineMiddleware(handler)` factory + `MiddlewareHandler = (request, next) => Response \| Promise<Response>` Chain of Responsibility shape | **READ-ONLY in this plan.** Pattern D3 maps `@UseGuards`/`@UseInterceptors` to wraps of this signature. |
| `packages/theo/src/core/contracts/route-config.ts` | 45 | `29b4bcd` (2026-05-31) | `RouteConfig<TQuery,TBody,TParams,TCtx,TResponse>` 5-arity interface with optional Zod schemas + handler | **READ-ONLY in this plan.** Bridge consumes the type via `theokit/server` barrel; `core/contracts/<file>.ts` is the canonical home for shared types per `architecture.md` v3.1 INVARIANT #3 exception. |
| `packages/theo/src/server/index.ts` | 134 | `45b1892` (2026-06-06) | Public `theokit/server` barrel re-exporting `define/*` + `http/*` + `scan/*` etc. | **READ-ONLY in this plan.** Already exposes `defineRoute` + `defineMiddleware` via `export * from './define/index.js'` (line 54). Pattern D6 requires zero new exports from this file. |
| `packages/theo/src/cli/commands/generate.ts` | 291 | `4e44ddf` (2026-06-01) | `theokit generate {route,action,page,ws} <name>` CLI command with inline template functions | Must add ONE entry to `VALID_TYPES` (`route, action, page, ws, controller`) + ONE switch case in `resolveTemplate()` (line 125) + ONE new `generateControllerTemplate(name)` function mirroring `generateRouteTemplate` pattern (line 85). Existing 4 verbs unchanged. |
| `packages/theo/src/cli/index.ts` | (existing) | `45b1892` (2026-06-06) | CLI dispatcher entry — declares the `generate <type> <name>` command and its help text at line 52 | v1.1 EC-15: line 52 help string `'Generate a route, action, page, or ws endpoint'` must become `'Generate a route, action, page, ws, or controller endpoint'`. Dispatch logic at line 55-56 unchanged (passes `<type>` through generically). |
| `packages/http-decorators/package.json` (NEW) | 0 | — | (to be created) | — |
| `packages/http-decorators/tsconfig.json` (NEW) | 0 | — | (to be created) | — |
| `packages/http-decorators/src/index.ts` (NEW) | 0 | — | (to be created) — public barrel | — |
| `packages/http-decorators/src/metadata/keys.ts` (NEW) | 0 | — | (to be created) — `reflect-metadata` namespace constants | — |
| `packages/http-decorators/src/metadata/storage.ts` (NEW) | 0 | — | (to be created) — `defineMetadata`/`getMetadata` thin wrappers | — |
| `packages/http-decorators/src/decorators/controller.ts` (NEW) | 0 | — | (to be created) — `@Controller(prefix?)` class decorator | — |
| `packages/http-decorators/src/decorators/methods.ts` (NEW) | 0 | — | (to be created) — `@Get/@Post/@Put/@Patch/@Delete/@Options/@Head/@All` method decorators | — |
| `packages/http-decorators/src/decorators/params.ts` (NEW) | 0 | — | (to be created) — `@Req/@Res/@Body/@Param/@Query/@Headers/@Session/@Ip/@HostParam` parameter decorators | — |
| `packages/http-decorators/src/decorators/response.ts` (NEW) | 0 | — | (to be created) — `@HttpCode/@Header/@Redirect` response-shape decorators | — |
| `packages/http-decorators/src/decorators/middleware.ts` (NEW) | 0 | — | (to be created) — `@UseGuards/@UseInterceptors` middleware-binding decorators | — |
| `packages/http-decorators/src/bridge/walk-metadata.ts` (NEW) | 0 | — | (to be created) — reads `reflect-metadata` per class, emits `defineRoute` config + `defineMiddleware` wrap chain | — |
| `packages/http-decorators/src/bridge/register-controllers.ts` (NEW) | 0 | — | (to be created) — public `registerControllers([Controller1, Controller2])` API | — |
| `packages/http-decorators/src/bridge/dto-zod.ts` (NEW) | 0 | — | (to be created) — resolves `static schema` Zod on DTO class per Pattern D2 | — |
| `packages/http-decorators/src/bridge/errors.ts` (NEW — v1.1 EC-2/EC-4) | 0 | — | (to be created) — `HttpDecoratorsConfigError` typed error class with actionable migration hints | — |
| `packages/http-decorators/src/vite/plugin.ts` (NEW — v1.1 ADR D7) | 0 | — | (to be created) — Vite plugin `decoratorsBridgePlugin()` that scans `server/controllers/**/*.ts` and writes generated route files to `server/routes/__decorated__/` at dev-start + build-start | — |
| `packages/http-decorators/src/vite/emit-route-file.ts` (NEW — v1.1 ADR D7) | 0 | — | (to be created) — given a `WalkResult`, emits TypeScript source for a single `server/routes/__decorated__/{...}.ts` file (named-export-per-verb form: `export const GET = defineRoute({...})`) | — |
| `packages/http-decorators/tests/contract/*.test.ts` (NEW × 6) | 0 | — | (to be created) — ONE contract test per Pattern D1-D6 | — |
| `packages/http-decorators/tests/integration/basic-controller.test.ts` (NEW) | 0 | — | (to be created) — Pattern 2 boundary smoke using `startDevServer` + native `fetch` per Pattern D4 | — |
| `fixtures/http-decorators-basic/` (NEW dir) | 0 | — | (to be created) — minimal fixture project with a decorated controller for the integration test | — |
| `packages/theo/src/cli/commands/generate.test.ts` | (existing) | — | Existing generate tests | Add 3 RED tests for the new `controller` verb (created/invalid_name/co-existence with the 4 existing verbs). |

Every file listed in any `#### Files to edit` block below MUST appear in this table.

### Current callers / dependents

For every public symbol the plan consumes (read-only) or modifies:

- **Symbol:** `defineRoute` in `packages/theo/src/server/define/define-route.ts:14`
- **Callers (production):** `examples/full-stack-agent/server/routes/*.ts`, `fixtures/template-default/server/routes/*.ts`, `dogfood-app/server/routes/*.ts`, and ~40 other route files across fixtures + examples (per `grep -rln 'defineRoute' --include='*.ts' fixtures/ examples/ dogfood-app/`).
- **Callers (tests):** `tests/unit/define-route.test.ts`, `packages/theo/src/server/define/define-route.test.ts`, ~20 other test files.
- **External (public API consumed by other repos):** YES — `defineRoute` is the canonical Backend DX surface of TheoKit since 0.1.0; consumer apps depend on it.
- **Bridge impact:** the bridge produces NEW `defineRoute(...)` calls per decorated class method. Existing callers unaffected (zero-cost when not opting in).

- **Symbol:** `defineMiddleware` in `packages/theo/src/server/define/define-middleware.ts:8`
- **Callers (production):** `dogfood-app/server/middleware.ts`, `fixtures/*/server/middleware.ts`, ~10 production middleware files.
- **Callers (tests):** `tests/integration/middleware-runner.test.ts`, `packages/theo/src/server/http/middleware-runner.test.ts`.
- **External:** YES — public Backend DX surface.
- **Bridge impact:** the bridge wraps `defineMiddleware` per Guard/Interceptor binding. Existing callers unaffected.

- **Symbol:** `VALID_TYPES` in `packages/theo/src/cli/commands/generate.ts:8`
- **Callers (production):** `packages/theo/src/cli/commands/generate.ts` itself (line 144 default branch); `packages/theo/src/cli/router.ts` (CLI dispatcher); `theokit generate --help` output.
- **Callers (tests):** `packages/theo/src/cli/commands/generate.test.ts` (existing test parametrization).
- **External:** indirect — `theokit generate <verb>` CLI surface is documented in README and consumer guides.
- **Bridge impact:** add ONE entry `'controller'` to the const tuple; existing 4 verbs unchanged. New verb requires corresponding switch case + template function.

### Domain glossary

- **`defineRoute`** — TheoKit's identity-function factory that takes a 5-arity `RouteConfig` (query/body/params/ctx/response Zod-typed shape + handler) and returns it for TS inference. The route file's HTTP method + path is derived from filename + named export (`export const POST = defineRoute({...})` in `server/routes/cats/index.ts`).
- **`defineMiddleware`** — TheoKit's identity-function factory for the Chain of Responsibility middleware pattern with `(request, next) => Response | Promise<Response>` shape. Short-circuit (early return) gives Guard semantics; `await next(request)` + transform gives Interceptor semantics.
- **`RouteConfig`** — Type contract in `packages/theo/src/core/contracts/route-config.ts:14-40` exposing `{query, body, params, status, csrf, handler}` fields. Bridge produces config objects matching this shape.
- **`reflect-metadata`** — npm package (`^0.2.2`) implementing the TC39 Metadata Reflection API. Provides `Reflect.defineMetadata(key, value, target, propertyKey?)` / `Reflect.getMetadata(...)`. Required by Legacy decorators (`experimentalDecorators` + `emitDecoratorMetadata`) for runtime parameter-type emission via the `design:paramtypes` metadata key.
- **Legacy decorators** — Pre-TC39 stage-3 TypeScript decorator implementation, enabled via `experimentalDecorators: true` + `emitDecoratorMetadata: true` in `tsconfig.json`. NestJS uses Legacy. Required for `@Body() body: ClassName` parameter-type injection (Stage-3 deliberately excludes runtime type emit).
- **Stage-3 decorators** — TC39 native TypeScript 5.0+ decorators. Do NOT support `emitDecoratorMetadata`. Deferred to v0.2.0+ per Pattern D1.
- **DTO** — Data Transfer Object class used as a typed input contract for an HTTP handler. In NestJS, validated via `class-validator`. In TheoKit per Pattern D2, validated via `static schema = z.object({...})` Zod attached to the class.
- **Pattern 2 (test harness)** — TheoKit integration test pattern using `startDevServer(fixtureDir, { port: 0 })` + native `fetch(http://localhost:${port}/...)`. Reused per Pattern D4; no new test infrastructure shipped.
- **Bridge / metadata-walk** — Runtime mechanism that reads decorator-attached `reflect-metadata` per controller class, generates an equivalent `defineRoute(...)` config per method, and registers it with TheoKit's route registry at startup. Pattern D3 also wraps Guards/Interceptors into `defineMiddleware` calls during the same walk.

### Architecture boundaries affected

Per `rules/architecture.md` v3.1 Module Map:

- **NEW package `packages/http-decorators/`** sits OUTSIDE the 12 modules under `packages/theo/src/`. It is a **sibling consumer** of `packages/theo` analogous to how `packages/create-theo` sits outside the graph. It does NOT participate in the dependency-cruiser rules of `packages/theo/src/` because it lives in a separate workspace package.
- **Pattern D6 enforces** `import { defineRoute, defineMiddleware } from 'theokit/server'` — public barrel ONLY, never `theokit/server/define/define-route.js` deep import. This respects `architecture.md` v3.1 INVARIANT #3 ("Public API only flows through barrels") despite the new package being out-of-graph.
- The `theokit/server` barrel at `packages/theo/src/server/index.ts:54` already exposes `defineRoute` + `defineMiddleware` via `export * from './define/index.js'`. **Zero new exports required.**
- The `packages/theo/src/cli/commands/generate.ts` extension (Pattern D5) stays INSIDE the `cli/` module, which is allowed to depend on every other module per the v3 graph. The new template function emits a FILE that imports from `@theokit/http-decorators`, but the CLI itself does NOT import or link the new package at generate-time (file emission only) — preserves the architectural decoupling per blueprint's "minor coupling is acceptable" framing.

## Prior Art & Related Work

- **Internal blueprint:** `.claude/knowledge-base/discoveries/blueprints/theokit-http-decorators-pattern-from-nestjs-blueprint.md` (verdict SHIPPABLE_WITH_CAVEATS 89.0) — the spec source. Cited throughout the ADRs as `Blueprint §"Coverage Corner N"` / `Blueprint §"ADR Dn"`.
- **Patterns skill:** `.claude/skills/theokit-http-decorators-pattern-from-nestjs-patterns/SKILL.md` — promoted to first-class 2026-06-08 (audit at `.claude/knowledge-base/reviews/skill-register-theokit-http-decorators-pattern-from-nestjs-patterns-2026-06-08.md`). This plan adopts all 6 Patterns D1-D6 verbatim. Any deviation requires an override ADR per `/to-plan` Step 0 contract; this plan deviates ZERO times.
- **Reference projects** (cited in blueprint, verified):
  - `.claude/knowledge-base/references/fastify/lib/handle-request.js:20` — Fastify dispatch comparison (Pattern D6 imperative-handler shape that TheoKit follows).
  - `.claude/knowledge-base/references/fastify/lib/route.js:120` — `router.lookup.bind(router)` route registration comparison.
  - `.claude/knowledge-base/references/fastify/lib/decorate.js:77` — runtime decoration API contrast (Fastify decorates INSTANCES; NestJS/this-package decorate CLASSES).
- **External literature:**
  - NestJS Controllers chapter (user-pasted spec in `/discover-plan` invocation iter 79) — canonical decorator surface to mirror.
  - TC39 Decorators proposal (Stage-3, https://github.com/tc39/proposal-decorators) — for Pattern D1's "deferred to v0.2.0" rationale.
  - reflect-metadata npm package (https://www.npmjs.com/package/reflect-metadata) — peer dep per Pattern D1.

## Objective

- [ ] Sub-goal 1 — `@theokit/http-decorators` package scaffolded at `packages/http-decorators/` with `experimentalDecorators` + `emitDecoratorMetadata` tsconfig (Pattern D1). Builds via `pnpm --filter @theokit/http-decorators build` exit 0.
- [ ] Sub-goal 2 — `@Controller(prefix?)` + 8 HTTP-verb method decorators (`@Get/@Post/@Put/@Patch/@Delete/@Options/@Head/@All`) implemented + tested per Recommendation 1 + 2.
- [ ] Sub-goal 3 — 9 parameter decorators (`@Req/@Res/@Body/@Param/@Query/@Headers/@Session/@Ip/@HostParam`) implemented + tested per Recommendation 3.
- [ ] Sub-goal 4 — 3 response-shape decorators (`@HttpCode/@Header/@Redirect`) implemented + tested per Recommendation 4.
- [ ] Sub-goal 5 — DTO ↔ Zod bridge (`static schema` convention) implemented per Pattern D2 + Recommendation 5. Class-validator path explicitly NOT implemented (delegated to future `@theokit/http-decorators-class-validator-codemod` separate package).
- [ ] Sub-goal 6 — `@UseGuards` + `@UseInterceptors` translate to `defineMiddleware` wraps at metadata-walk time per Pattern D3 + Recommendation 6.
- [ ] Sub-goal 7 — `theokit generate controller <name>` CLI verb shipped via single `VALID_TYPES` extension + one template function per Pattern D5 + Recommendation 7.
- [ ] Sub-goal 8 — Integration test using existing TheoKit Pattern 2 (`startDevServer` + native `fetch`) PASSES against `fixtures/http-decorators-basic/` per Pattern D4 + Recommendation 8.
- [ ] Sub-goal 9 — Zero deep imports — `import { defineRoute, defineMiddleware } from 'theokit/server'` only. Enforced by a `tests/contract/no-deep-imports.test.ts` per Pattern D6 + Recommendation 9.
- [ ] Sub-goal 10 (v1.1 — ADR D7) — `decoratorsBridgePlugin()` Vite plugin emits route files to `server/routes/__decorated__/`, auto-writes `.gitignore`, and `scanServerRoutes` picks them up. Verified end-to-end by T-final.2 round-trip test. Resolves EC-1 mount-mechanism gap.

## ADRs

### D1 — Ship Legacy decorators (`experimentalDecorators` + `emitDecoratorMetadata`) in the new package's own tsconfig; defer TC39 Stage-3 to v0.2.0+

**Decision:** Create `packages/http-decorators/tsconfig.json` with `experimentalDecorators: true` + `emitDecoratorMetadata: true`. Declare `reflect-metadata@^0.2.2` as required peer dependency. Consumer apps that opt in add the same 2 flags to their `tsconfig.json`. TheoKit core's `tsconfig.json` and root `tsconfig.json` remain decorator-free (per Baseline verified iter 2026-06-07).

**Rationale:** Adopts Pattern D1 from skill `theokit-http-decorators-pattern-from-nestjs-patterns`. Honors `.claude/rules/architecture.md` v3.1 (core remains decorator-free; new package owns its own boundary) AND `.claude/rules/type-safety.md` ("Required Patterns: strict: true in all tsconfig.json files" — Legacy decorators don't conflict with `strict: true`). Per blueprint Q5 § "Stage-3 vs Legacy decorators" table: Stage-3 doesn't support `emitDecoratorMetadata` → blocks `@Body() body: CreateCatDto` runtime type injection, which is the core NestJS migration ergonomic.

**Alternatives considered:**
- (a) Stage-3 only — REJECTED: doesn't support runtime type emit; blocks `@Body() body: ClassName` pattern that drives 80% of NestJS migration value.
- (b) Dual-mode (Legacy + Stage-3) — REJECTED: doubles surface area; doubles tests; v0.2.0+ can revisit when TC39 + TS support stabilize.

**Consequences:** Consumer-app tsconfig delta = 2 lines. `reflect-metadata` ~3KB gzipped added to opt-in consumers. Build-time tsc with `emitDecoratorMetadata: true` adds ~5-15% compile time per Microsoft TypeScript perf docs (acceptable for opt-in). Non-opt-in consumers pay 0KB.

### D2 — Require explicit Zod schema attached to DTO class via `static schema` convention (NOT auto-bridge from class-validator)

**Decision:** v0.1.0 requires users to attach `static schema = z.object({...})` on every DTO class consumed by `@Body()` / `@Query()` / `@Param()`. Bridge reads `DtoClass.schema` at metadata-walk time and feeds it to `defineRoute({body, query, params})`. Class-validator decorators NOT supported at runtime. An OPTIONAL `@theokit/http-decorators-class-validator-codemod` SEPARATE package (NOT shipped in v0.1.0) handles ~80% of class-validator → Zod migration mechanically as a one-time codemod.

**Rationale:** Adopts Pattern D2 from the patterns skill. Preserves `.claude/rules/type-safety.md` "Zod is the Single Source of Truth" invariant — Zod schema remains the canonical source, types derived via `z.infer<typeof schema>`, OpenAPI generated from same schema, runtime validation from same schema. An auto-bridge from class-validator → Zod would (i) lose the SSoT invariant; (ii) break on `@Matches` regex modifiers vs Zod regex semantics; (iii) lose OpenAPI generation precision (the G2 plugin needs pure Zod schemas); (iv) require `class-transformer` for `@ValidateNested` instance hydration which leaks class instances back into Zod-typed code.

**Alternatives considered:**
- (a) Auto-bridge DTO class → Zod schema at runtime via `reflect-metadata` + class-validator decorator introspection — REJECTED: fails (i)-(iv) above; blueprint Q2 § "Honest limitations of any DTO↔Zod bridge" enumerated 4 specific failure modes.
- (c) Skip Zod entirely; ship only class-validator support — REJECTED: breaks TheoKit's existing OpenAPI emit + tests + type-inference contract.

**Consequences:** Higher migration friction for NestJS teams (1-time codemod cost when codemod package ships v0.2.0+). Preserved type-safety invariant. OpenAPI precision retained. Documentation MUST surface the `static schema` convention prominently.

### D3 — `@UseGuards` + `@UseInterceptors` both translate to `defineMiddleware` wraps; `@Catch` Filter class deferred to v0.2.0+

**Decision:** At metadata-walk time, collect all `@UseGuards(GuardClass)` and `@UseInterceptors(InterceptorClass)` per route method. Emit a single `defineMiddleware` wrap per route that runs Guards first (short-circuit on `canActivate=false` with documented HTTP-status mapping) then Interceptors (await `next(request)` + transform Response). `@Catch(HttpException)` Filter class is deferred to v0.2.0+ follow-up `/discover-plan`.

**Rationale:** Adopts Pattern D3 from the patterns skill. TheoKit's `MiddlewareHandler` shape `(request, next) => Response | Promise<Response>` (per `packages/theo/src/server/define/define-middleware.ts:1-12`) SUPERSETS both NestJS concepts:
- Return `Response` early → Guard semantics (short-circuit).
- `await next(request)` then decorate the result → Interceptor semantics (wrap).

NestJS's separation of Guards vs Interceptors is implementation-detail of its RxJS-Observable pipeline; TheoKit's unified Chain of Responsibility (`middleware-runner.ts:72`) doesn't need the separation. Pipes' validation role is already covered by Zod in `defineRoute({body, query, params})` — no separate Pipe surface needed.

**Alternatives considered:**
- (a) Ship full Guards/Interceptors/Filters/Pipes as first-class v0.1.0 decorators — REJECTED: violates scope discipline; each deserves its own discovery cycle.
- (c) Skip Guards entirely in v0.1.0 — REJECTED: breaks "NestJS-compatible enough" target for migration teams; Guards cover auth which is table-stakes.

**Consequences:** v0.1.0 covers auth + logging use cases; v0.2.0 follow-up plans Filters (error handling decorators). RxJS is an OPTIONAL peer dep — Interceptor classes returning Observable are supported alongside Promise-returning Interceptors via a thin wrapper.

### D4 — Reuse existing TheoKit Pattern 2 test harness (`startDevServer` + native `fetch`); ship ZERO new test infrastructure

**Decision:** v0.1.0 ships no new test package. Users test decorated controllers via the existing TheoKit Pattern 2: `startDevServer(fixtureDir, { port: 0 })` + native `fetch(http://localhost:${port}/...)` — identical to how `defineRoute`-authored routes are tested today. The bridge layer itself ships its own contract tests at `packages/http-decorators/tests/contract/*.test.ts` (one per Pattern D1-D6).

**Rationale:** Adopts Pattern D4 from the patterns skill. Per the CLAUDE.md Unbreakable Rule 9 ("Don't Reinvent the Wheel") — `supertest` adds a dependency with no benefit over native `fetch`. The existing Pattern 2 already provides real HTTP server boot, fluent assertion via `expect(res.status).toBe(200)` + `await res.json()`, per-test fixture isolation via `fixtures/{name}/`, and `server.close()` cleanup in `afterAll`. A "TestingModule" equivalent is unnecessary because decorator-bridge generates real `defineRoute(...)` files at startup — test those directly.

**Alternatives considered:**
- (a) Ship `supertest`-equivalent in `@theokit/http-decorators-testing` — REJECTED: adds dep + duplicates existing functionality.
- (c) Mock a `Test.createTestingModule` API — REJECTED: fakes NestJS surface; users get false sense of compatibility, then break when real apps differ.

**Consequences:** Migration guide ships with v0.1.0 documenting `Test.createTestingModule → startDevServer` + `supertest → fetch` translation. Users keep their existing vitest setup. Zero new test dependencies for consumers.

### D5 — Extend `theokit generate` with `controller` verb (single template addition, NOT a separate CLI package)

**Decision:** Add the literal string `'controller'` to the `VALID_TYPES` const tuple in `packages/theo/src/cli/commands/generate.ts:8` (becomes `['route', 'action', 'page', 'ws', 'controller'] as const`). Add ONE switch case in `resolveTemplate()` (line 125) mapping `'controller'` → `server/controllers/{name}.controller.ts`. Add ONE inline `generateControllerTemplate(name): string` function mirroring the existing `generateRouteTemplate(name)` at line 85. No separate `@theokit/http-decorators-cli` package.

**Rationale:** Adopts Pattern D5 from the patterns skill. The addition is ~30 LoC mirroring an existing established pattern in the same file. Discoverable via `theokit generate --help` alongside existing verbs. The generated file imports from `@theokit/http-decorators` but doesn't require it at generate-time — file emission only, so core's `theokit` CLI doesn't link any runtime code from the new package. The minor coupling (core's `VALID_TYPES` array knows the literal string `'controller'`) is text-only, no module link.

**Alternatives considered:**
- (a) Separate `@theokit/http-decorators-cli` package — REJECTED: duplicates template-resolution + validation infra already in `generate.ts`; less discoverable (extra install).
- (c) Defer CLI extension to v0.2.0 — REJECTED: leaves NestJS migrants without scaffold parity at first release; bad first impression.

**Consequences:** Adds 1 CLI verb. `nest g resource` (CRUD scaffold) deferred to v0.2.0+ since it needs DTO bridge (D2) + Guards (D3) ergonomics validated against real consumers first.

### D6 — Cross-package imports go through `theokit/server` barrel ONLY (Architecture INVARIANT #3 respected)

**Decision:** All `@theokit/http-decorators` bridge code uses `import { defineRoute, defineMiddleware } from 'theokit/server'` — NEVER deep imports like `theokit/server/define/define-route.js`. The new package is a sibling consumer of `theokit/server`, not a privileged insider. Enforced by a `tests/contract/no-deep-imports.test.ts` contract test that greps every `.ts` under `packages/http-decorators/src/` for forbidden import patterns.

**Rationale:** Adopts Pattern D6 from the patterns skill. Per `.claude/rules/architecture.md` v3.1 INVARIANT #3 "Public API only flows through barrels". Deep imports couple the bridge to TheoKit's internal layout — every internal refactor risks breaking the bridge. The existing barrel (`packages/theo/src/server/index.ts:54` `export * from './define/index.js'`) already exposes everything the bridge needs.

**Alternatives considered:**
- (a) Add `@theokit/http-decorators` as a workspace internal (move under `packages/theo/src/`) — REJECTED: would couple it to internal layout and complicate the opt-in story (consumers would always pay the bundle cost).
- (c) Add a new internal `theokit/server/internals` sub-barrel — REJECTED: proliferates barrels; defeats INVARIANT #3 purpose.

**Consequences:** Bridge code is robust against TheoKit internal refactors. Bridge layer's contract tests verify barrel-import shape (catches accidental deep imports during development).

### D7 — Mount mechanism: Vite plugin writes generated route files to gitignored `server/routes/__decorated__/` (resolves edge-case-review EC-1)

**Decision:** v0.1.0 ships `@theokit/http-decorators/vite-plugin` exporting `decoratorsBridgePlugin()` that runs at Vite `configResolved` + `buildStart` hooks. The plugin (i) scans `server/controllers/**/*.ts` via the existing TheoKit module-loader pattern; (ii) for each decorated class, calls `walkControllerMetadata` (T3.2) + `emitRouteFile` (NEW T3.5) to emit one file per route to `server/routes/__decorated__/{verb}__{path}.ts` using TheoKit's existing named-export-per-verb convention (`export const GET = defineRoute({...})`); (iii) gitignores the directory via auto-added `server/routes/__decorated__/.gitignore` on first run. The existing TheoKit scanner at `packages/theo/src/server/scan/scan.ts:102` picks up the generated files identically to hand-authored routes.

`registerControllers([...])` API is REPLACED in v1.1: the public surface is now `decoratorsBridgePlugin({ controllers: [CatsController, DogsController] })` invoked from the consumer's `vite.config.ts`. Consumers add the plugin once; the bridge handles the rest.

**Rationale:** Blueprint Q1 conclusion offered strategy (a) "emit files at build time" vs strategy (b) "register virtual routes at startup". Plan v1.0 picked (b) — edge-case-review EC-1 surfaced that strategy (b) requires a runtime route-registration API that TheoKit does NOT expose (verified via `grep` on `packages/theo/src/server/index.ts` + `packages/theo/src/server/scan/index.ts` 2026-06-08 — only `scanServerRoutes`, `matchRoute`, `compilePattern` exported). Switching to strategy (a) via Vite plugin:
- Preserves ADR D1's "zero changes to TheoKit core" claim (no `theokit/server` barrel additions, no scanner modification).
- Reuses the existing file-scan pipeline — generated files are indistinguishable from hand-authored ones at runtime.
- Aligns with TheoKit's Vite-first architecture (see `architecture.md` v3.1 § Module Map row `vite-plugin/`).
- Composes naturally with existing TheoKit Vite plugins (no plugin order conflicts since emission happens at `buildStart`, before route scanning).

**Alternatives considered:**
- (b) Add `mountVirtualRoutes(registrations)` to `theokit/server` barrel — REJECTED: requires a core change that violates ADR D1's invariant; would add a public API that exists ONLY to serve this package; bad surface stewardship.
- (c) Document `registerControllers` as returning an array the consumer hand-wires into `server/routes/_decorators.ts` re-exports — REJECTED: weakens the "automatic" promise in the Goal; consumer ergonomics suffer; defeats the migration-friendliness aim.
- (d) Write files at runtime (process start) instead of Vite hook — REJECTED: dev vs build divergence; files written at `npm start` are not present during `npm dev` first cold start; race conditions with the scanner.

**Consequences:**
- New deliverables: `packages/http-decorators/src/vite/plugin.ts` (~150 LoC) + `packages/http-decorators/src/vite/emit-route-file.ts` (~80 LoC) + a `packages/http-decorators/vite-plugin` sub-path export in `package.json`.
- Consumer `vite.config.ts` gains one line: `plugins: [theoPlugin(), decoratorsBridgePlugin({ controllers: [CatsController] })]`.
- Generated directory `server/routes/__decorated__/` is gitignored by the plugin (consumer doesn't commit generated files).
- T3.3 (registerControllers) is reframed in v1.1: the function still exists as the LOW-LEVEL API (used by the Vite plugin internally + advanced consumers who don't use Vite), but the PRIMARY consumer-facing surface is the plugin.
- New T3.5 task added in Phase 3 to ship the Vite plugin + emit-route-file helpers.
- New T-final.2 added to Final Phase: verify `server/routes/__decorated__/.gitignore` is auto-written + verify generated files are picked up by the existing scanner (round-trip integration test).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| ~8-13KB gzipped bundle delta for opt-in consumers (reflect-metadata ~3KB + new package ~5-10KB) | Low | Documented in README size table; non-opt-in consumers pay 0KB; tree-shaking validated via `pnpm validate:publint` + `pnpm validate:attw` at package level | Plan author |
| Build-time +5-15% tsc compile time when `emitDecoratorMetadata: true` is enabled in consumer tsconfig | Low | Documented in README "Performance considerations" section; opt-in only — non-opt-in consumers unaffected | Plan author |
| Migration friction for NestJS teams who relied on auto-class-validator decoration (D2 explicit Zod required) | Medium | Documentation surfaces `static schema` convention prominently with side-by-side NestJS-vs-TheoKit examples; codemod package shipped in v0.2.0 will mechanize ~80% of cases | Plan author |
| `nest g resource` CRUD scaffold not shipped in v0.1.0 (D5 deferred) | Medium | Documented in README "Roadmap" section; users compose `theokit generate controller` + `theokit generate action` manually for CRUD until v0.2.0 | Plan author |
| Stage-3 decorators excluded from v0.1.0 (D1) — Legacy decorators may eventually be deprecated by TypeScript team | Low | Pattern D1 documents the re-evaluation trigger explicitly: when TC39 advances Stage-3 metadata emit AND TS 6.x ships compatible support. Mid-2026 baseline (Legacy is stable; NestJS itself uses Legacy as of mid-2026 per blueprint Q5). | Plan author |
| Cross-repo coupling: `packages/theo/src/cli/commands/generate.ts` references the literal string `'controller'` and emits files importing `@theokit/http-decorators` | Low | The CLI does NOT link or import the package at generate-time (file emission only — `generateControllerTemplate` returns a TypeScript source string). Documented as "non-runtime coupling acceptable" in D5 Consequences. | Plan author |
| Bridge runs at startup (not build time) — first request after `pnpm dev` start may be slower as bridge walks metadata | Low | Walk is one-time per process lifetime; cached in memory. Benchmark in Integration Validation phase; if >100ms for 50-controller fixture, optimize via lazy registration. | Plan author |

## Unresolved Questions

- Q1 — Should the bridge emit `server/routes/{...}/index.ts` files at build time (file-system-routing alignment, requires Vite plugin) OR register virtual routes at startup via `registerControllers([...])` API call? Blueprint Q1 § Conclusion explicitly deferred this to "the `/to-plan @theokit/http-decorators` cycle". **Resolution in this plan:** Phase 3 ships strategy (b) `registerControllers([...])` startup API. Strategy (a) build-time emission deferred to v0.2.0+ — adds Vite plugin surface that v0.1.0 doesn't need. Documented in Phase 3 ADR-overlap section.
- Q2 — What is the exact wire format for the `canActivate(request: Request): boolean | Promise<boolean>` return-false case? NestJS throws `UnauthorizedException` → 401. **Resolution:** v0.1.0 bridge throws TheoKit's `AuthRequiredError` (from `theokit/server` barrel) which the existing error envelope translator maps to 401. Documented in Phase 4 implementation notes.
- Q3 — How does the bridge handle the same handler being decorated with both `@UseGuards(A)` AND `@UseGuards(B)` (NestJS semantics: both run, all must return true)? **Resolution:** Bridge accumulates Guards in declaration order; emits ONE middleware wrap that runs them sequentially (short-circuits on first false). Equivalent to NestJS behavior. Test covers in Phase 4.
- Q4 — Should `@HostParam` work in v0.1.0 (NestJS supports `@Controller({ host: ':account.example.com' })`)? Blueprint Recommendation 1 says YES; Q1 mapping table says "deferred — host-based routing requires adapter support". **Resolution:** v0.1.0 ships `@Controller({ host })` parsing as a no-op stored in metadata (so consumer code doesn't break) but the bridge does NOT enforce host matching (adapter doesn't expose it cleanly). Documented as "metadata captured, enforcement deferred to v0.2.0". Logged warning at startup when host is set but adapter doesn't support it.

## Dependency Graph

```
Phase 0 (Pre-flight) ──▶ Phase 1 (Foundation) ──▶ Phase 2 (Parameter + Response decorators)
                                │
                                ▼
                            Phase 3 (Bridge engine + DTO Zod + Vite plugin [T3.5 NEW v1.1])
                                │
                                ├──▶ Phase 4 (Guards/Interceptors)
                                │
                                └──▶ Phase 5 (CLI generate controller) [parallel to Phase 4]
                                │
                                ▼
                            Phase 6 (Docs + migration guide)
                                │
                                ▼
                            Final Phase: Integration Validation
                              (T-final.1 Pattern-2 boundary smoke +
                               T-final.2 round-trip mount verification [NEW v1.1])
```

Phases 4 and 5 can be implemented in parallel (no shared files). All other phases are sequential.

T3.5 (NEW v1.1 — Vite plugin) is a hard dependency of T-final.1 and T-final.2 — both integration tests require the plugin to actually mount routes for `fetch` calls to reach handlers.

---

## Phase 0: Pre-flight verification

**Objective:** Confirm the Baseline Context predictions hold at the implementation start tick.

### T0.1 — Re-verify zero decorator config + zero reflect-metadata in tree

#### Objective
Pre-flight grep proves the assumptions in Baseline Context § Files table + ADR D1 still hold at implementation start. If a sibling commit shipped reflect-metadata since the discovery cycle (2026-06-07), surface and adjust.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — runs `grep -rln 'experimentalDecorators\|emitDecoratorMetadata' packages/*/tsconfig.json` + `grep -l reflect-metadata packages/*/package.json` and writes the output to `docs/audit/http-decorators-pre-flight-{date}.md`.
2. **Why it is necessary now** — ADR D1's claim ("TheoKit core remains decorator-free; new package owns its own boundary") is THE invariant the entire plan rests on. Baseline § Files table verified iter 2026-06-07; if a parallel feature changed the state since, the plan must adjust BEFORE shipping. This is the "pre-flight audit" pattern the existing arch-gaps cycle established (see `docs/audit/g2-preflight-2026-06-02.md` for the canonical shape).

#### Evidence
- Baseline Context § Files that will be touched row 1: `packages/theo/src/server/define/define-route.ts` last touched `29b4bcd` (2026-05-31) — older than the discovery cycle, so no risk.
- Pre-validated state in blueprint § "Q5 § Pre-validated state at HEAD" — must re-verify before implementation start.

#### Files to edit
```
docs/audit/http-decorators-pre-flight-{YYYY-MM-DD}.md — NEW; one-line audit summary + grep outputs
```

#### Deep file dependency analysis
- New audit file is documentation only; no production code touched in this task.

#### Tasks
1. `grep -rln 'experimentalDecorators\|emitDecoratorMetadata' packages/*/tsconfig.json` — expect 0 hits.
2. `grep -l reflect-metadata packages/*/package.json` — expect 0 hits.
3. Write `docs/audit/http-decorators-pre-flight-{YYYY-MM-DD}.md` with both outputs + verdict.
4. If ANY hit appears, STOP and revise the plan via `/to-plan` (do NOT proceed — the assumption is invalidated).

#### TDD
```
RED:     no test (audit-only task; no production code).
GREEN:   not applicable.
VERIFY:  audit file exists with 0/0 hits documented.
```

#### Acceptance Criteria
- [ ] `docs/audit/http-decorators-pre-flight-{date}.md` exists with grep outputs + "VERDICT: pre-flight assumptions hold" line.
- [ ] If grep hits ≠ 0, plan is halted and revised.

#### DoD
- [ ] Audit file committed.
- [ ] Verdict line is "VERDICT: pre-flight assumptions hold" (otherwise plan revisits).

---

## Phase 1: Package foundation + base decorators

**Objective:** Scaffold the new package with tsconfig + `@Controller` class decorator + 8 HTTP-verb method decorators backed by `reflect-metadata`.

### T1.1 — Scaffold `packages/http-decorators/` with Legacy decorator tsconfig

#### Objective
Create the package directory, `package.json`, `tsconfig.json` (with `experimentalDecorators` + `emitDecoratorMetadata` per ADR D1), `tsup.config.ts` (ESM + d.ts emission), `vitest.config.ts` (Node env), `LICENSE` (MIT mirroring `packages/theo/LICENSE`). Empty `src/index.ts` barrel.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — creates 6 scaffold files matching the layout of existing `packages/theo/` and the sibling `@theokit/orm` package shape (per macro CLAUDE.md ecosystem map).
2. **Why it is necessary now** — every subsequent task requires the package to exist as a workspace member (`pnpm-workspace.yaml` already includes `packages/*`). ADR D1's tsconfig setup must be in place before ANY decorator code can compile.

#### Evidence
- `pnpm-workspace.yaml` line 1 `packages/*` — new package will be auto-included on next `pnpm install`.
- `packages/theo/package.json`, `packages/theo/tsconfig.json` — canonical TheoKit package shape to mirror.
- ADR D1 — tsconfig flags required.

#### Files to edit
```
packages/http-decorators/package.json (NEW) — name: "@theokit/http-decorators", version: "0.1.0-alpha.0", peerDeps: theokit + reflect-metadata
packages/http-decorators/tsconfig.json (NEW) — extends root tsconfig + experimentalDecorators: true + emitDecoratorMetadata: true
packages/http-decorators/tsup.config.ts (NEW) — ESM-only entry; d.ts emission via tsc per existing tsup pattern in other packages
packages/http-decorators/vitest.config.ts (NEW) — node env; include tests/**/*.test.ts
packages/http-decorators/LICENSE (NEW) — MIT mirroring packages/theo/LICENSE
packages/http-decorators/src/index.ts (NEW) — empty barrel; tasks below populate
packages/http-decorators/README.md (NEW) — empty stub; Phase 6 populates
```

#### Deep file dependency analysis
- New package depends on `theokit` (peer) + `reflect-metadata` (peer) + `zod` (peer, transitive via theokit).
- No production file in `packages/theo/` is modified by this task.

#### Pseudo-code / Signatures

```jsonc
// packages/http-decorators/package.json
{
  "name": "@theokit/http-decorators",
  "version": "0.1.0-alpha.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "peerDependencies": {
    "theokit": ">=0.2.0",
    "reflect-metadata": "^0.2.2",
    "zod": "^3.22.0"
  },
  "devDependencies": { "vitest": "*", "tsup": "*" },
  "scripts": { "build": "tsup && tsc -p tsconfig.dts.json", "test": "vitest run" }
}
```

```jsonc
// packages/http-decorators/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"]
}
```

#### Tasks
1. Create `packages/http-decorators/` directory.
2. Create 6 scaffold files per Files to edit.
3. Run `pnpm install` at workspace root — verify new package linked.
4. Run `pnpm --filter @theokit/http-decorators build` — expect exit 0 with empty dist (only barrel).

#### TDD
```
RED:     packages/http-decorators/tests/scaffold.test.ts — assert package.json fields (name = "@theokit/http-decorators", peerDeps include reflect-metadata + theokit + zod); assert tsconfig has experimentalDecorators=true + emitDecoratorMetadata=true.
GREEN:   Implement scaffold per Files to edit.
REFACTOR: None expected (scaffold is mechanical).
VERIFY:  pnpm --filter @theokit/http-decorators test
```

#### Acceptance Criteria
- [ ] `packages/http-decorators/package.json` exists with name `@theokit/http-decorators`, version `0.1.0-alpha.0`, peerDeps `theokit` + `reflect-metadata` + `zod`.
- [ ] `packages/http-decorators/tsconfig.json` has both decorator flags.
- [ ] `pnpm --filter @theokit/http-decorators build` exits 0.
- [ ] `pnpm --filter @theokit/http-decorators test` exits 0 with 1 scaffold test passing.
- [ ] Pass: lint — `pnpm lint` zero warnings on changed files.
- [ ] Pass: size — every changed file ≤ 500 lines (all under 50).

#### DoD
- [ ] Scaffold tests green.
- [ ] `pnpm typecheck` exit 0 across workspace.
- [ ] `pnpm lint` zero warnings.

### T1.2 — Metadata storage primitives (`reflect-metadata` thin wrappers)

#### Objective
Implement `packages/http-decorators/src/metadata/keys.ts` exporting symbol-keyed namespace constants (`CONTROLLER_PREFIX`, `ROUTE_METHODS`, `ROUTE_PARAMS`, `ROUTE_HEADERS`, `ROUTE_STATUS`, `ROUTE_REDIRECT`, `USE_GUARDS`, `USE_INTERCEPTORS`) + `metadata/storage.ts` exposing `setMeta(key, target, propertyKey?, value)` / `getMeta(key, target, propertyKey?)` thin wrappers around `Reflect.defineMetadata` / `Reflect.getMetadata`.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — centralizes all `Reflect.*Metadata` calls behind a typed facade. Every decorator (T1.4, T1.5, T2.1, T2.2, T4.1, T4.2) and the bridge (T3.1) consume this facade.
2. **Why it is necessary now** — without this layer, every decorator file would call `Reflect.defineMetadata` directly with stringly-typed keys, breeding typos and missing test coverage. ADR D6 (barrel discipline) applies internally too — single source of metadata keys.

#### Evidence
- ADR D1 — `reflect-metadata` is the required peer dep.
- Blueprint Q1 § "NestJS reflect-metadata model" — describes the metadata-writer pattern this layer implements.

#### Files to edit
```
packages/http-decorators/src/metadata/keys.ts (NEW) — symbol constants
packages/http-decorators/src/metadata/storage.ts (NEW) — setMeta/getMeta facade
packages/http-decorators/src/metadata/index.ts (NEW) — barrel
packages/http-decorators/tests/unit/metadata.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
- New files depend ONLY on `reflect-metadata` (peer). No TheoKit import yet.

#### Pseudo-code / Signatures

```typescript
// keys.ts
export const CONTROLLER_PREFIX = Symbol('theokit:http-decorators:controller-prefix')
export const ROUTE_METHODS     = Symbol('theokit:http-decorators:route-methods')
// ... etc

// storage.ts
import 'reflect-metadata'
export function setMeta<T>(key: symbol, target: object, value: T, propertyKey?: string | symbol): void {
  if (propertyKey !== undefined) Reflect.defineMetadata(key, value, target, propertyKey)
  else Reflect.defineMetadata(key, value, target)
}
export function getMeta<T>(key: symbol, target: object, propertyKey?: string | symbol): T | undefined {
  return propertyKey !== undefined
    ? Reflect.getMetadata(key, target, propertyKey)
    : Reflect.getMetadata(key, target)
}
```

#### Tasks
1. Write keys.ts with 8 symbol constants.
2. Write storage.ts with setMeta/getMeta + propertyKey handling.
3. Write barrel.
4. Write RED tests covering: roundtrip set→get; missing key returns undefined; propertyKey discrimination.

#### TDD
```
RED:     test_set_get_roundtrip — setMeta then getMeta returns same value
RED:     test_missing_key_returns_undefined
RED:     test_property_key_isolation — same key on class vs class.method are independent
RED:     test_consumer_inherits_reflect_metadata_via_package_import (EC-11) — verify storage.ts's `import 'reflect-metadata'` side-effect propagates so consumers don't need their own explicit import; assert via fresh module-load that Reflect.defineMetadata is available
GREEN:   Implement keys.ts + storage.ts.
REFACTOR: None expected.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/unit/metadata.test.ts
```

#### Acceptance Criteria
- [ ] 8 symbol constants exported from keys.ts.
- [ ] setMeta/getMeta facade typed `<T>` (no `any` in production code per `.claude/rules/type-safety.md`).
- [ ] 4 RED tests GREEN (3 original + 1 EC-11 reflect-metadata auto-import).
- [ ] Pass: size — every changed file ≤ 100 lines.

#### DoD
- [ ] Metadata layer tests green.
- [ ] Zero `any` in production code.

### T1.3 — Contract test: barrel imports only (Pattern D6)

#### Objective
Ship `packages/http-decorators/tests/contract/no-deep-imports.test.ts` that greps every `.ts` under `packages/http-decorators/src/` for forbidden import patterns (`from 'theokit/server/define/define-route'` etc.) and fails if any match. Enforces ADR D6 mechanically.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — implements the contract test that catches ADR D6 violations during development, not at PR review.
2. **Why it is necessary now** — Pattern D6 from the patterns skill explicitly says "Bridge layer's contract tests verify barrel-import shape (catches accidental deep imports during development)". Shipping the test EARLY (before any bridge code) means subsequent tasks fail-fast if they reach into TheoKit internals.

#### Evidence
- ADR D6 Consequences: "Bridge layer's contract tests verify barrel-import shape".
- Patterns skill `theokit-http-decorators-pattern-from-nestjs-patterns/SKILL.md § Pattern D6`.

#### Files to edit
```
packages/http-decorators/tests/contract/no-deep-imports.test.ts (NEW) — Vitest test using node:fs + readdirSync recursion
```

#### Deep file dependency analysis
- Test imports only `node:fs` + `node:path` + `vitest`. No production-code link.

#### Pseudo-code / Signatures

```typescript
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const FORBIDDEN_PATTERNS = [
  /from\s+['"]theokit\/server\/define\/[^'"]+['"]/,
  /from\s+['"]theokit\/server\/http\/[^'"]+['"]/,
  /from\s+['"]theokit\/server\/scan\/[^'"]+['"]/,
  /from\s+['"]theokit\/core\/[^'"]+['"]/,
  // ... etc
]

function walk(dir: string): string[] { /* recursive .ts collector */ }

describe('Pattern D6 — barrel imports only', () => {
  it('should not deep-import from theokit/server/*', () => {
    const files = walk('packages/http-decorators/src')
    const violations: { file: string; line: number; match: string }[] = []
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        for (const pat of FORBIDDEN_PATTERNS) {
          if (pat.test(line)) violations.push({ file, line: i + 1, match: line.trim() })
        }
      })
    }
    expect(violations).toEqual([])
  })
})
```

#### Tasks
1. Write the test with forbidden-pattern regexes covering every TheoKit deep-import shape.
2. Write a positive control: assert `from 'theokit/server'` (barrel) does NOT trigger a violation.

#### TDD
```
RED:     test_no_deep_imports — fail-fast if any src/**/*.ts deep-imports theokit/*. Initially GREEN (no src yet) but stays as ongoing guard.
GREEN:   Test passes because src/ has no TheoKit imports yet.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/contract/no-deep-imports.test.ts
```

#### Acceptance Criteria
- [ ] Contract test runs in CI on every PR touching `packages/http-decorators/src/`.
- [ ] At least 4 forbidden patterns covered (server/define, server/http, server/scan, core/).
- [ ] Positive control verifies `theokit/server` barrel passes.

#### DoD
- [ ] Contract test green.
- [ ] Test file ≤ 100 LoC.

### T1.4 — `@Controller(prefix?, opts?)` class decorator

#### Objective
Implement `packages/http-decorators/src/decorators/controller.ts` exporting `Controller(prefix?: string, opts?: { host?: string }): ClassDecorator`. Uses `setMeta(CONTROLLER_PREFIX, target, { prefix, host })` from T1.2's metadata facade.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — first user-visible decorator. Stores `{prefix, host}` per class.
2. **Why it is necessary now** — every HTTP-verb method decorator (T1.5) needs a class-level prefix to compose the final route path. Without `@Controller`, the bridge has nowhere to read the class-level prefix from.

#### Evidence
- Blueprint Recommendation 1: "`@Controller(prefix?, opts?)` class decorator — emits route files at build time. Supports `{ host: ':account.example.com' }`".
- Blueprint Q1 dispatch mapping table row 1.

#### Files to edit
```
packages/http-decorators/src/decorators/controller.ts (NEW) — Controller class decorator
packages/http-decorators/src/decorators/index.ts (NEW or UPDATE) — barrel
packages/http-decorators/tests/unit/controller.test.ts (NEW) — RED tests
```

#### Pseudo-code / Signatures

```typescript
import { setMeta, CONTROLLER_PREFIX } from '../metadata/index.js'

export interface ControllerOptions {
  host?: string  // Q4: captured but not enforced in v0.1.0
}

export function Controller(prefix: string = '', opts: ControllerOptions = {}): ClassDecorator {
  return (target: object) => {
    setMeta(CONTROLLER_PREFIX, target, { prefix, host: opts.host })
  }
}
```

#### Tasks
1. Write the decorator.
2. Write 4 RED tests: no-args, prefix-only, prefix+host, multiple @Controller on inheritance chain (last wins).

#### TDD
```
RED:     test_controller_no_args — @Controller() stores {prefix:'', host:undefined}
RED:     test_controller_with_prefix — @Controller('cats') stores {prefix:'cats'}
RED:     test_controller_with_host — @Controller('cats', {host:'admin'}) stores both
RED:     test_controller_inheritance_last_wins
GREEN:   Implement Controller.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/unit/controller.test.ts
```

#### Acceptance Criteria
- [ ] `@Controller()` + `@Controller('prefix')` + `@Controller('prefix', {host})` all type-check.
- [ ] 4 RED tests GREEN.
- [ ] Q4 warning log emitted at bridge time when host is set (handled in T3.1, not here — this task just stores).
- [ ] Pass: size — file ≤ 50 LoC.

#### DoD
- [ ] Controller decorator green.

### T1.5 — 8 HTTP-verb method decorators (`@Get/@Post/@Put/@Patch/@Delete/@Options/@Head/@All`)

#### Objective
Implement `packages/http-decorators/src/decorators/methods.ts` exporting 8 method decorators that each store `{verb, path}` in the `ROUTE_METHODS` metadata for the decorated method.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — provides the HTTP verb surface. Each decorator follows the same shape: `Verb(path = ''): MethodDecorator`.
2. **Why it is necessary now** — completes the class+method decorator pair required to define ANY HTTP endpoint. Phase 2's parameter decorators only make sense once methods are decorate-able.

#### Evidence
- Blueprint Recommendation 2: "HTTP-verb method decorators: `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head`, `@All` — translate to per-method `defineRoute(...)` factory calls".
- Blueprint Q1 mapping table rows 2-3.

#### Files to edit
```
packages/http-decorators/src/decorators/methods.ts (NEW) — 8 method decorators + shared factory
packages/http-decorators/src/decorators/index.ts (UPDATE) — re-export
packages/http-decorators/tests/unit/methods.test.ts (NEW) — RED tests
```

#### Pseudo-code / Signatures

```typescript
import { setMeta, getMeta, ROUTE_METHODS } from '../metadata/index.js'

export type HttpVerb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'ALL'

interface RouteMethodEntry { verb: HttpVerb; path: string; propertyKey: string | symbol }

function makeVerbDecorator(verb: HttpVerb) {
  return function (path: string = ''): MethodDecorator {
    return (target, propertyKey) => {
      const existing = getMeta<RouteMethodEntry[]>(ROUTE_METHODS, target.constructor) ?? []
      existing.push({ verb, path, propertyKey })
      setMeta(ROUTE_METHODS, target.constructor, existing)
    }
  }
}

export const Get     = makeVerbDecorator('GET')
export const Post    = makeVerbDecorator('POST')
export const Put     = makeVerbDecorator('PUT')
export const Patch   = makeVerbDecorator('PATCH')
export const Delete  = makeVerbDecorator('DELETE')
export const Options = makeVerbDecorator('OPTIONS')
export const Head    = makeVerbDecorator('HEAD')
export const All     = makeVerbDecorator('ALL')
```

#### Tasks
1. Write the factory + 8 named exports.
2. Write RED tests covering: each verb stores entry; multiple methods on same class accumulate; `@Get('breed')` stores path correctly; `@All()` stores verb 'ALL'.

#### TDD
```
RED:     test_each_verb_stores_entry (8 sub-tests, one per verb)
RED:     test_multiple_methods_accumulate — class with @Get findAll() + @Post create() stores 2 entries
RED:     test_get_with_subpath — @Get('breed') stores {path: 'breed'}
RED:     test_method_with_multiple_verb_decorators (EC-6) — Given method decorated with both @Get() AND @Post(), When walkControllerMetadata runs, Then BOTH entries register (mirror NestJS dual-route behavior)
GREEN:   Implement methods.ts.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/unit/methods.test.ts
```

#### Acceptance Criteria
- [ ] 8 named exports + correct typing.
- [ ] All RED tests GREEN (10 sub-tests + 1 EC-6 dual-verb case).
- [ ] Pass: size — file ≤ 100 LoC.

#### DoD
- [ ] Method decorators green.

---

## Phase 2: Parameter + Response-shape decorators

**Objective:** Implement the 9 parameter decorators + 3 response-shape decorators that complete the per-method surface.

### T2.1 — 9 parameter decorators (`@Req/@Res/@Body/@Param/@Query/@Headers/@Session/@Ip/@HostParam`)

#### Objective
Implement `packages/http-decorators/src/decorators/params.ts` storing per-parameter source descriptors in `ROUTE_PARAMS` metadata keyed by (target, methodName, paramIndex).

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — provides the 9 parameter decorators. Each writes `{source, key?}` (where `source ∈ 'req' | 'res' | 'body' | 'param' | 'query' | 'headers' | 'session' | 'ip' | 'host'`) indexed by parameter position.
2. **Why it is necessary now** — Phase 3's bridge needs to know "for each method, what to extract from `ctx` and pass into each parameter slot". Without this metadata, the bridge can't build the parameter-extraction wrapper.

#### Evidence
- Blueprint Recommendation 3 enumerates all 9 decorators.
- Blueprint Q1 § "Parameter decorators" list.
- Blueprint Q1 mapping table rows 11-17 (per-parameter source mapping to TheoKit ctx).

#### Files to edit
```
packages/http-decorators/src/decorators/params.ts (NEW) — 9 parameter decorators
packages/http-decorators/src/decorators/index.ts (UPDATE) — re-export
packages/http-decorators/tests/unit/params.test.ts (NEW) — RED tests
```

#### Pseudo-code / Signatures

```typescript
import { setMeta, getMeta, ROUTE_PARAMS } from '../metadata/index.js'

export type ParamSource = 'req' | 'res' | 'body' | 'param' | 'query' | 'headers' | 'session' | 'ip' | 'host'

interface ParamEntry { source: ParamSource; key?: string; index: number; passthrough?: boolean }

function makeParamDecorator(source: ParamSource) {
  return function (key?: string): ParameterDecorator {
    return (target, propertyKey, parameterIndex) => {
      const map = getMeta<Map<string | symbol, ParamEntry[]>>(ROUTE_PARAMS, target.constructor)
        ?? new Map()
      if (propertyKey === undefined) return
      const entries = map.get(propertyKey) ?? []
      entries.push({ source, key, index: parameterIndex })
      map.set(propertyKey, entries)
      setMeta(ROUTE_PARAMS, target.constructor, map)
    }
  }
}

export const Req       = makeParamDecorator('req')
export const Body      = makeParamDecorator('body')
export const Param     = makeParamDecorator('param')
export const Query     = makeParamDecorator('query')
export const Headers   = makeParamDecorator('headers')
export const Session   = makeParamDecorator('session')
export const Ip        = makeParamDecorator('ip')
export const HostParam = makeParamDecorator('host')
// Res has slightly different shape (passthrough option):
export function Res(opts?: { passthrough?: boolean }): ParameterDecorator { /* sets passthrough */ }
```

#### Tasks
1. Implement factory + 8 simple decorators + Res with passthrough option.
2. Write RED tests: each decorator stores correct source; multiple params on same method accumulate; mixed params (Body+Param+Query) preserve indices; Res({passthrough:true}) stores flag.

#### TDD
```
RED:     test_each_param_decorator (9 sub-tests, one per decorator)
RED:     test_multiple_params_per_method — handler(@Body() b, @Param('id') id) records both at index 0/1
RED:     test_res_passthrough — @Res({passthrough:true}) stores passthrough=true
RED:     test_walk_handles_param_index_gap (EC-7) — Given handler `findOne(@Param('id') id, ctx: SomeCtx, @Headers('x') hdr)` where param index 1 has no decorator, When walkControllerMetadata builds paramExtractors, Then index 1 returns undefined (gracefully skipped) and indices 0+2 are correctly extracted; bridge MUST NOT crash
GREEN:   Implement params.ts.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/unit/params.test.ts
```

#### Acceptance Criteria
- [ ] 9 named exports.
- [ ] All RED tests GREEN (11 original sub-tests + 1 EC-7 index-gap case).
- [ ] Pass: size — file ≤ 150 LoC.

#### DoD
- [ ] Parameter decorators green.

### T2.2 — 3 response-shape decorators (`@HttpCode/@Header/@Redirect`)

#### Objective
Implement `packages/http-decorators/src/decorators/response.ts` for the 3 response-shape method decorators that store `{status}` / `{name, value}[]` / `{url, status}` metadata.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — provides the 3 response-shape decorators per Recommendation 4. `@HttpCode` overrides the default 200/201 status; `@Header` accumulates headers (multiple `@Header` on same method); `@Redirect` short-circuits to a Response redirect.
2. **Why it is necessary now** — completes the per-method decorator surface alongside parameter decorators. Phase 3's bridge wraps handler returns with these directives.

#### Evidence
- Blueprint Recommendation 4 + Q1 § "Response shape decorators".
- Blueprint Q1 mapping table rows 5-7.

#### Files to edit
```
packages/http-decorators/src/decorators/response.ts (NEW) — HttpCode + Header + Redirect
packages/http-decorators/src/decorators/index.ts (UPDATE) — re-export
packages/http-decorators/tests/unit/response.test.ts (NEW) — RED tests
```

#### Pseudo-code / Signatures

```typescript
import { setMeta, getMeta, ROUTE_STATUS, ROUTE_HEADERS, ROUTE_REDIRECT } from '../metadata/index.js'

export function HttpCode(status: number): MethodDecorator {
  return (target, propertyKey) => {
    setMeta(ROUTE_STATUS, target.constructor, status, propertyKey)
  }
}

export function Header(name: string, value: string): MethodDecorator {
  return (target, propertyKey) => {
    const existing = getMeta<Array<[string, string]>>(ROUTE_HEADERS, target.constructor, propertyKey) ?? []
    existing.push([name, value])
    setMeta(ROUTE_HEADERS, target.constructor, existing, propertyKey)
  }
}

export function Redirect(url: string, status: number = 302): MethodDecorator {
  return (target, propertyKey) => {
    setMeta(ROUTE_REDIRECT, target.constructor, { url, status }, propertyKey)
  }
}
```

#### Tasks
1. Implement 3 decorators.
2. Write RED tests: HttpCode stores override; Header accumulates multi-call; Redirect stores URL + default 302.

#### TDD
```
RED:     test_http_code_stores_override
RED:     test_header_accumulates_multiple
RED:     test_redirect_stores_url_and_status
RED:     test_redirect_default_status_302
GREEN:   Implement response.ts.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/unit/response.test.ts
```

#### Acceptance Criteria
- [ ] 3 named exports.
- [ ] All RED tests GREEN.
- [ ] Pass: size — file ≤ 80 LoC.

#### DoD
- [ ] Response-shape decorators green.

---

## Phase 3: Bridge engine + DTO Zod resolution

**Objective:** Implement the heart of the package — the metadata-walk that reads decorator metadata per class and emits the equivalent `defineRoute(...)` config, then a `registerControllers([...])` public API.

### T3.1 — DTO Zod resolution (Pattern D2)

#### Objective
Implement `packages/http-decorators/src/bridge/dto-zod.ts` exporting `resolveDtoSchema(dtoClass: Function): ZodLike | undefined`. Reads `dtoClass.schema` static property; returns the Zod schema or `undefined` if absent.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — implements the explicit-Zod convention from ADR D2. Single utility consumed by the bridge for `@Body() body: CreateCatDto` → `body: zCreateCat` translation.
2. **Why it is necessary now** — the bridge (T3.2) needs to resolve the schema for every DTO-typed parameter at metadata-walk time. Keeping resolution in a dedicated file isolates the convention so an override (e.g., future codemod injecting `static schema`) doesn't require bridge changes.

#### Evidence
- ADR D2 + Pattern D2 in patterns skill.
- Blueprint Q2 § "Worked example (strategy b)" — exact convention demonstrated.

#### Files to edit
```
packages/http-decorators/src/bridge/dto-zod.ts (NEW) — resolveDtoSchema
packages/http-decorators/src/bridge/index.ts (NEW) — barrel
packages/http-decorators/tests/unit/dto-zod.test.ts (NEW) — RED tests
```

#### Pseudo-code / Signatures

```typescript
import type { ZodTypeAny } from 'zod'

export interface DtoWithSchema {
  schema: ZodTypeAny
}

export function resolveDtoSchema(dtoClass: unknown): ZodTypeAny | undefined {
  if (typeof dtoClass !== 'function') return undefined
  const maybe = (dtoClass as { schema?: unknown }).schema
  if (maybe && typeof (maybe as { safeParse?: unknown }).safeParse === 'function') {
    return maybe as ZodTypeAny
  }
  return undefined
}
```

#### Tasks
1. Implement resolveDtoSchema.
2. Write RED tests: class with `static schema` returns it; class without schema returns undefined; non-function input returns undefined; non-Zod static field (e.g., `static schema = {}`) returns undefined (duck-type via safeParse).

#### TDD
```
RED:     test_resolve_with_schema_returns_zod
RED:     test_resolve_without_schema_returns_undefined
RED:     test_resolve_non_function_returns_undefined
RED:     test_resolve_non_zod_static_returns_undefined
GREEN:   Implement resolveDtoSchema.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/unit/dto-zod.test.ts
```

#### Acceptance Criteria
- [ ] 4 RED tests GREEN.
- [ ] Zero `any` in production code.
- [ ] Pass: size — file ≤ 50 LoC.

#### DoD
- [ ] DTO Zod resolution green.

### T3.2 — `walkControllerMetadata(ControllerClass)` (bridge engine core)

#### Objective
Implement `packages/http-decorators/src/bridge/walk-metadata.ts` exporting `walkControllerMetadata(ControllerClass): WalkResult[]` where each `WalkResult` describes one resolved route: `{verb, path, propertyKey, paramExtractors, status, headers, redirect, guards, interceptors, bodySchema, querySchema, paramsSchema}`. Pure function — no side effects on TheoKit.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — single function that reads ALL metadata for a controller class and produces a structured list of route descriptors. Separates "what the decorators said" from "how to register with TheoKit" (which T3.3 handles).
2. **Why it is necessary now** — testability. The walk is the most complex piece; isolating it into a pure function lets us test each metadata-source independently before wiring it up to `defineRoute`. If T3.2 is correct, T3.3 is trivially correct.

#### Evidence
- Blueprint Q1 § "Dispatch internals (NestJS reflect-metadata model)" — describes the metadata-walk pattern.
- Blueprint § "Conclusion for Q1" — explicitly recommends strategy (b) `registerControllers([...])` for v0.1.0.

#### Files to edit
```
packages/http-decorators/src/bridge/walk-metadata.ts (NEW) — walkControllerMetadata
packages/http-decorators/src/bridge/index.ts (UPDATE) — re-export
packages/http-decorators/tests/unit/walk-metadata.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
- Consumes metadata facade (T1.2) for `getMeta(KEY, target, propertyKey?)` calls.
- Consumes `resolveDtoSchema` from T3.1.
- ZERO imports from `theokit/server` (this is a pure transform).

#### Pseudo-code / Signatures

```typescript
import { getMeta, CONTROLLER_PREFIX, ROUTE_METHODS, ROUTE_PARAMS,
         ROUTE_STATUS, ROUTE_HEADERS, ROUTE_REDIRECT,
         USE_GUARDS, USE_INTERCEPTORS } from '../metadata/index.js'
import { resolveDtoSchema } from './dto-zod.js'
import type { ZodTypeAny } from 'zod'

export interface WalkResult {
  verb: HttpVerb
  fullPath: string                        // joined prefix + method path
  propertyKey: string | symbol
  bodySchema?: ZodTypeAny
  querySchema?: ZodTypeAny
  paramsSchema?: ZodTypeAny
  paramExtractors: Array<(ctx: unknown) => unknown>  // index-ordered
  status?: number
  headers: Array<[string, string]>
  redirect?: { url: string; status: number }
  guards: unknown[]                       // class constructors
  interceptors: unknown[]
}

export function walkControllerMetadata(ControllerClass: Function): WalkResult[] {
  const { prefix, host } = getMeta(CONTROLLER_PREFIX, ControllerClass) ?? { prefix: '', host: undefined }
  const methods = getMeta<RouteMethodEntry[]>(ROUTE_METHODS, ControllerClass) ?? []
  const paramsMap = getMeta<Map<string | symbol, ParamEntry[]>>(ROUTE_PARAMS, ControllerClass) ?? new Map()

  // Q4 warning when host set
  if (host) { console.warn(`@Controller host '${host}' captured but enforcement deferred to v0.2.0`) }

  return methods.map((m) => {
    const params = paramsMap.get(m.propertyKey) ?? []
    // Read design:paramtypes for each @Body param's class → DTO schema
    const paramTypes = Reflect.getMetadata('design:paramtypes', ControllerClass.prototype, m.propertyKey) ?? []
    // Resolve schemas from DTO classes
    const bodyParam = params.find(p => p.source === 'body' && !p.key)
    const bodySchema = bodyParam ? resolveDtoSchema(paramTypes[bodyParam.index]) : undefined
    // ... similarly for query/params ...
    // Build paramExtractors (index-ordered) — each pulls from ctx.{body|query|params|...}
    const paramExtractors = params
      .sort((a, b) => a.index - b.index)
      .map((p) => buildExtractor(p))
    return {
      verb: m.verb,
      fullPath: joinPath(prefix, m.path),
      propertyKey: m.propertyKey,
      bodySchema, querySchema: ..., paramsSchema: ...,
      paramExtractors,
      status: getMeta(ROUTE_STATUS, ControllerClass, m.propertyKey),
      headers: getMeta(ROUTE_HEADERS, ControllerClass, m.propertyKey) ?? [],
      redirect: getMeta(ROUTE_REDIRECT, ControllerClass, m.propertyKey),
      guards: getMeta(USE_GUARDS, ControllerClass, m.propertyKey) ?? [],
      interceptors: getMeta(USE_INTERCEPTORS, ControllerClass, m.propertyKey) ?? [],
    }
  })
}
```

#### Tasks
1. Implement `walkControllerMetadata` + helper `joinPath` (with normalization per EC-3) + helper `buildExtractor` + `errors.ts` exporting `HttpDecoratorsConfigError`.
2. **EC-2 (MUST FIX):** When `getMeta(CONTROLLER_PREFIX, ControllerClass)` returns `undefined`, throw `HttpDecoratorsConfigError('Controller class ${ControllerClass.name} is missing @Controller() decorator')`. Replace plan-v1.0 default `?? { prefix: '', host: undefined }`.
3. **EC-3 (MUST FIX):** `joinPath(prefix, path)` MUST normalize leading/trailing slashes: `('/' + prefix + '/' + path).replace(/\/+/g, '/').replace(/\/$/, '') || '/'`. Verify against 4 input shapes in RED tests.
4. **EC-4 (MUST FIX):** When ANY `@Body`/`@Query`/`@Param` decorator exists on a method AND `Reflect.getMetadata('design:paramtypes', ControllerClass.prototype, propertyKey)` returns `undefined`, throw `HttpDecoratorsConfigError('emitDecoratorMetadata not enabled in consumer tsconfig — add "emitDecoratorMetadata": true. See migration guide § Troubleshooting.')`.
5. **EC-8 (SHOULD TEST):** Walk MUST traverse the prototype chain when reading `ROUTE_METHODS` / `ROUTE_PARAMS` so inherited `@Get` from a parent class registers under child class's prefix. Implement via `getMeta` walking `ControllerClass.prototype` then `Object.getPrototypeOf(ControllerClass.prototype)` if needed.
6. Write RED tests for original 7 cases PLUS 4 new MUST FIX cases PLUS EC-8 inheritance case (12 total).

#### TDD
```
RED:     test_walk_simple_get — class with @Controller('cats') + @Get() findAll() returns one WalkResult {verb:'GET', fullPath:'/cats', ...}
RED:     test_walk_post_with_body_dto — @Body() body: CreateCatDto with static schema → bodySchema resolved
RED:     test_walk_get_with_query_header — verifies querySchema + headers list
RED:     test_walk_put_with_param — verifies paramsSchema + paramExtractor for @Param('id')
RED:     test_walk_delete_with_http_code — verifies status=204
RED:     test_walk_redirect — verifies redirect={url, status}
RED:     test_walk_host_warning — verifies console.warn called for @Controller({host:'x'})
RED:     test_walk_throws_when_missing_controller_decorator (EC-2) — class with @Get() but no @Controller throws HttpDecoratorsConfigError
RED:     test_join_path_normalizes_leading_trailing_slashes (EC-3) — 4 sub-cases: ('cats','/breed') → '/cats/breed'; ('/cats','breed') → '/cats/breed'; ('cats/','/breed/') → '/cats/breed'; ('','') → '/'
RED:     test_walk_throws_when_design_paramtypes_missing (EC-4) — @Body decorator + emitDecoratorMetadata=false simulation throws HttpDecoratorsConfigError mentioning migration guide
RED:     test_walk_inheritance_child_inherits_parent_methods (EC-8) — class AdminCatsController extends CatsController; @Get from parent registers under AdminCatsController's @Controller prefix
GREEN:   Implement walk-metadata.ts + joinPath + errors.ts.
REFACTOR: Extract joinPath + buildExtractor + errors out if walk-metadata.ts > 200 LoC.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/unit/walk-metadata.test.ts
```

#### Acceptance Criteria
- [ ] 12 RED tests GREEN (7 original + 4 MUST FIX + 1 SHOULD TEST inheritance).
- [ ] Zero `any` in production code (Pattern D1 compliance — `.claude/rules/type-safety.md`).
- [ ] `walk-metadata.ts` ≤ 300 LoC (per `.claude/rules/architecture.md` default 500 budget).
- [ ] `errors.ts` ≤ 50 LoC and exports `HttpDecoratorsConfigError extends Error` with `name = 'HttpDecoratorsConfigError'`.
- [ ] Q4 host warning emitted exactly once per call.
- [ ] All thrown errors include actionable hint pointing to migration guide section.

#### DoD
- [ ] Bridge engine core green.
- [ ] Coverage ≥ 90% on `walk-metadata.ts`.
- [ ] EC-2/EC-3/EC-4/EC-8 absorbed and verified.

### T3.3 — `registerControllers([...])` low-level API (binds walk-result to `defineRoute`) — v1.1 dedupes per EC-5

#### Objective (v1.1 reframed)
Implement `packages/http-decorators/src/bridge/register-controllers.ts` exporting `registerControllers(controllers: Function[]): RouteRegistration[]`. Iterates each controller (de-duplicated by class reference per EC-5), calls `walkControllerMetadata`, converts each `WalkResult` to a `defineRoute(...)` call (imported via barrel per Pattern D6), and returns the registration list.

**Reframed per ADR D7 (v1.1):** this function is now the LOW-LEVEL API consumed internally by the Vite plugin (T3.5) AND by advanced users who don't use Vite. It is no longer the primary consumer-facing surface (that role moved to `decoratorsBridgePlugin()`).

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — low-level API that translates `WalkResult[]` → `RouteRegistration[]`. Used internally by the Vite plugin to produce the route definitions written to `server/routes/__decorated__/`. Pattern D6 enforced — single `import { defineRoute, defineMiddleware } from 'theokit/server'`.
2. **Why it is necessary now** — even though primary consumer-surface is the Vite plugin (T3.5), the bridge's emit-file step needs the array of route definitions to serialize. Splitting `walkControllerMetadata` (T3.2 — pure metadata) → `registerControllers` (T3.3 — `defineRoute` instances) → `emitRouteFile` (T3.5 — serialize to source) gives 3 testable units. Pattern D6 honored here.

#### Evidence
- Blueprint Q1 conclusion strategy (b): "register virtual routes at startup via a `registerControllers([...])` API".
- ADR D6.

#### Files to edit
```
packages/http-decorators/src/bridge/register-controllers.ts (NEW) — registerControllers
packages/http-decorators/src/bridge/index.ts (UPDATE) — re-export
packages/http-decorators/src/index.ts (UPDATE) — re-export top-level
packages/http-decorators/tests/unit/register-controllers.test.ts (NEW) — RED tests
```

#### Deep file dependency analysis
- FIRST file in the new package to import from `theokit/server`. Pattern D6 contract test (T1.3) MUST still pass after this commit.
- Consumes `walkControllerMetadata` from T3.2.

#### Pseudo-code / Signatures

```typescript
import { defineRoute } from 'theokit/server'    // Pattern D6 — barrel only
import { walkControllerMetadata, type WalkResult } from './walk-metadata.js'

export interface RouteRegistration {
  verb: HttpVerb
  fullPath: string
  route: ReturnType<typeof defineRoute>
}

export function registerControllers(controllers: Function[]): RouteRegistration[] {
  // EC-5: dedupe by class reference; warn on duplicates
  const seen = new Set<Function>()
  const unique: Function[] = []
  for (const Ctor of controllers) {
    if (seen.has(Ctor)) {
      console.warn(`[@theokit/http-decorators] Controller ${Ctor.name} registered multiple times — dropping duplicate`)
      continue
    }
    seen.add(Ctor)
    unique.push(Ctor)
  }
  return unique.flatMap((Ctor) => {
    const walks = walkControllerMetadata(Ctor)
    return walks.map((w) => buildRegistration(Ctor, w))
  })
}

function buildRegistration(Ctor: Function, w: WalkResult): RouteRegistration {
  const instance = new (Ctor as new () => any)()  // single instance per controller
  const handler = async (ctx: any) => {
    // Build args from paramExtractors
    const args = w.paramExtractors.map((extract) => extract(ctx))
    // Invoke user method
    let result = await (instance as any)[w.propertyKey](...args)
    // Apply redirect / status / headers via Response construction
    if (w.redirect) return Response.redirect(w.redirect.url, w.redirect.status)
    const headers = new Headers()
    for (const [name, value] of w.headers) headers.set(name, value)
    if (result instanceof Response) return result
    return Response.json(result, { status: w.status ?? defaultStatus(w.verb), headers })
  }
  return {
    verb: w.verb,
    fullPath: w.fullPath,
    route: defineRoute({
      body: w.bodySchema,
      query: w.querySchema,
      params: w.paramsSchema,
      status: w.status,
      handler,
    }),
  }
}

function defaultStatus(verb: HttpVerb): number {
  return verb === 'POST' ? 201 : 200
}
```

#### Tasks
1. Implement registerControllers + buildRegistration + defaultStatus.
2. Write RED tests: single-method controller registers one route; multi-method controller registers N routes; controller with @Body DTO + handler receiving body returns response; @HttpCode override; @Redirect short-circuit.

#### TDD
```
RED:     test_register_single_method — CatsController with @Get findAll() returns 1 registration
RED:     test_register_multi_method — CatsController with 4 methods returns 4 registrations
RED:     test_register_body_dto_invocation — POST with @Body, handler receives the validated body
RED:     test_register_http_code_override — @HttpCode(204) makes response status=204
RED:     test_register_redirect_short_circuit — @Redirect handler returns Response.redirect
RED:     test_register_multiple_controllers — array of 2 controllers returns combined registrations
RED:     test_register_duplicate_controllers_dedupes_with_warn (EC-5) — [X, X] returns N registrations (not 2N) and console.warn called once
GREEN:   Implement register-controllers.ts.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/unit/register-controllers.test.ts
```

#### Acceptance Criteria
- [ ] 7 RED tests GREEN (6 original + 1 EC-5 dedup).
- [ ] T1.3 contract test (no-deep-imports) STILL passes after this commit — only `from 'theokit/server'` allowed.
- [ ] Pass: size — file ≤ 200 LoC.

#### DoD
- [ ] Public API green.
- [ ] Pattern D6 contract test green.
- [ ] EC-5 absorbed (idempotent registration).

### T3.4 — Contract tests per Pattern D1, D2, D3 (NestJS-equivalent behavior verification)

#### Objective
Add three more contract tests under `packages/http-decorators/tests/contract/`:
- `pattern-d1-legacy-decorators.test.ts` — verifies `experimentalDecorators` is enabled in `tsconfig.json`; verifies `reflect-metadata` is a peer dep in `package.json`.
- `pattern-d2-zod-static-schema.test.ts` — verifies that a controller with `@Body() body: ClassWithoutSchema` produces an undefined `bodySchema` (graceful, not crash); a controller with `@Body() body: ClassWithSchema` resolves the Zod.
- `pattern-d3-guards-as-middleware.test.ts` — verifies that `@UseGuards`/`@UseInterceptors` metadata is read at walk time (implementation lands in Phase 4; this test ships a stub that will pass once Phase 4 lands).

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — ships one contract test per Pattern that closes the chain "patterns skill claims X, plan adopts X via ADR Dx, contract test verifies X holds at the code level".
2. **Why it is necessary now** — the Goal mandates "≥ 1 contract test per Pattern D1-D6 (≥ 6 distinct passing test files)". T1.3 covered D6, this task covers D1+D2+D3, Phase 4 ships the D3-full implementation, Phase 5 covers D5, Phase 6 covers D4 via the migration guide test. Done after this and Phase 4: D1+D2+D3+D6 (4/6). Pattern D4 (test-harness reuse) is verified by the existence + pass of integration test T-final.1. Pattern D5 verified by T5.1 (CLI test extension).

#### Files to edit
```
packages/http-decorators/tests/contract/pattern-d1-legacy-decorators.test.ts (NEW)
packages/http-decorators/tests/contract/pattern-d2-zod-static-schema.test.ts (NEW)
packages/http-decorators/tests/contract/pattern-d3-guards-as-middleware.test.ts (NEW)
```

#### Tasks
1. Write D1 test reading `packages/http-decorators/tsconfig.json` + `package.json`.
2. Write D2 test using two fixture classes (with/without static schema).
3. Write D3 test asserting metadata is captured (T4.1 lands the @UseGuards decorator; this test runs even before that lands with an "expect-throws" or skipped state, then flips to active after T4.1).

#### TDD
```
RED:     pattern_d1_tsconfig_has_decorator_flags
RED:     pattern_d1_package_has_reflect_metadata_peer
RED:     pattern_d2_class_without_schema_returns_undefined
RED:     pattern_d2_class_with_schema_resolves
RED:     pattern_d3_use_guards_metadata_captured (skipped until T4.1)
GREEN:   Implement contract tests; D3 test active after T4.1.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/contract/
```

#### Acceptance Criteria
- [ ] 3 new contract test files, total 4 active tests + 1 skipped.
- [ ] All active tests GREEN.

#### DoD
- [ ] Contract tests in place.

### T3.5 — Vite plugin `decoratorsBridgePlugin()` + `emitRouteFile()` helper (NEW in v1.1 — resolves EC-1 via ADR D7)

#### Objective
Ship `packages/http-decorators/src/vite/plugin.ts` exporting `decoratorsBridgePlugin({ controllers, generatedDir? })` Vite plugin that hooks into `configResolved` + `buildStart` and writes generated route files to `<generatedDir>` (default: `server/routes/__decorated__/`). Also ship `packages/http-decorators/src/vite/emit-route-file.ts` exporting `emitRouteFile(WalkResult): { filePath: string; source: string }` that serializes one `WalkResult` to a TypeScript source string in TheoKit's named-export-per-verb convention.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — ships the consumer-facing primary surface that resolves the EC-1 mount gap. Plugin runs at Vite dev/build, walks each controller class, emits one `.ts` file per route into `server/routes/__decorated__/`, where TheoKit's existing scanner (`scanServerRoutes` at `packages/theo/src/server/scan/scan.ts:102`) picks them up automatically. Also writes `server/routes/__decorated__/.gitignore` containing `*` on first run so consumers don't commit generated files.
2. **Why it is necessary now** — without this, the entire bridge engine (T3.2 + T3.3) produces unmountable routes. ADR D7 specifies this mechanism as the canonical mount path for v0.1.0. Without T3.5, the Goal-mandated Pattern-2 integration test (T-final.1) FAILS structurally because no routes are reachable via `fetch`.

#### Evidence
- ADR D7 (NEW v1.1).
- Edge-case review EC-1: "registerControllers([...]) has no mount mechanism — TheoKit's router is file-scan-only".
- Verified via `grep` on `packages/theo/src/server/index.ts` + `packages/theo/src/server/scan/index.ts` (2026-06-08): only `scanServerRoutes`, `matchRoute`, `compilePattern` exported — no runtime `addRoute`.

#### Files to edit
```
packages/http-decorators/src/vite/plugin.ts (NEW) — decoratorsBridgePlugin
packages/http-decorators/src/vite/emit-route-file.ts (NEW) — emitRouteFile helper
packages/http-decorators/src/vite/index.ts (NEW) — barrel
packages/http-decorators/package.json (UPDATE) — add "./vite-plugin" subpath export pointing at dist/vite/index.js
packages/http-decorators/tests/unit/emit-route-file.test.ts (NEW) — RED tests for serialization
packages/http-decorators/tests/integration/vite-plugin-emit.test.ts (NEW) — RED test that runs the plugin on a fixture + verifies files written + gitignore written
```

#### Deep file dependency analysis
- Plugin imports from `theokit/server` barrel (Pattern D6) for `defineRoute` type reference in the emitted source string.
- Plugin imports `node:fs` + `node:path` for file operations.
- Plugin consumes `walkControllerMetadata` (T3.2) + DOES NOT consume `registerControllers` directly (it consumes `walkControllerMetadata` then `emitRouteFile`; `registerControllers` is for the non-Vite low-level path).

#### Pseudo-code / Signatures

```typescript
// packages/http-decorators/src/vite/plugin.ts
import type { Plugin } from 'vite'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { walkControllerMetadata } from '../bridge/walk-metadata.js'
import { emitRouteFile } from './emit-route-file.js'

export interface DecoratorsBridgePluginOptions {
  controllers: Function[]
  generatedDir?: string  // default: 'server/routes/__decorated__'
}

export function decoratorsBridgePlugin(opts: DecoratorsBridgePluginOptions): Plugin {
  let projectRoot: string
  const generatedDir = opts.generatedDir ?? 'server/routes/__decorated__'

  return {
    name: '@theokit/http-decorators:bridge',
    configResolved(config) { projectRoot = config.root },
    buildStart() {
      const outDir = resolve(projectRoot, generatedDir)
      mkdirSync(outDir, { recursive: true })
      // Auto-write .gitignore on first run
      const gitignorePath = join(outDir, '.gitignore')
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, '# Generated by @theokit/http-decorators\n*\n!.gitignore\n')
      }
      // Emit one file per route
      for (const Ctor of opts.controllers) {
        const walks = walkControllerMetadata(Ctor)
        for (const w of walks) {
          const { filePath, source } = emitRouteFile(w)
          const fullPath = join(outDir, filePath)
          mkdirSync(resolve(fullPath, '..'), { recursive: true })
          writeFileSync(fullPath, source)
        }
      }
    },
  }
}

// packages/http-decorators/src/vite/emit-route-file.ts
import type { WalkResult } from '../bridge/walk-metadata.js'

export function emitRouteFile(w: WalkResult): { filePath: string; source: string } {
  // filePath: __decorated__/{path-segments}/index.ts
  const safePath = w.fullPath.replace(/^\//, '').replace(/[^a-z0-9/_-]/gi, '_') || 'index'
  const filePath = `${safePath}/${w.verb.toLowerCase()}.ts`  // e.g. 'cats/get.ts'
  const source = [
    `// AUTO-GENERATED by @theokit/http-decorators decoratorsBridgePlugin`,
    `// Do not edit — regenerated on every dev/build`,
    `import { defineRoute } from 'theokit/server'`,
    `// (full handler body re-inlined here via serialized closures — see § Serialization)`,
    `export const ${w.verb} = defineRoute({ /* serialized config */ })`,
  ].join('\n')
  return { filePath, source }
}
```

> **Serialization note:** The emitted file's `defineRoute({...})` must include a real handler body — NOT a function reference (which can't be serialized to source). The plugin emits a file that imports the controller class, instantiates it, and inlines the parameter-extraction wrapper. Concretely: each generated file imports the user's controller, builds the handler closure at module-load time, and exports the `defineRoute` call. This sidesteps function-serialization entirely.

#### Tasks
1. Implement `emit-route-file.ts` with serialization strategy (controller import + closure-build).
2. Implement `vite/plugin.ts` with `configResolved` + `buildStart` hooks.
3. Add `./vite-plugin` subpath export to `package.json`.
4. Write RED unit tests for `emitRouteFile` (per-verb file naming, source shape, controller import correctness).
5. Write RED integration test for the plugin (run on a fixture controller, verify files written + `.gitignore` auto-written + scanner can pick them up).

#### TDD
```
RED:     test_emit_get_route_file — emitRouteFile({verb:'GET', fullPath:'/cats'}) returns {filePath:'cats/get.ts', source:contains 'export const GET'}
RED:     test_emit_post_with_body_file — POST with body schema serializes correctly
RED:     test_emit_nested_path — fullPath:'/admin/cats/:id' produces filePath:'admin/cats/_id/get.ts' (safe-path replacement)
RED:     test_plugin_writes_gitignore_on_first_run — fixture with no .gitignore → plugin writes it
RED:     test_plugin_does_not_overwrite_gitignore — fixture with existing .gitignore → plugin leaves it alone
RED:     test_plugin_emits_one_file_per_route — fixture with 4-method controller → 4 files written
RED:     test_plugin_emitted_files_are_scanner_compatible — scanServerRoutes(fixture/server) returns the emitted routes as ServerRouteNode[]
GREEN:   Implement vite/plugin.ts + vite/emit-route-file.ts.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/unit/emit-route-file.test.ts tests/integration/vite-plugin-emit.test.ts
```

#### Acceptance Criteria
- [ ] 7 RED tests GREEN.
- [ ] `packages/http-decorators/package.json` has `"./vite-plugin": { "import": "./dist/vite/index.js", "types": "./dist/vite/index.d.ts" }` subpath export.
- [ ] `server/routes/__decorated__/.gitignore` auto-written on first plugin run.
- [ ] Emitted files import only `theokit/server` (Pattern D6 contract test T1.3 still passes).
- [ ] Pass: size — `plugin.ts` ≤ 200 LoC; `emit-route-file.ts` ≤ 150 LoC.

#### DoD
- [ ] Vite plugin green.
- [ ] EC-1 absorbed and verified via T-final.2 round-trip integration test.

---

## Phase 4: Guards / Interceptors (`defineMiddleware` wraps)

**Objective:** Ship the decorator surface for cross-cutting concerns + their bridge to `defineMiddleware`.

### T4.1 — `@UseGuards(GuardClass)` + `@UseInterceptors(InterceptorClass)` decorators

#### Objective
Implement `packages/http-decorators/src/decorators/middleware.ts` exporting `UseGuards(...guards: Function[])` and `UseInterceptors(...interceptors: Function[])` method/class decorators that store the class list in `USE_GUARDS` / `USE_INTERCEPTORS` metadata.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — provides the binding decorators per Recommendation 6. Variadic shape mirrors NestJS (`@UseGuards(AuthGuard, RoleGuard)`).
2. **Why it is necessary now** — required input for T4.2 (the bridge wrap). Without these decorators in the metadata, the bridge has nothing to wrap.

#### Evidence
- ADR D3 + Recommendation 6.
- Blueprint Q3 § "Bridge proposal for v0.1.0" table.

#### Files to edit
```
packages/http-decorators/src/decorators/middleware.ts (NEW) — UseGuards + UseInterceptors
packages/http-decorators/src/decorators/index.ts (UPDATE) — re-export
packages/http-decorators/tests/unit/middleware-decorators.test.ts (NEW) — RED tests
```

#### Pseudo-code / Signatures

```typescript
import { setMeta, getMeta, USE_GUARDS, USE_INTERCEPTORS } from '../metadata/index.js'

export function UseGuards(...guards: Function[]): ClassDecorator & MethodDecorator {
  return ((target, propertyKey?) => {
    const existing = getMeta<Function[]>(USE_GUARDS, propertyKey ? target.constructor : target, propertyKey) ?? []
    setMeta(USE_GUARDS, propertyKey ? target.constructor : target, [...existing, ...guards], propertyKey)
  }) as any
}

export function UseInterceptors(...interceptors: Function[]): ClassDecorator & MethodDecorator {
  // mirror UseGuards
}
```

#### Tasks
1. Implement both decorators with variadic + class/method dual usage.
2. Write RED tests: class-level @UseGuards stores; method-level @UseGuards stores per-method; variadic preserves order; multiple @UseGuards accumulate.

#### TDD
```
RED:     test_use_guards_class_level
RED:     test_use_guards_method_level
RED:     test_use_guards_variadic_order_preserved
RED:     test_use_interceptors_class_level
RED:     test_use_interceptors_variadic
RED:     test_class_and_method_use_guards_compose (EC-9) — Given `@UseGuards(ClassGuard) class C { @UseGuards(MethodGuard) @Get() h() {} }`, When the route is invoked, Then ClassGuard runs BEFORE MethodGuard (NestJS convention class-first); both observed in correct order
GREEN:   Implement middleware.ts.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/unit/middleware-decorators.test.ts
```

#### Acceptance Criteria
- [ ] 6 RED tests GREEN (5 original + 1 EC-9 class+method composition order).
- [ ] Pattern D3 contract test (T3.4) flips from skipped to active and passes.
- [ ] Pass: size — file ≤ 80 LoC.

#### DoD
- [ ] Middleware decorators green.

### T4.2 — Bridge wrap: Guards/Interceptors → `defineMiddleware` chain in `walk-metadata.ts` output

#### Objective
Extend `walk-metadata.ts` (T3.2) AND `register-controllers.ts` (T3.3) so that for each WalkResult with `guards.length > 0` OR `interceptors.length > 0`, a wrapping `defineMiddleware` chain is composed and applied BEFORE the route handler. Guards short-circuit via `AuthRequiredError` throw → bridge catches → 401; Interceptors wrap via `await next(request)` + decorate.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — closes the loop. Decorators captured (T4.1) become real middleware via the bridge.
2. **Why it is necessary now** — without this, T4.1 decorators are inert metadata writers with no runtime effect. Pattern D3 IS this step.

#### Evidence
- ADR D3 + Blueprint Q3 § "Bridge proposal" + Blueprint Q3 § "Sequence-diagram comparison".

#### Files to edit
```
packages/http-decorators/src/bridge/wrap-middleware.ts (NEW) — buildGuardWrap + buildInterceptorWrap
packages/http-decorators/src/bridge/register-controllers.ts (UPDATE) — consume the wraps
packages/http-decorators/tests/integration/guards-interceptors.test.ts (NEW) — RED test using Pattern 2 boundary smoke
```

#### Deep file dependency analysis
- Consumes `defineMiddleware` from `theokit/server` barrel (Pattern D6).
- May consume `AuthRequiredError` from `theokit/server` if exported; otherwise throw plain Error with `name='AuthRequiredError'` (the existing error envelope translator handles by name).

#### Pseudo-code / Signatures

```typescript
import { defineMiddleware } from 'theokit/server'

export interface GuardLike { canActivate(request: Request): boolean | Promise<boolean> }
export interface InterceptorLike { intercept(request: Request, next: () => Promise<Response>): Promise<Response> }

export function buildGuardWrap(guards: Function[]) {
  return defineMiddleware(async (request, next) => {
    for (const G of guards) {
      const instance = new (G as any)() as GuardLike
      const ok = await instance.canActivate(request)
      if (!ok) {
        const err = new Error('Unauthorized') as Error & { name: string }
        err.name = 'AuthRequiredError'  // mapped to 401 by existing envelope translator
        throw err
      }
    }
    return next(request)
  })
}

export function buildInterceptorWrap(interceptors: Function[]) {
  return defineMiddleware(async (request, next) => {
    let result = await next(request)
    for (const I of interceptors) {
      const instance = new (I as any)() as InterceptorLike
      result = await instance.intercept(request, async () => result)
    }
    return result
  })
}
```

#### Tasks
1. Implement buildGuardWrap + buildInterceptorWrap.
2. Update `register-controllers.ts` to compose wraps when guards/interceptors present.
3. Write a Pattern 2 boundary smoke RED test: controller with `@UseGuards(AuthGuard)` where `AuthGuard.canActivate` returns false → fetch returns 401; controller with `@UseInterceptors(LoggingInterceptor)` → response includes interceptor-added header.

#### TDD
```
RED:     test_guard_canactivate_false_returns_401 — Pattern 2 fetch test
RED:     test_guard_canactivate_true_passes_through
RED:     test_interceptor_wraps_response
RED:     test_multi_guards_short_circuit_first_false
RED:     test_guard_canactivate_throws_propagates_as_500_not_401 (EC-10) — Given a guard whose canActivate throws `new Error('boom')` (not auth-related), When the route is invoked, Then response is 500 with error envelope (NOT 401 — only `return false` maps to 401); thrown errors propagate via existing error-envelope translator
GREEN:   Implement wrap-middleware.ts + update register-controllers.ts.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/integration/guards-interceptors.test.ts
```

#### Acceptance Criteria
- [ ] 5 RED tests GREEN (4 original + 1 EC-10 throw-vs-false-return distinction).
- [ ] Pass: size — `wrap-middleware.ts` ≤ 150 LoC.
- [ ] Pattern D6 contract test still green.

#### DoD
- [ ] Guards/Interceptors integration green.

---

## Phase 5: CLI `theokit generate controller` verb

**Objective:** Extend the existing CLI per Pattern D5 with a single new verb.

### T5.1 — Add `controller` to `VALID_TYPES` + `generateControllerTemplate` function

#### Objective
Edit `packages/theo/src/cli/commands/generate.ts`:
- Line 8: change `VALID_TYPES = ['route', 'action', 'page', 'ws'] as const` → `VALID_TYPES = ['route', 'action', 'page', 'ws', 'controller'] as const`.
- Line 125 (`resolveTemplate` switch): add `case 'controller': return { filePath: resolve(cwd, 'server/controllers', `${name}.controller.ts`), content: generateControllerTemplate(name) }`.
- Add new inline `function generateControllerTemplate(name: string): string` returning the canonical 8-line scaffold from the blueprint Q6 worked example.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — single-touch addition to the existing CLI per Pattern D5. ~30 LoC change.
2. **Why it is necessary now** — completes Sub-goal 7 + Recommendation 7. Mirrors the existing `generateRouteTemplate` pattern (line 85 of `generate.ts`) so future maintainers find the symmetry.

#### Evidence
- ADR D5 + Pattern D5 in patterns skill.
- Baseline Context row 5 (`packages/theo/src/cli/commands/generate.ts` 291 LoC; last touched `4e44ddf` 2026-06-01).

#### Files to edit
```
packages/theo/src/cli/commands/generate.ts — VALID_TYPES extension + resolveTemplate switch case + generateControllerTemplate function (~30 LoC added)
packages/theo/src/cli/commands/generate.test.ts — RED tests for the new verb
packages/theo/src/cli/index.ts — EC-15: line 52 help string update from 'Generate a route, action, page, or ws endpoint' → 'Generate a route, action, page, ws, or controller endpoint'
```

#### Deep file dependency analysis
- Existing `VALID_TYPES` (line 8) consumed by `packages/theo/src/cli/router.ts` (CLI dispatcher) + `theokit generate --help` output. Adding 'controller' is backward-compatible — existing 4 verbs unchanged.
- Existing `resolveTemplate` switch has explicit `default: return null` (line 144), which currently makes `'controller'` return null. New switch case fixes that.

#### Pseudo-code / Signatures

```typescript
// Line 8 update:
export const VALID_TYPES = ['route', 'action', 'page', 'ws', 'controller'] as const

// Line 125 switch case insertion:
case 'controller':
  return {
    filePath: resolve(cwd, 'server/controllers', `${name}.controller.ts`),
    content: generateControllerTemplate(name),
  }

// New function (mirrors generateRouteTemplate at line 85):
function generateControllerTemplate(name: string): string {
  const className = toPascalCase(name) + 'Controller'
  const baseName = name.split('/').pop() ?? name
  return [
    `// AUTO-GENERATED by \`theokit generate controller ${name}\``,
    `// Bridge: at startup, this controller's decorators are walked by`,
    `// @theokit/http-decorators and emitted as defineRoute(...) per method.`,
    `import { Controller, Get } from '@theokit/http-decorators'`,
    ``,
    `@Controller('${baseName}')`,
    `export class ${className} {`,
    `  @Get()`,
    `  findAll(): string {`,
    `    return 'This action returns all ${baseName}'`,
    `  }`,
    `}`,
    ``,
  ].join('\n')
}

// Add toPascalCase helper if not already present in the file:
function toPascalCase(name: string): string {
  return name.split(/[/_-]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')
}
```

#### Tasks
1. Update `VALID_TYPES` literal.
2. Add switch case.
3. Add `generateControllerTemplate` + `toPascalCase` helper.
4. Write RED tests in `generate.test.ts`: `generate controller cats` writes file at expected path; `generate controller invalid-NAME` rejected; existing 4 verbs still work (regression).

#### TDD
```
RED:     test_generate_controller_writes_file — `theokit generate controller cats` creates server/controllers/cats.controller.ts
RED:     test_generate_controller_pascal_case_class_name — file content has `export class CatsController`
RED:     test_generate_controller_invalid_name_rejected — non-kebab-case rejected
RED:     test_existing_4_verbs_regression — route/action/page/ws all still work
RED:     test_generate_controller_help_lists_5_verbs (EC-15) — `theokit generate --help` includes literal 'controller' in the help string at cli/index.ts:52
GREEN:   Implement generate.ts + cli/index.ts edits.
VERIFY:  pnpm --filter theokit test tests/unit/generate.test.ts
```

#### Acceptance Criteria
- [ ] 5 RED tests GREEN.
- [ ] `theokit generate controller cats` creates `server/controllers/cats.controller.ts` with the canonical scaffold.
- [ ] Existing 4 verbs still pass their existing tests.
- [ ] Pass: size — `generate.ts` ≤ 350 LoC (was 291; +30 ≈ 321).

#### DoD
- [ ] CLI verb green.
- [ ] Regression tests pass.

---

## Phase 6: Documentation + migration guide

**Objective:** Ship the README + migration guide per Pattern D4 + Recommendations 5 + 8.

### T6.1 — `packages/http-decorators/README.md` + `docs/migration/nestjs-to-theokit-http-decorators.md`

#### Objective
Write the README covering: installation (peer deps), tsconfig delta, `@Controller`/`@Get` quick start, DTO Zod static-schema convention with worked example, Guards/Interceptors example, `theokit generate controller` CLI verb, `decoratorsBridgePlugin()` Vite plugin mounting example (per ADR D7), AND three mandatory "Limitations" subsections per v1.1 absorbing EC-12/EC-13/EC-14 DOCUMENT items:

- **§ Limitations — Singleton-scope controllers only (EC-12).** T3.3 instantiates `new (Ctor)()` ONCE per `registerControllers` call (singleton). NestJS supports request-scoped (`@Injectable({ scope: Scope.REQUEST })`) which builds a fresh instance per request. v0.1.0 ships singleton-only. Migration path: v0.2.0+ adds scope support via `@theokit/di` integration (already-shipped sibling package).
- **§ Limitations — Interceptor wrap can't skip `next()` (EC-13).** True NestJS Interceptor signature `intercept(context, next): Observable<T>` lets the interceptor DECIDE whether/when to call `next` (e.g., cache-hit short-circuit BEFORE calling `next`). v0.1.0 wraps always-call-next-then-decorate per Pattern D3's `(request, next) → Response` shape. Consumers needing cache-style interceptors must hand-roll as `defineMiddleware`. The migration guide ships a side-by-side example.
- **§ Limitations — Handler returning `Response` makes `@HttpCode`/`@Header` no-ops (EC-14).** T3.3 short-circuits on `if (result instanceof Response) return result`, which bypasses the `Response.json(result, {status, headers})` construction path. Means a handler that constructs its own `Response` bypasses decorator-set status/headers. NestJS has the same behavior with `@Res() passthrough: false`. Document with simple rule: "If your handler returns a `Response`, you own the status + headers — decorator-set status/headers are NOT merged in."

Write a separate migration guide covering NestJS-to-TheoKit translations for `Test.createTestingModule` → `startDevServer`, `supertest` → `fetch`, class-validator → Zod static schema, plus a § Troubleshooting section covering the `emitDecoratorMetadata` consumer-tsconfig requirement (Pattern D1 + EC-4 actionable error).

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — completes Recommendation 5 (DTO documentation), Recommendation 8 (test harness migration documentation), and the "honest migration friction" mitigation from the Drawbacks table.
2. **Why it is necessary now** — Pattern D2 explicitly says "Documentation MUST surface the `static schema` convention prominently". Without docs, the migration friction risk in Drawbacks becomes a real adoption blocker.

#### Evidence
- ADR D2 + ADR D4 Consequences + Recommendation 5 + Recommendation 8.

#### Files to edit
```
packages/http-decorators/README.md (UPDATE — was empty stub from T1.1)
docs/migration/nestjs-to-theokit-http-decorators.md (NEW)
```

#### Tasks
1. Write README with 7 sections per Objective.
2. Write migration guide.
3. Verify all code snippets compile (extract to a `docs/_compile-check/` fixture if needed — optional).

#### TDD
```
RED:     test_readme_mentions_static_schema_convention — grep test
RED:     test_readme_mentions_decorators_bridge_plugin (v1.1 ADR D7) — README must reference decoratorsBridgePlugin (replaces the v1.0 registerControllers primary-surface reference)
RED:     test_readme_has_limitations_section_singleton_scope (EC-12)
RED:     test_readme_has_limitations_section_interceptor_wrap (EC-13)
RED:     test_readme_has_limitations_section_response_precedence (EC-14)
RED:     test_migration_guide_covers_test_harness_translation
RED:     test_migration_guide_has_troubleshooting_emit_decorator_metadata (EC-4 actionable)
GREEN:   Write the docs.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/docs/
```

#### Acceptance Criteria
- [ ] README ≥ 250 lines covering 7 sections + 3 mandatory Limitations subsections (EC-12/EC-13/EC-14).
- [ ] Migration guide ≥ 120 lines covering 3 translations + § Troubleshooting (EC-4 actionable error explanation).
- [ ] All code snippets in docs use the canonical APIs (no fabricated function names).
- [ ] No marketing fluff per `.claude/rules/public-copy.md` (technical docs, not HERO copy).

#### DoD
- [ ] Docs shipped + grep tests green.

---

## Final Phase: Integration Validation (MANDATORY)

> This phase runs AFTER all implementation phases are complete. The plan is NOT done until the integration validation chain passes.

**Objective:** Validate the end-to-end pipeline using Pattern D4's Pattern-2 boundary smoke against a real fixture controller.

### T-final.1 — `fixtures/http-decorators-basic/` Pattern-2 boundary smoke

#### Objective
Create `fixtures/http-decorators-basic/` — a minimal TheoKit fixture project with one decorated controller (`server/controllers/cats.controller.ts`) using `@Controller('cats')` + `@Get` + `@Post` + `@Body() body: CreateCatDto` (with static schema Zod) + `@UseGuards(NoopAuthGuard)`. Wire `registerControllers([CatsController])` in `server/main.ts` (or equivalent mount point per fixture convention). Write `packages/http-decorators/tests/integration/basic-controller.test.ts` using `startDevServer(fixturePath, { port: 0 })` + native `fetch` to GET/POST/error-401-via-guard the controller.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — proves the entire chain (decorators → metadata → walk → defineRoute → middleware-runner → response) works in real HTTP traffic, not just unit assertions.
2. **Why it is necessary now** — Pattern D4 IS this test. The Goal mandates "a Pattern-2 boundary smoke (`startDevServer` + native `fetch`) PASS against a fixture controller". Without this, the plan's claim "the bridge actually translates decorators to working routes" is untested.

#### Evidence
- ADR D4 + Pattern D4 + Recommendation 8.
- Existing fixture pattern `tests/integration/onda5-mandatory.test.ts:1-25` (Pattern 2 reference).

#### Files to edit
```
fixtures/http-decorators-basic/package.json (NEW)
fixtures/http-decorators-basic/theo.config.ts (NEW) — minimal config
fixtures/http-decorators-basic/server/controllers/cats.controller.ts (NEW)
fixtures/http-decorators-basic/server/main.ts (NEW) — registerControllers([CatsController])
packages/http-decorators/tests/integration/basic-controller.test.ts (NEW)
pnpm-workspace.yaml (UPDATE) — add 'fixtures/http-decorators-basic' to packages list
```

#### Tasks
1. Add fixture dir to `pnpm-workspace.yaml`.
2. Scaffold fixture project (minimal — mirror `fixtures/template-default/` minus the UI).
3. Write `CatsController` with `@Get findAll()`, `@Post create(@Body() body: CreateCatDto)`, `@UseGuards(NoopAuthGuard)` on one method.
4. Wire `registerControllers([CatsController])`.
5. Write Pattern-2 boundary smoke test asserting:
   - `GET /cats` → 200 + JSON body matches handler return.
   - `POST /cats` with valid body → 201 + handler-returned status.
   - `POST /cats` with invalid body (Zod rejects) → 422 + envelope `{error: {code: 'VALIDATION_ERROR'}}`.
   - `GET /admin` (with @UseGuards Decorator that returns false) → 401.

#### TDD
```
RED:     test_get_returns_200_and_body
RED:     test_post_valid_body_returns_201
RED:     test_post_invalid_body_returns_422
RED:     test_guard_false_returns_401
GREEN:   Scaffold fixture + implement controllers + run tests.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/integration/basic-controller.test.ts
```

#### Acceptance Criteria
- [ ] All 4 RED tests GREEN.
- [ ] Fixture project boots via `startDevServer` in < 5 seconds.
- [ ] Pattern D4 verified end-to-end.

#### DoD
- [ ] Integration smoke green.

### T-final.2 — Round-trip mount-mechanism verification (NEW in v1.1 — closes ADR D7 + EC-1)

#### Objective
Verify the END-TO-END mount mechanism per ADR D7: `decoratorsBridgePlugin({ controllers: [CatsController] })` written into `fixtures/http-decorators-basic/vite.config.ts` produces (i) `server/routes/__decorated__/.gitignore` auto-created with `*` content; (ii) one generated `.ts` file per route at `server/routes/__decorated__/{path}/{verb}.ts`; (iii) `scanServerRoutes('fixtures/http-decorators-basic/server')` returns the emitted routes as `ServerRouteNode[]`; (iv) `fetch http://localhost:${port}/cats` reaches the user's `findAll()` handler.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — single end-to-end test that proves the entire mount mechanism works. If this passes, EC-1 is closed; if it fails, the bridge is still inert.
2. **Why it is necessary now** — without this, ADR D7 is theoretical. T-final.1 verifies the integration via fetch, but T-final.2 verifies the underlying mechanism (gitignore + file emission + scanner pick-up) so a future regression in the Vite plugin doesn't silently break the scanner contract.

#### Evidence
- ADR D7 + EC-1.

#### Files to edit
```
packages/http-decorators/tests/integration/mount-mechanism.test.ts (NEW)
fixtures/http-decorators-basic/vite.config.ts (UPDATE — add decoratorsBridgePlugin({controllers: [CatsController]}) to plugins)
```

#### Tasks
1. Wire the Vite plugin into `fixtures/http-decorators-basic/vite.config.ts`.
2. Write RED tests:
   - `test_gitignore_auto_written` — fixture has no `__decorated__/` before; after Vite buildStart, dir exists with `.gitignore` containing `*`.
   - `test_one_file_per_route_emitted` — CatsController with 2 methods → 2 files in `__decorated__/`.
   - `test_scanner_picks_up_emitted_files` — `scanServerRoutes(fixture/server)` returns the 2 routes as `ServerRouteNode[]`.
   - `test_fetch_reaches_user_handler_via_emitted_route` — `fetch http://localhost:${port}/cats` returns the value returned by `CatsController.findAll()`.

#### TDD
```
RED:     test_gitignore_auto_written
RED:     test_one_file_per_route_emitted
RED:     test_scanner_picks_up_emitted_files
RED:     test_fetch_reaches_user_handler_via_emitted_route
GREEN:   Plugin already implemented in T3.5; tests verify end-to-end behavior.
VERIFY:  pnpm --filter @theokit/http-decorators test tests/integration/mount-mechanism.test.ts
```

#### Acceptance Criteria
- [ ] 4 RED tests GREEN.
- [ ] EC-1 explicitly verified — `RouteRegistration` array is no longer the integration boundary; emitted-file-pickup by scanner IS.
- [ ] ADR D7 mount mechanism proven end-to-end.

#### DoD
- [ ] Round-trip green.
- [ ] No "PLANO PRECISA DE AJUSTE" residual edge cases.

### Execution

Run the full validation chain:

```bash
pnpm --filter @theokit/http-decorators test         # all package tests (unit + contract + integration)
pnpm --filter @theokit/http-decorators build        # tsup + tsc d.ts emission
pnpm typecheck                                       # workspace-wide; zero type errors
pnpm lint                                            # workspace-wide; zero warnings on changed files
pnpm test                                            # workspace-wide test suite (catches regressions in generate.ts T5.1)
```

### Acceptance Criteria

- [ ] All test suites green (unit + contract + integration).
- [ ] Coverage ≥ 90% on `packages/http-decorators/src/`; critical paths (`walk-metadata.ts`, `register-controllers.ts`) at 100%.
- [ ] Zero type errors (`pnpm typecheck` exit 0).
- [ ] Zero lint warnings on changed files (`pnpm lint`).
- [ ] Pattern D6 contract test (T1.3) GREEN — no deep imports.
- [ ] All 6 Pattern contract tests GREEN (D1+D2+D3 from T3.4, D6 from T1.3, D4 implicit via T-final.1, D5 implicit via T5.1).

### If Validation Fails

1. Identify which failures are caused by this plan's changes vs pre-existing (e.g., `generate.ts` regressions are this plan's; unrelated test failures are pre-existing).
2. Fix all plan-caused failures before declaring the plan complete.
3. Re-run the validation chain.
4. Pre-existing issues logged in the PR description but do NOT block plan completion.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Sub-goal 1 — Package scaffold with Legacy decorator tsconfig (Pattern D1) | T0.1, T1.1, T3.4 (D1 contract) | Scaffold created in T1.1; pre-flight in T0.1; D1 contract test in T3.4 |
| 2 | Sub-goal 2 — `@Controller` + 8 HTTP-verb decorators (Pattern D6 + R1+R2) | T1.2, T1.4, T1.5 | Metadata facade T1.2; @Controller T1.4; 8 verbs T1.5 |
| 3 | Sub-goal 3 — 9 parameter decorators (R3) | T2.1 | All 9 implemented in T2.1 |
| 4 | Sub-goal 4 — 3 response-shape decorators (R4) | T2.2 | All 3 implemented in T2.2 |
| 5 | Sub-goal 5 — DTO ↔ Zod static-schema bridge (Pattern D2 + R5) | T3.1, T3.4 (D2 contract), T6.1 | resolveDtoSchema T3.1; D2 contract test T3.4; documented T6.1 |
| 6 | Sub-goal 6 — Guards/Interceptors → defineMiddleware (Pattern D3 + R6) | T4.1, T4.2, T3.4 (D3 contract) | Decorators T4.1; bridge wrap T4.2; D3 contract T3.4 |
| 7 | Sub-goal 7 — `theokit generate controller` (Pattern D5 + R7) | T5.1 | Single-touch CLI extension |
| 8 | Sub-goal 8 — Pattern-2 boundary smoke (Pattern D4 + R8) | T-final.1, T6.1 | Integration test T-final.1; migration guide T6.1 |
| 9 | Sub-goal 9 — Barrel imports only (Pattern D6 + R9) | T1.3, T3.3 | Contract test T1.3; enforced at T3.3 (first TheoKit import) |
| 10 | Bridge engine core | T3.2, T3.3 | walkControllerMetadata T3.2; registerControllers T3.3 |
| 11 | Q1 — virtual routes vs build-time emission decision | (resolved at plan time — strategy b) | Documented in Unresolved Questions § Q1 + implemented in T3.3 |
| 12 | Q2 — Guard returning false → wire format | (resolved at plan time — AuthRequiredError) | Documented in Unresolved Questions § Q2 + implemented in T4.2 |
| 13 | Q3 — multiple @UseGuards composition | (resolved at plan time — declaration order, sequential, short-circuit) | Documented in Unresolved Questions § Q3 + tested in T4.2 |
| 14 | Q4 — @HostParam / Controller({host}) in v0.1.0 | (resolved at plan time — metadata captured, enforcement deferred) | Documented in Unresolved Questions § Q4 + warning emitted in T3.2 |
| 15 | Sub-goal 10 (v1.1) — Vite plugin mount mechanism (ADR D7 + EC-1) | T3.5, T-final.2 | decoratorsBridgePlugin in T3.5; round-trip verification T-final.2 |
| 16 | EC-2 (v1.1) — Missing @Controller throws HttpDecoratorsConfigError | T3.2 (test added) | `test_walk_throws_when_missing_controller_decorator` |
| 17 | EC-3 (v1.1) — joinPath normalizes leading/trailing slashes | T3.2 (test added + impl required) | `test_join_path_normalizes_leading_trailing_slashes` |
| 18 | EC-4 (v1.1) — Missing consumer emitDecoratorMetadata throws actionable error | T3.2 (test added + impl required) + T6.1 (Troubleshooting doc) | `test_walk_throws_when_design_paramtypes_missing` + migration-guide section |
| 19 | EC-5 (v1.1) — Duplicate controller registration deduped + warned | T3.3 (test added + impl required) | `test_register_duplicate_controllers_dedupes_with_warn` |
| 20 | EC-6 (v1.1) — Method with both @Get + @Post registers both | T1.5 (test added) | `test_method_with_multiple_verb_decorators` |
| 21 | EC-7 (v1.1) — Parameter index gap handled gracefully | T2.1 (test added) | `test_walk_handles_param_index_gap` |
| 22 | EC-8 (v1.1) — Inherited controller methods register correctly | T3.2 (test + impl) | `test_walk_inheritance_child_inherits_parent_methods` |
| 23 | EC-9 (v1.1) — Class+method @UseGuards composition order | T4.1 (test added) | `test_class_and_method_use_guards_compose` |
| 24 | EC-10 (v1.1) — Guard throws propagates as 500 (not 401) | T4.2 (test added) | `test_guard_canactivate_throws_propagates_as_500_not_401` |
| 25 | EC-11 (v1.1) — reflect-metadata auto-imported by package's storage.ts | T1.2 (test added) | `test_consumer_inherits_reflect_metadata_via_package_import` |
| 26 | EC-12 (v1.1) — Singleton-scope-only documented | T6.1 (README Limitations) | § Limitations § Singleton scope only |
| 27 | EC-13 (v1.1) — Interceptor can't-skip-next limitation documented | T6.1 (README Limitations) | § Limitations § Interceptor wrap |
| 28 | EC-14 (v1.1) — Handler returning Response makes decorators no-op documented | T6.1 (README Limitations) | § Limitations § Response precedence |
| 29 | EC-15 (v1.1) — CLI help string includes 'controller' | T5.1 (cli/index.ts:52 + test) | `test_generate_controller_help_lists_5_verbs` |

**Coverage: 29/29 gaps covered (100%) — 14 original (v1.0) + 15 v1.1 additions (1 sub-goal + 14 edge cases).**

## Global Definition of Done

- [ ] All phases completed (Phase 0 → Phase 6 → Final Integration).
- [ ] All tests passing — `pnpm test` workspace-wide green.
- [ ] Zero type errors — `pnpm typecheck` exit 0.
- [ ] Zero lint warnings — `pnpm lint` zero on changed files.
- [ ] File-size budget respected per `.claude/rules/architecture.md` v3.1 (default 500 LoC; every changed file ≤ 350 LoC except possibly `walk-metadata.ts` ≤ 300).
- [ ] `CHANGELOG.md` updated under `[Unreleased]` (Unbreakable Rule 6) with `### Added` entry referencing `@theokit/http-decorators` v0.1.0-alpha.0.
- [ ] Backward compatibility preserved across public API — existing 4 CLI verbs work; `defineRoute` / `defineMiddleware` signatures unchanged.
- [ ] Pattern D1-D6 each has at least one passing contract test (6 distinct test files minimum).
- [ ] Pattern-2 boundary smoke against `fixtures/http-decorators-basic/` GREEN (Goal-mandated).
- [ ] No `any` in production code (per `.claude/rules/type-safety.md`).
- [ ] No `@ts-ignore` / `@ts-expect-error` in production code.
- [ ] Pattern D6 (no deep imports) contract test GREEN.
- [ ] `pnpm validate:publint` + `pnpm validate:attw` PASS on the new package.
- [ ] **Runtime-metric proof** — `walkControllerMetadata` cache-hit counter observed non-zero in T-final.1's second request (i.e., walk runs once per process, not per request). If counter is per-request, optimize before declaring done.
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR has been merged, move this plan to `.claude/knowledge-base/plans/completed/theokit-http-decorators-v0-1-0-plan.md`. Associated artifacts (confidence reports, edge-case reports, implementation md, review reports) stay in their original locations per `.claude/rules/audit-trail-rotation.md`.
