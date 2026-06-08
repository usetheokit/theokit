---
name: theokit-http-decorators-pattern-from-nestjs-patterns
description: Use when planning `@theokit/http-decorators` v0.1.0 implementation. Use when designing NestJS-style decorator bridges on top of `defineRoute`. Use when deciding between Legacy `experimentalDecorators` vs TC39 Stage-3 decorators in TheoKit packages. Use when wiring `@UseGuards` / `@UseInterceptors` to TheoKit `defineMiddleware`. Use when extending `theokit generate` with a `controller` verb. Use when bridging DTO classes to Zod schemas while preserving the "Zod is the Single Source of Truth" invariant.
user-invocable: true
allowed-tools: Read Glob Grep
generated-from-blueprint: theokit-http-decorators-pattern-from-nestjs
generated-at: 2026-06-07
---

# TheoKit HTTP Decorators — Patterns Library

Knowledge distilled from `/discover-execute theokit-http-decorators-pattern-from-nestjs`. Consult this skill when planning code that matches the trigger phrases in the `description` frontmatter above.

**Source blueprint:** `.claude/knowledge-base/discoveries/blueprints/theokit-http-decorators-pattern-from-nestjs-blueprint.md`

## When /to-plan should consult this skill

`/to-plan` Step 0 SHALL load this skill whenever the topic-slug or plan context matches:

- `@theokit/http-decorators` package (the planned P3 backend DX surface per macro CLAUDE.md)
- NestJS migration topics on TheoKit (DTO bridge, Guards/Interceptors, `@Controller` ergonomics)
- "decorator-style routes on `defineRoute`" framings
- Any package proposing decorator metadata as the primary API surface (`reflect-metadata`, `experimentalDecorators`)
- Extensions of `theokit generate` CLI verbs that target decorator-based scaffolds (`controller`, `resource`)

The Step 0 frontmatter scan of `/to-plan` matches against the `description` field. The phrases above are the canonical triggers.

## Patterns

Each pattern below was extracted from an ADR in the source blueprint. The Rationale, Alternatives, and Consequences are preserved — `/to-plan` uses them to inform implementation decisions WITHOUT re-deriving the same conclusions from scratch.

### Pattern D1 — Ship Legacy decorators (NOT TC39 Stage-3) for v0.1.0

**Pattern:** v0.1.0 enables `experimentalDecorators: true` + `emitDecoratorMetadata: true` (Legacy TS decorators) in the package's own `tsconfig.json`. TC39 Stage-3 deferred to v0.2.0+ follow-up `/discover-plan`.

**Why:** TC39 Stage-3 decorators (mid-2026) deliberately exclude `emitDecoratorMetadata`-style runtime type emission. Without runtime type emit, the `@Body() body: CreateCatDto` parameter pattern cannot resolve the class reference at runtime — that pattern is the core NestJS migration ergonomic. NestJS itself uses Legacy. Teams migrating expect Legacy semantics.

**Other approaches considered:**
- (a) Stage-3 only — bleeding edge; doesn't support runtime type emit; blocks `@Body() body: ClassName` pattern.
- (b) Dual-mode (Legacy + Stage-3) — doubles surface area + maintenance burden.

**When this pattern is the right fit:** decorator-based surface targeting NestJS migration in mid-2026 with reflect-metadata-style parameter injection. **When it's wrong:** if the package only needs class-level decorators (no parameter decorators / no runtime type info), Stage-3 alone is sufficient and avoids the `reflect-metadata` peer dep.

**Consequence:** consumer-app `tsconfig.json` delta = 2 lines (`experimentalDecorators` + `emitDecoratorMetadata`). `reflect-metadata@^0.2.2` declared as required peer dep (~3KB gzipped). Migration path documented for when TC39 + TS support stabilize.

### Pattern D2 — Explicit Zod schema attached to DTO class (NOT auto-bridge from class-validator)

**Pattern:** Require users to attach a `static schema` Zod object on every DTO class. Bridge reads that static field at metadata-walk time and feeds it to `defineRoute({body, query, params})`. Class-validator decorators NOT supported at runtime. An OPTIONAL `@theokit/http-decorators-class-validator-codemod` SEPARATE package handles ~80% of class-validator → Zod migration mechanically (one-time codemod, never runtime bridge).

**Why:** Per `.claude/rules/type-safety.md` "Zod is the Single Source of Truth". An auto-bridge from class-validator → Zod would (i) lose the Zod SSoT invariant; (ii) break on `@Matches` regex modifiers vs Zod regex semantics; (iii) lose OpenAPI generation precision (the G2 plugin needs pure Zod schemas); (iv) require `class-transformer` for `@ValidateNested` instance hydration which then leaks class instances back into Zod-typed code.

**Other approaches considered:**
- (a) Auto-bridge DTO class → Zod schema at runtime via `reflect-metadata` + class-validator decorator introspection — fails (i)-(iv) above.
- (c) Skip Zod entirely; ship only class-validator support — breaks TheoKit's existing OpenAPI emit + tests + type-inference contract.

**When this pattern is the right fit:** any TheoKit package that exposes validation surface to user code. The "Zod is SSoT" invariant is a hard rule in `.claude/rules/type-safety.md` — patterns that route around it are not acceptable. **When it's wrong:** the pattern doesn't apply to packages that don't expose user-facing schemas at all.

**Consequence:** higher migration friction for NestJS teams (1-time codemod cost); preserved type-safety invariant; OpenAPI precision retained. Honest limitations documented (regex modifiers, nested DTOs, optional-vs-nullable, class methods).

### Pattern D3 — `@UseGuards` + `@UseInterceptors` both translate to `defineMiddleware` wraps; `@Catch` Filter deferred

**Pattern:** At metadata-walk time, collect all `@UseGuards(GuardClass)` and `@UseInterceptors(InterceptorClass)` per route method. Emit a single `defineMiddleware` wrap per route that runs Guards first (short-circuit on `canActivate=false`) then Interceptors (await + transform Response). `@Catch(HttpException)` Filter class is deferred to v0.2.0+ follow-up discovery.

**Why:** TheoKit's `MiddlewareHandler` shape `(request, next) => Response | Promise<Response>` SUPERSETS both NestJS concepts:
- Return `Response` early → Guard semantics (short-circuit)
- `await next(request)` then decorate the result → Interceptor semantics (wrap)

NestJS's separation of Guards vs Interceptors is implementation-detail of its RxJS-Observable pipeline; TheoKit's unified Chain of Responsibility (`middleware-runner.ts:72`) doesn't need the separation. Pipes' validation role is already covered by Zod in `defineRoute({body, query, params})` — no separate Pipe surface needed in v0.1.0.

**Other approaches considered:**
- (a) Ship full Guards/Interceptors/Filters/Pipes as first-class v0.1.0 decorators — violates scope discipline; each deserves its own discovery cycle.
- (c) Skip Guards entirely in v0.1.0 — breaks "NestJS-compatible enough" target for migration teams.

**When this pattern is the right fit:** any TheoKit decorator bridge that needs both short-circuit and wrap semantics. **When it's wrong:** if your package needs RxJS-Observable pipeline semantics (true reactive streams with backpressure), `defineMiddleware`'s Promise-based shape is insufficient — but that case has never been requested in TheoKit.

**Consequence:** v0.1.0 covers auth + logging use cases; v0.2.0 follow-up plans Filters (error handling decorators). RxJS is an OPTIONAL peer dep — Interceptor classes returning Observable are supported alongside Promise-returning Interceptors.

### Pattern D4 — Reuse existing TheoKit test harness (`startDevServer` + native `fetch`); ship ZERO new test infrastructure

**Pattern:** v0.1.0 ships no new test package. Users test decorated controllers via the existing TheoKit Pattern 2: `startDevServer(fixtureDir, { port: 0 })` + native `fetch(http://localhost:${port}/...)` — identical to how `defineRoute`-authored routes are tested today. The bridge layer itself ships its own contract test at `@theokit/http-decorators/tests/contract.test.ts` (decorator metadata → generated `defineRoute` shape).

**Why:** Per Rule 9 (Don't Reinvent the Wheel) — `supertest` adds a dependency with no benefit over native `fetch`. The existing Pattern 2 (`tests/integration/onda5-mandatory.test.ts:1-25`) already provides:
- Real HTTP server boot (no mocks)
- Fluent assertion via `expect(res.status).toBe(200)` + `await res.json()`
- Per-test fixture isolation via `fixtures/{name}/`
- `server.close()` cleanup in `afterAll`

A "TestingModule" equivalent is unnecessary because decorator-bridge generates real `defineRoute(...)` files — test those files directly.

**Other approaches considered:**
- (a) Ship `supertest`-equivalent in `@theokit/http-decorators-testing` — adds dep + duplicates existing functionality.
- (c) Mock a `Test.createTestingModule` API — fakes NestJS surface; users get false sense of compatibility, then break when real apps differ.

**When this pattern is the right fit:** any TheoKit package whose integration boundary is HTTP and whose dev-server harness already covers it. **When it's wrong:** if the package boundary is NOT HTTP (e.g., a worker/queue package), the Pattern 2 reuse doesn't apply — design a separate harness or none.

**Consequence:** migration guide ships with v0.1.0 documenting `Test.createTestingModule → startDevServer` + `supertest → fetch` translation. Users keep their existing vitest setup. Zero new test dependencies for consumers.

### Pattern D5 — Extend `theokit generate` with `controller` verb (single template addition, NOT a separate CLI package)

**Pattern:** Add a single entry to `VALID_TYPES` in `packages/theo/src/cli/commands/generate.ts:9` (`['route', 'action', 'page', 'ws', 'controller']`) + one `generateControllerTemplate(name)` inline function mirroring the existing `generateRouteTemplate(name)` pattern at `:129`. No separate `@theokit/http-decorators-cli` package.

**Why:** The addition is ~30 LOC. Discoverable via `theokit generate --help` alongside existing verbs. The generated file imports from `@theokit/http-decorators` but doesn't require it at generate-time — file emission only, so core's `theokit` CLI doesn't link any runtime code from the new package. The minor coupling (core's `VALID_TYPES` array knows the literal string `controller` exists) is acceptable because it's text-only, no module link.

**Other approaches considered:**
- (a) Separate `@theokit/http-decorators-cli` package — duplicates template-resolution + validation infra already in `generate.ts`; less discoverable (extra install).
- (c) Defer CLI extension to v0.2.0 — leaves NestJS migrants without scaffold parity.

**When this pattern is the right fit:** any cross-package CLI extension where the new verb is generative (emits files) and doesn't require runtime linkage. **When it's wrong:** if the verb needs to LOAD the foreign package at runtime (e.g., to introspect its types), separate CLI package is justified.

**Consequence:** adds 1 CLI verb. `nest g resource` (CRUD scaffold) deferred to v0.2.0+ since it needs DTO bridge (Pattern D2) + Guards (Pattern D3) ergonomics validated against real consumers first.

### Pattern D6 — Cross-package imports go through `theokit/server` barrel (Architecture INVARIANT #3)

**Pattern:** All `@theokit/http-decorators` bridge code uses `import { defineRoute, defineMiddleware } from 'theokit/server'` — NEVER deep imports like `theokit/server/define/define-route.js`. The new package is a sibling consumer of `theokit/server`, not a privileged insider.

**Why:** Per `.claude/rules/architecture.md` v3.1 INVARIANT #3 "Public API only flows through barrels". Deep imports couple the bridge to TheoKit's internal layout — every internal refactor risks breaking the bridge. The existing barrel (`packages/theo/src/server/index.ts:105` exports `executeWebRequest` and the relevant `define*` helpers) already exposes what's needed.

**Other approaches considered:**
- (a) Add `@theokit/http-decorators` as a workspace internal — would require deep imports + couple it to internal layout.
- (c) Add a new internal `theokit/server/internals` sub-barrel — proliferates barrels; defeats INVARIANT #3 purpose.

**When this pattern is the right fit:** EVERY external TheoKit package. INVARIANT #3 has no exceptions. **When it's wrong:** never — if the public barrel lacks what you need, add it to the barrel (one PR) before shipping the consumer package.

**Consequence:** bridge code is robust against TheoKit internal refactors. Bridge layer's contract tests verify barrel-import shape (catches accidental deep imports during development).

## Recommendations consolidated

Direct recommendations extracted from the source blueprint's `## Recommendations` section. Each links to the research question(s) that originated it. Use these as the starting ADR set for `/to-plan @theokit/http-decorators`.

1. **`@Controller(prefix?, opts?)`** class decorator — emits route files at build time. Supports `{ host: ':account.example.com' }` optional sub-domain matching. (Origin: Q1.)
2. **HTTP-verb method decorators** — `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head`, `@All` — translate to per-method `defineRoute(...)` factory calls. (Origin: Q1.)
3. **Parameter decorators** — `@Req`, `@Res({passthrough?})`, `@Body(key?)`, `@Query(key?)`, `@Param(key?)`, `@Headers(name?)`, `@Session()`, `@Ip()`, `@HostParam(key?)` — all map to TheoKit's ctx-destructured handler. (Origin: Q1.)
4. **Response-shape decorators** — `@HttpCode(status)`, `@Header(name, value)`, `@Redirect(url, status?)` — all map to `defineRoute({status})` + Response construction. (Origin: Q1.)
5. **DTOs** — explicit Zod schema via `static schema` on the class (Pattern D2). Optional `@theokit/http-decorators-class-validator-codemod` separate package for migration. (Origin: Q2; respects `.claude/rules/type-safety.md`.)
6. **Guards / Interceptors** — `@UseGuards(GuardClass)` + `@UseInterceptors(InterceptorClass)` translate to `defineMiddleware` wraps per Pattern D3. (Origin: Q3.)
7. **CLI** — extend `theokit generate` with `controller` verb per Pattern D5 — generates `server/controllers/{name}.controller.ts`. (Origin: Q6.)
8. **Test harness** — NONE; reuse existing TheoKit Pattern 2 (`startDevServer` + native `fetch`) per Pattern D4. (Origin: Q4; respects Rule 9.)
9. **Architecture barrel discipline** — import only from `theokit/server` barrel per Pattern D6 — respects `.claude/rules/architecture.md` v3.1 INVARIANT #3. (Origin: cross-cutting.)

**Out of scope for v0.1.0** (deferred to follow-up `/discover-plan` cycles — `/to-plan` SHOULD treat these as ADR-deferred items, not as missing-coverage gaps):

- NestJS Pipes / Filters / Modules / Providers / DI (delegate Providers/DI to `@theokit/di`).
- TC39 Stage-3 decorators (Legacy in v0.1.0 per Pattern D1).
- `nest g resource` CRUD scaffold (deferred until DTO bridge + Guards ergonomics validated in production).

**Bundle cost commitments:** opt-in consumers add ~8-13KB gzipped (`reflect-metadata` ~3KB + new package ~5-10KB). Non-opt-in consumers: 0KB.

## Quick reference

Cross-cutting comparison condensed from the blueprint's `## Cross-cutting Comparison` table. Useful as a glance reference when `/to-plan` is weighing trade-offs.

| Concern | NestJS | TheoKit current | `@theokit/http-decorators` v0.1.0 |
|---|---|---|---|
| Routing model | Class + decorator metadata via reflect-metadata | File-system convention + `defineRoute({...})` factory | Bridge: walk decorator metadata → emit `defineRoute(...)` per `@Get`/`@Post`/etc. |
| Handler shape | Class method with parameter decorators | `({query, body, params, ctx}) => Response \| value` | Bridge: map decorated params to ctx-destructured handler at metadata-walk time |
| Validation | DTO class + `class-validator` via `ValidationPipe` | Zod in `{query, body, params}` — single source of truth | Pattern D2: explicit Zod via `static schema`; optional codemod for class-validator migration |
| Pre-handler hooks | Guards + Interceptors (separate concepts) | `defineMiddleware((request, next) => Response)` | Pattern D3: both `@UseGuards` + `@UseInterceptors` translate to TheoKit middleware wraps |
| Module DI | `@Injectable` + `@Module({providers, controllers})` | `@theokit/di` separate package | OUT OF SCOPE per ADR D4 (delegate to `@theokit/di`) |
| Test convention | `@nestjs/testing` + supertest | `startDevServer(fixtureDir, {port:0})` + native `fetch` | Pattern D4: reuse TheoKit Pattern 2; no new harness |
| CLI scaffold | `nest g controller [name]` | `theokit generate {route,action,page,ws} <name>` | Pattern D5: extend with `theokit generate controller <name>` (single template addition) |
| TS config requirements | `experimentalDecorators` + `emitDecoratorMetadata` + `reflect-metadata` peer | None (no decorator flags in `tsconfig.json:1-22`) | Pattern D1: NEW package's own tsconfig opts in; core TheoKit unchanged |
| Runtime bundle delta (opt-in path) | reflect-metadata ~3KB + class-validator ~22KB | 0 | reflect-metadata ~3KB + new package ~5-10KB = ~8-13KB; class-validator path 0KB if user follows Pattern D2 |

**Key consolidating insight:** TheoKit's existing factory-function model (`defineRoute` identity + Zod single-source) is fundamentally closer to Fastify's imperative-handler shape than to NestJS's class-based metadata model. The `@theokit/http-decorators` bridge is a *thin translation layer* (decorator metadata → `defineRoute(...)` factory calls), NOT a re-implementation of NestJS's dispatch internals. This is what makes v0.1.0 feasible at ~5-10KB package size — the heavy lifting (validation, routing, middleware) already lives in TheoKit core; the bridge only translates the surface ergonomics.

## Key evidence

These citations to `.claude/knowledge-base/references/` and `packages/theo/src/` appeared in 2+ different sections of the source blueprint — they are load-bearing for the patterns above. Re-verify them when revisiting this skill (paths may drift if `.claude/knowledge-base/references/` clones are refreshed).

**TheoKit core (in-tree — anchor evidence for every pattern):**
- `packages/theo/src/server/define/define-route.ts:14` — `defineRoute` identity factory (referenced by Patterns D1, D5, D6; Q1 + Cross-cutting)
- `packages/theo/src/core/contracts/route-config.ts:14-40` — `RouteConfig` 5-arity interface (Q1 + Cross-cutting)
- `packages/theo/src/server/define/define-middleware.ts:1-12` — `defineMiddleware` + `MiddlewareHandler` type (Pattern D3; Q3 + Cross-cutting)
- `packages/theo/src/server/http/middleware-runner.ts:72` — `runMiddlewareAndContext` chain executor (Pattern D3; Q3 + Cross-cutting)
- `packages/theo/src/server/http/action-execute.ts:34-59` — `ZodLike` minimal structural contract (Pattern D2; Q2 + Cross-cutting)
- `packages/theo/src/server/index.ts:105` — `export { executeWebRequest }` public barrel (Pattern D6)
- `packages/theo/src/cli/commands/generate.ts:9-11` — `VALID_TYPES` array (Pattern D5; Q6 + Cross-cutting)
- `packages/theo/src/cli/commands/generate.ts:129` — `generateRouteTemplate(name)` inline template pattern (Pattern D5 mirror target)
- `tsconfig.json:1-22` — root tsconfig with NO decorator flags (Pattern D1 pre-validated state)
- `tests/integration/onda5-mandatory.test.ts:1-25` — Pattern 2 boundary smoke test (Pattern D4; Q4 + Cross-cutting)

**Fastify (comparative — routing dispatch internals):**
- `.claude/knowledge-base/references/fastify/lib/handle-request.js:20` — `handleRequest(err, request, reply)` orchestrator entry (Q1 + Cross-cutting)
- `.claude/knowledge-base/references/fastify/lib/route.js:120` — `router.lookup.bind(router)` route registration (Q1 + Cross-cutting)
- `.claude/knowledge-base/references/fastify/lib/decorate.js:77` — `decorate(this, name, fn, dependencies)` runtime decoration API (Q1 comparative)

## How `/to-plan` consumes this

When a topic-slug or plan context matches one of the trigger phrases in `description`, `/to-plan` Step 0 reads this SKILL.md in addition to `.claude/rules/`. The plan it produces SHOULD:

- Cite the Patterns above when the implementation decision matches one (e.g., a plan task "wire `@UseGuards`" SHOULD cite Pattern D3 rather than re-deriving the Guard vs Interceptor mapping).
- Reference the Recommendations as ADR alternatives in the plan's own ADR section (e.g., the plan's "decorator runtime" ADR SHOULD list Pattern D1's "Stage-3 only" and "Dual-mode" as the rejected alternatives).
- Use the Key evidence citations as anchor evidence for any task that touches `defineRoute`, `defineMiddleware`, or `generate.ts`.

The `/to-plan` quality rules forbid the plan from CONTRADICTING a Pattern here without an explicit ADR. To override a Pattern, the plan must include an ADR that names this skill + the specific pattern + the reason for divergence. Example: a plan that wants to ship class-validator runtime support MUST include an ADR explaining why Pattern D2's "Zod SSoT" rationale no longer holds for that context.

## Audit

- Generated from blueprint at `.claude/knowledge-base/discoveries/blueprints/theokit-http-decorators-pattern-from-nestjs-blueprint.md`
- Blueprint verdict at generation time: `SHIPPABLE_WITH_CAVEATS` (score `89.0`)
- Generation timestamp: `2026-06-07`
- Marker file `.source-blueprint` in this skill dir preserves the audit chain

To rollback: `mv .claude/skills/theokit-http-decorators-pattern-from-nestjs-patterns/ .claude/skills/generated/theokit-http-decorators-pattern-from-nestjs-patterns/` and delete the corresponding audit entry in `.claude/knowledge-base/reviews/skill-register-*.md`.
