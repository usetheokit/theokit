---
slug: http-decorators-middleware-interceptors
created_at: 2026-06-09
goal: Ship interceptor execution + NestJS middleware class support in @theokit/http-decorators so that @UseInterceptors runs a pre/post handler chain and class/functional middleware can be applied per-route via configure(), measured by 15+ new tests GREEN covering interceptor chain, middleware class, functional middleware, forRoutes filtering, and HTTP roundtrip e2e.
---

# Plan: `@theokit/http-decorators` — Interceptor execution + NestJS Middleware support

> **Version 1.1** (2026-06-09) — Absorbed 3 MUST FIX from edge-case review: EC-1 (interceptor wraps handler-only, not body parsing), EC-2 (interceptor interface includes `res` for header access), EC-3 (extract `resolveOrNew` to shared `bridge/di-resolve.ts` before adding 4th copy). Plus 4 SHOULD TEST items folded into TDD sections.
>
> **Version 1.0** — Close two gaps in the decorator package: (1) `@UseInterceptors` metadata is stored but never executed — interceptor classes need an `intercept(req, next)` chain in all 3 request handlers. (2) NestJS-style Middleware class (`@Injectable` + `use(req, res, next)`) and functional middleware with `forRoutes`/`exclude` route filtering are missing. Both gaps are code-dead without execution, violating the "if you store it, you use it" principle. Full-stack integrated with the `decorator-fullstack` fixture.

## Goal

> Enable `@UseInterceptors(LogInterceptor)` to execute a pre/post handler chain and `MiddlewareConsumer.apply(LoggerMiddleware).forRoutes('tasks')` to filter middleware per route in `@theokit/http-decorators`, measured by `pnpm --filter @theokit/http-decorators test` returning exit 0 with ≥ 15 new passing tests covering interceptor execution order, middleware class/functional dispatch, forRoutes/exclude filtering, and HTTP roundtrip validation.

## Context

`@theokit/http-decorators` v0.1.0-alpha.0 shipped 2026-06-09 with 121 tests GREEN (commit `a157d83`). Guards (`@UseGuards`) work end-to-end — metadata stored, composed class-first (EC-9), executed in `runGuards()` across all 3 handlers. Interceptors use the SAME metadata pipeline but execution was deferred. NestJS middleware (the `NestMiddleware.use(req,res,next)` pattern) was never started.

Pattern D3 from the registered skill `theokit-http-decorators-pattern-from-nestjs-patterns` dictates: "@UseGuards + @UseInterceptors both translate to defineMiddleware wraps". TheoKit's `MiddlewareHandler` shape `(request, next) => Response | Promise<Response>` supersets both concepts — Guard = return early, Interceptor = await next + transform.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/http-decorators/src/bridge/create-server.ts` | 324 | `f4ffe0c` (2026-06-09) | Standalone HTTP server from controller classes; runs guards but NOT interceptors | Guard execution pattern at lines 104, 136-154 is the model to follow |
| `packages/http-decorators/src/theokit-plugin.ts` | 370 | `1964636` (2026-06-09) | TheoKit integration plugin; `controllersGlob` + SWC lazy loading + onRequest hook | Same guard pattern at lines 175, 201-217; `handleDecoratorRoute` is the insertion point |
| `packages/http-decorators/src/app.ts` | 306 | `fdc30d5` (2026-06-09) | `TheoApp.create()` Spring Boot-style bootstrap | Guard execution at lines 192-199; mirror interceptor logic |
| `packages/http-decorators/src/decorators/middleware.ts` | 17 | `0b7cef6` (2026-06-09) | `@UseGuards` + `@UseInterceptors` metadata storage | Add `@Middleware` decorator + middleware consumer types |
| `packages/http-decorators/src/bridge/walk-metadata.ts` | 132 | `1964636` (2026-06-09) | Metadata walker producing `WalkResult` with `guards` + `interceptors` arrays | `interceptors: Function[]` already populated; need to add middleware metadata |
| `packages/http-decorators/src/bridge/interceptor-chain.ts` (NEW) | 0 | — | Interceptor execution engine | — |
| `packages/http-decorators/src/bridge/middleware-consumer.ts` (NEW) | 0 | — | MiddlewareConsumer with forRoutes/exclude | — |
| `packages/http-decorators/src/index.ts` | ~40 | `0b7cef6` (2026-06-09) | Public barrel | Export new types (Interceptor interface, MiddlewareConsumer) |
| `tests/unit/interceptor-chain.test.ts` (NEW) | 0 | — | Unit tests for interceptor execution | — |
| `tests/integration/interceptor-roundtrip.test.ts` (NEW) | 0 | — | HTTP roundtrip with interceptors | — |
| `tests/unit/middleware-consumer.test.ts` (NEW) | 0 | — | MiddlewareConsumer unit tests | — |
| `tests/integration/middleware-roundtrip.test.ts` (NEW) | 0 | — | HTTP roundtrip with middleware | — |
| `fixtures/decorator-fullstack/server/controllers/tasks.controller.ts` | 57 | `1964636` (2026-06-09) | Fixture controller with guards | Add interceptor + middleware demo |

### Current callers / dependents

- **Symbol:** `walk.interceptors` in `WalkResult`
  - **Callers (production):** NONE — collected in walk-metadata.ts:129 but never read by any handler
  - **Callers (tests):** `tests/unit/middleware-decorators.test.ts` (metadata storage only)

- **Symbol:** `runGuards()` in create-server.ts / theokit-plugin.ts / app.ts
  - **Callers:** `handleRequest()` line 104, `handleDecoratorRoute()` line 175, `TheoApp` handler line 192
  - **Pattern to replicate:** same for `runInterceptors()`

### Domain glossary

- **Guard** — class with `canActivate(req): boolean | Promise<boolean>`. Short-circuits request on false.
- **Interceptor** — class with `intercept(req, next): Promise<unknown>`. Wraps handler — can transform request/response or short-circuit.
- **Middleware** — NestJS pattern: class with `use(req, res, next)` or plain function `(req, res, next) => void`. Runs BEFORE guards/interceptors.
- **MiddlewareConsumer** — builder API: `consumer.apply(M).forRoutes('path').exclude('other')`.

### Architecture boundaries affected

- `packages/http-decorators/` is a standalone package consuming `theokit/server` barrel only (barrel-only imports per the registered patterns skill). No TheoKit core changes.
- New files (`interceptor-chain.ts`, `middleware-consumer.ts`) stay inside `bridge/` — same layer as existing `create-server.ts`.

## Prior Art & Related Work

- **Patterns skill:** `theokit-http-decorators-pattern-from-nestjs-patterns` — Pattern D3 ("@UseGuards + @UseInterceptors both translate to defineMiddleware wraps")
- **NestJS Middleware chapter** (user-provided reference, 2026-06-09) — class middleware, functional middleware, MiddlewareConsumer API, forRoutes/exclude, global middleware
- **TheoKit core:** `packages/theo/src/server/define/define-middleware.ts` — `MiddlewareHandler = (request, next) => Response | Promise<Response>`
- **Guard execution pattern:** `create-server.ts:136-154` — proven sequential execution with DI resolution + short-circuit

## Objective

- [ ] `@UseInterceptors(LogInterceptor)` executes `intercept(req, next)` chain in all 3 handlers
- [ ] Interceptor interface exported: `{ intercept(req, next): Promise<unknown> }`
- [ ] Interceptor composition: class-level FIRST, then method-level (same as guards per EC-9)
- [ ] Interceptor DI resolution via `resolveOrNew()` (same as guards)
- [ ] NestJS `Middleware` class support: `use(req, res, next)` with DI
- [ ] Functional middleware: plain `(req, res, next) => void`
- [ ] `MiddlewareConsumer` with `apply().forRoutes().exclude()` builder
- [ ] Middleware runs BEFORE guards (NestJS order: middleware → guards → interceptors → handler)
- [ ] Full-stack fixture updated with interceptor + middleware demo

## ADRs

### D1 — Interceptor interface uses `(req, next) => Promise<unknown>` NOT RxJS Observable

**Decision:** `intercept(request: IncomingMessage, response: ServerResponse, next: () => Promise<unknown>): Promise<unknown>` — includes `response` for header access (EC-2 MUST FIX)

**Rationale:** Per Pattern D3, TheoKit's `MiddlewareHandler` shape supersets both Guard and Interceptor. RxJS Observable adds ~30KB peer dep for zero TheoKit value. The `next()` Promise pattern covers all real use cases: logging, timing, response transform, caching.

**Alternatives:** (a) NestJS `CallHandler` with Observable — adds RxJS dep, complex; (b) Express-style `(req, res, next)` — loses return-value transform capability.

**Consequences:** NestJS teams using `Observable.pipe(map(...))` in interceptors need minor migration (replace with `const result = await next(); return transform(result)`).

### D2 — Middleware execution order: Middleware → Guards → Interceptors → Handler

**Decision:** Follow NestJS execution pipeline order exactly.

**Rationale:** NestJS migration teams expect this order. Middleware runs first (logging, CORS, body parsing), guards second (auth check), interceptors third (response transform, caching), handler last.

**Alternatives:** (a) Merge middleware into guards — loses the distinction; (b) Run interceptors before guards — breaks NestJS semantics.

**Consequences:** 3-layer execution pipeline in each handler function. Complexity is linear (each layer is a sequential loop).

### D3 — MiddlewareConsumer is config-time builder, NOT runtime decorator

**Decision:** `configure(consumer: MiddlewareConsumer)` method on the module class (NestJS pattern). The consumer produces a flat list of `{ middleware, routes, excludes }` entries resolved at controller registration time.

**Rationale:** Route filtering (`forRoutes`, `exclude`) needs the full route table to resolve. This is available at controller registration time, not at decorator evaluation time. Following NestJS's `NestModule.configure()` pattern.

**Alternatives:** (a) `@UseMiddleware` decorator per method — loses route-pattern filtering; (b) Global-only middleware via `app.use()` — loses per-route granularity.

**Consequences:** Users implement `configure(consumer)` on the module class passed to `TheoApp.create()` or `httpDecoratorsPlugin()`.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| 3-layer pipeline (middleware→guards→interceptors) adds latency per request | Low | Each layer is O(n) sequential; n is typically 1-3. Benchmark in e2e test. | implementer |
| MiddlewareConsumer API surface area is large (forRoutes + exclude + wildcards) | Medium | v0.1: support string paths only, no regex. Wildcards deferred to v0.2. | implementer |
| Interceptor `next()` must wrap the entire handler+body-parse+args-build chain | Medium | Extract handler execution into a standalone async function that `next()` calls | implementer |

## Unresolved Questions

- Q1 — Should interceptors receive the parsed `body` or the raw `IncomingMessage`? Decision: raw request (interceptors run BEFORE body parsing in NestJS). Body is parsed inside the handler chain that `next()` wraps.

## Dependency Graph

```
Phase 1 (Interceptor engine) ──▶ Phase 2 (Middleware support) ──▶ Phase 3 (Full-stack integration)
```

All phases are sequential — each builds on the previous.

---

## Phase 1: Interceptor Execution Engine

**Objective:** Make `@UseInterceptors` actually execute interceptor classes in all 3 request handlers.

### T1.1 — Interceptor interface + chain runner

#### Objective
Define the `Interceptor` interface and implement `runInterceptors()` that wraps the handler in a chain.

#### Why this step
**Action:** Create `interceptor-chain.ts` with the `Interceptor` interface and `runInterceptors()` function that composes interceptors around a handler function using the onion model (outermost interceptor wraps innermost = handler).

**Reasoning:** Pattern D3 says "Interceptors await next(request) + transform Response". The guard pattern (`runGuards()`) already proves the sequential-loop-with-DI-resolution model works. Interceptors differ only in that they WRAP (onion) instead of short-circuit (linear).

#### Evidence
- `walk.interceptors` populated at `walk-metadata.ts:129` but never consumed
- Guard execution at `create-server.ts:136-154` is the proven pattern
- Pattern D3: "Emit a single defineMiddleware wrap per route"

#### Files to edit
```
packages/http-decorators/src/bridge/interceptor-chain.ts (NEW) — Interceptor interface + runInterceptors()
packages/http-decorators/src/index.ts — Export Interceptor interface
tests/unit/interceptor-chain.test.ts (NEW) — Unit tests
```

#### Deep file dependency analysis
- `interceptor-chain.ts` (NEW): exports `Interceptor` interface + `runInterceptors(interceptors, handler, req, container)`. Uses `resolveOrNew()` from existing DI helper (extract to shared module or inline).
- `index.ts`: adds `export type { Interceptor } from './bridge/interceptor-chain.js'`

#### Deep Dives

**Onion model:**
```
Interceptor1.intercept(req, () =>
  Interceptor2.intercept(req, () =>
    handler(req)  // innermost = actual route handler
  )
)
```

The chain is built by folding `walk.interceptors` from RIGHT to LEFT (last interceptor wraps first):
```typescript
let chain = handler
for (const InterceptorCtor of interceptors.reverse()) {
  const instance = resolveOrNew(InterceptorCtor, container)
  const nextFn = chain
  chain = () => instance.intercept(req, nextFn)
}
return chain()
```

#### Pseudo-code / Signatures

```typescript
export interface Interceptor {
  intercept(
    request: IncomingMessage,
    response: ServerResponse,  // EC-2: res access for headers (X-Response-Time etc.)
    next: () => Promise<unknown>,
  ): Promise<unknown>
}

export async function runInterceptors(
  interceptors: Function[],
  handler: () => Promise<unknown>,
  req: IncomingMessage,
  res: ServerResponse,         // EC-2: passed through to each interceptor
  container?: DiContainer,
): Promise<unknown> {
  let chain = handler
  for (const Ctor of [...interceptors].reverse()) {
    const instance = resolveOrNew(Ctor, container) as Interceptor
    const nextFn = chain
    chain = () => instance.intercept(req, res, nextFn)
  }
  return chain()
}
```

#### Tasks
1. Extract `resolveOrNew()` from create-server.ts/theokit-plugin.ts/app.ts to `src/bridge/di-resolve.ts` (EC-3 MUST FIX — DRY before adding 4th copy)
2. Create `src/bridge/interceptor-chain.ts` with `Interceptor` interface + `runInterceptors()`
3. Export `Interceptor` from `src/index.ts`
4. Write unit tests (including EC-4 error propagation + EC-5 double-next guard)

#### TDD
```
RED:     test_single_interceptor_wraps_handler — expect interceptor.intercept called with next, handler result returned
RED:     test_multiple_interceptors_onion_order — expect outer runs first, inner second, handler last
RED:     test_interceptor_can_transform_response — expect modified result returned
RED:     test_interceptor_can_short_circuit — expect handler NOT called when interceptor skips next()
RED:     test_interceptor_di_resolution — expect container.resolve() called for interceptor class
RED:     test_interceptor_error_propagates_to_catch — expect thrown error not swallowed by onion (EC-4)
RED:     test_interceptor_double_next_returns_cached — second next() returns same result, handler runs once (EC-5)
GREEN:   Implement runInterceptors() + extract resolveOrNew to bridge/di-resolve.ts (EC-3)
REFACTOR: Update imports in create-server.ts, theokit-plugin.ts, app.ts to use shared resolveOrNew
VERIFY:  npx vitest run tests/unit/interceptor-chain.test.ts
```

#### Concurrency tests
```
(none — single-threaded)
```

### T1.2 — Wire interceptors into all 3 request handlers

#### Objective
Call `runInterceptors()` in `create-server.ts`, `theokit-plugin.ts`, and `app.ts` between guards and response serialization.

#### Why this step
**Action:** In each handler, after guards pass AND body is parsed+validated, wrap ONLY the handler call into an async function and pass it to `runInterceptors()`. Per D2: middleware → guards → body-parse → interceptors → handler. (EC-1 MUST FIX: body parsing stays OUTSIDE the interceptor chain to prevent `ERR_HTTP_HEADERS_SENT` crash when body validation sends 422.)

**Reasoning:** The 3 handlers all follow the same pattern. Interceptors wrap ONLY the handler invocation (not body parsing) so they receive already-validated args and can transform the handler's return value. This matches NestJS where Pipes (validation) run BETWEEN guards and interceptors.

#### Evidence
- `create-server.ts:104` — guards run, then body+args+handler at lines 106-125
- `theokit-plugin.ts:175` — same pattern at lines 175-198
- `app.ts:192` — same pattern

#### Files to edit
```
packages/http-decorators/src/bridge/create-server.ts — Insert runInterceptors wrapping handler
packages/http-decorators/src/theokit-plugin.ts — Same insertion
packages/http-decorators/src/app.ts — Same insertion
tests/integration/interceptor-roundtrip.test.ts (NEW) — HTTP roundtrip with interceptors
```

#### Deep file dependency analysis
- `create-server.ts`: `handleRequest()` at line 103-131. After `runGuards()` AND `resolveBody()` AND `buildArgs()`, wrap ONLY `handler.apply(instance, args)` into async closure. Pass to `runInterceptors(walk.interceptors, closure, req, res, container)`. Result feeds `sendResponse()`. EC-1: body parsing (lines 106-107) stays BEFORE the interceptor chain — if body validation returns BODY_REJECTED, interceptors never run.
- `theokit-plugin.ts`: `handleDecoratorRoute()` at lines 174-198. Same pattern: body parse → args build → interceptor chain → handler.
- `app.ts`: TheoApp handler. Same pattern.

#### Tasks
1. Import `runInterceptors` in all 3 files
2. Wrap handler logic in async closure
3. Call `runInterceptors(walk.interceptors, closure, req, container)`
4. Use the return value for response serialization
5. Write integration test with real HTTP roundtrip

#### TDD
```
RED:     test_interceptor_executes_on_http_request — fetch GET, expect interceptor's side effect visible (e.g., added header)
RED:     test_interceptor_transforms_response — fetch GET, expect interceptor-modified body
RED:     test_class_and_method_interceptors_compose — class-level runs first per EC-9
RED:     test_interceptor_with_guard_order — guard rejects before interceptor runs
GREEN:   Wire runInterceptors in all 3 handlers
REFACTOR: DRY the handler-closure extraction if pattern is identical across 3 files
VERIFY:  npx vitest run tests/integration/interceptor-roundtrip.test.ts
```

#### Concurrency tests
```
(none — single-threaded)
```

---

## Phase 2: NestJS Middleware Support

**Objective:** Implement class + functional middleware with `MiddlewareConsumer` route filtering.

### T2.1 — Middleware types + MiddlewareConsumer builder

#### Objective
Define `NestMiddleware` interface, `MiddlewareConsumer` builder with `apply().forRoutes().exclude()`, and middleware resolution at registration time.

#### Why this step
**Action:** Create `middleware-consumer.ts` with the builder API. Add `@Injectable` marker (re-use reflect-metadata key). The consumer produces a flat array of `ResolvedMiddleware` entries that the request handlers iterate.

**Reasoning:** Per D3, middleware runs BEFORE guards (NestJS pipeline order). The consumer builder resolves route patterns at registration time (when the full route table is available), not at decorator evaluation time.

#### Evidence
- NestJS Middleware chapter: `consumer.apply(LoggerMiddleware).forRoutes('cats')`
- NestJS: class middleware implements `NestMiddleware { use(req, res, next) }`
- NestJS: functional middleware is `(req, res, next) => void`

#### Files to edit
```
packages/http-decorators/src/bridge/middleware-consumer.ts (NEW) — MiddlewareConsumer + NestMiddleware interface
packages/http-decorators/src/index.ts — Export NestMiddleware, MiddlewareConsumer
packages/http-decorators/src/decorators/middleware.ts — Add functional middleware types
tests/unit/middleware-consumer.test.ts (NEW) — Unit tests
```

#### Pseudo-code / Signatures

```typescript
export interface NestMiddleware {
  use(req: IncomingMessage, res: ServerResponse, next: () => void): void | Promise<void>
}

export type MiddlewareFn = (req: IncomingMessage, res: ServerResponse, next: () => void) => void | Promise<void>

export interface MiddlewareConsumer {
  apply(...middleware: Array<Function | MiddlewareFn>): MiddlewareConfigProxy
}

export interface MiddlewareConfigProxy {
  forRoutes(...routes: Array<string | { path: string; method?: string }>): MiddlewareConsumer
  exclude(...routes: Array<string | { path: string; method?: string }>): MiddlewareConfigProxy
}

export interface ResolvedMiddleware {
  handler: MiddlewareFn
  routePatterns: string[]
  excludePatterns: string[]
}
```

#### Tasks
1. Create `src/bridge/middleware-consumer.ts`
2. Implement builder pattern (apply → forRoutes → exclude chain)
3. Export types from `src/index.ts`
4. Write unit tests

#### TDD
```
RED:     test_consumer_apply_class_middleware — apply(LoggerMiddleware) resolves to use() function
RED:     test_consumer_apply_functional_middleware — apply(fn) stores the function directly
RED:     test_consumer_forRoutes_string — forRoutes('cats') stores route pattern
RED:     test_consumer_exclude — exclude('cats/admin') stores exclude pattern
RED:     test_consumer_chain — apply(A).forRoutes('x'); apply(B).forRoutes('y') produces 2 entries
RED:     test_middleware_matches_route — /api/tasks matches 'tasks' pattern
RED:     test_middleware_excludes_route — /api/tasks/admin excluded by 'tasks/admin' pattern
GREEN:   Implement MiddlewareConsumer
REFACTOR: None expected
VERIFY:  npx vitest run tests/unit/middleware-consumer.test.ts
```

#### Concurrency tests
```
(none — single-threaded)
```

### T2.2 — Wire middleware into request pipeline

#### Objective
Execute resolved middleware BEFORE guards in all 3 handlers. Accept `configure` callback in plugin options.

#### Why this step
**Action:** Add `configure?: (consumer: MiddlewareConsumer) => void` to plugin options. At registration time, call `configure(consumer)` to collect middleware entries. In the request handler, run matching middleware BEFORE `runGuards()`.

**Reasoning:** Per D2, NestJS pipeline order is: middleware → guards → interceptors → handler. Middleware are route-filtered — only run for matching routes.

#### Files to edit
```
packages/http-decorators/src/theokit-plugin.ts — Add configure option + middleware execution
packages/http-decorators/src/bridge/create-server.ts — Same
packages/http-decorators/src/app.ts — Same
tests/integration/middleware-roundtrip.test.ts (NEW) — HTTP roundtrip with middleware
```

#### Tasks
1. Add `configure` option to all 3 constructors
2. Call `configure(consumer)` at registration time
3. In request handler, before `runGuards()`, run matching middleware
4. Write integration tests

#### TDD
```
RED:     test_middleware_runs_before_guards — middleware logs, guard checks auth; verify order
RED:     test_middleware_filtered_by_route — middleware on 'tasks' doesn't run on 'users'
RED:     test_middleware_exclude_works — excluded route skips middleware
RED:     test_functional_middleware_http — plain function middleware runs on matching route
GREEN:   Wire middleware in handlers
REFACTOR: Extract middleware matching into shared function
VERIFY:  npx vitest run tests/integration/middleware-roundtrip.test.ts
```

#### Concurrency tests
```
(none — single-threaded)
```

---

## Phase 3: Full-Stack Integration

**Objective:** Update the decorator-fullstack fixture + verify all 136+ tests GREEN.

### T3.1 — Fixture: add interceptor + middleware demo

#### Objective
Add a `TimingInterceptor` and `LoggerMiddleware` to the fixture's `TasksController` and update the frontend to display timing headers.

#### Why this step
**Action:** Create `TimingInterceptor` that measures handler execution time and adds `X-Response-Time` header. Create `LoggerMiddleware` that logs request method + URL. Wire both in the fixture's `theo.config.ts` via `configure(consumer)`.

**Reasoning:** The fixture is the proof that the system works end-to-end in a real TheoKit app. Without this, "it works" is untestable claim.

#### Files to edit
```
fixtures/decorator-fullstack/server/interceptors/timing.interceptor.ts (NEW)
fixtures/decorator-fullstack/server/middleware/logger.middleware.ts (NEW)
fixtures/decorator-fullstack/server/controllers/tasks.controller.ts — Add @UseInterceptors(TimingInterceptor)
fixtures/decorator-fullstack/app/page.tsx — Display X-Response-Time header
```

#### Tasks
1. Create `TimingInterceptor` with `intercept(req, next)` that measures time
2. Create `LoggerMiddleware` with `use(req, res, next)` that logs
3. Add `@UseInterceptors(TimingInterceptor)` to TasksController class level
4. Wire `LoggerMiddleware` via `configure(consumer)` in theo.config.ts
5. Update frontend to show response time

#### TDD
```
RED:     test_timing_interceptor_adds_header — fetch GET, check X-Response-Time header exists
RED:     test_logger_middleware_runs — verify console.log called with request info
GREEN:   Implement interceptor + middleware in fixture
REFACTOR: None expected
VERIFY:  npx vitest run (full suite)
```

#### Concurrency tests
```
(none — single-threaded)
```

---

## Failure scenarios

(none — no external I/O touched. All middleware/interceptor execution is in-process synchronous/async. HTTP server tests use loopback localhost.)

## Coverage Matrix

| Requirement | Task(s) |
|---|---|
| Interceptor interface definition | T1.1 |
| Interceptor onion-model execution | T1.1 |
| Interceptor DI resolution | T1.1 |
| Interceptor wired in create-server.ts | T1.2 |
| Interceptor wired in theokit-plugin.ts | T1.2 |
| Interceptor wired in app.ts | T1.2 |
| Interceptor composition order (class-first EC-9) | T1.2 |
| NestMiddleware interface | T2.1 |
| Functional middleware support | T2.1 |
| MiddlewareConsumer builder (apply/forRoutes/exclude) | T2.1 |
| Middleware route filtering | T2.2 |
| Middleware pipeline order (before guards) | T2.2 |
| Middleware wired in all 3 handlers | T2.2 |
| Full-stack fixture with interceptor + middleware | T3.1 |
| Frontend displays interceptor output | T3.1 |

## Global DoD

- [ ] `npx vitest run` in http-decorators: 136+ tests GREEN (121 existing + 15+ new)
- [ ] `npx tsc --noEmit -p packages/http-decorators/tsconfig.json` exit 0
- [ ] `npx tsup` in http-decorators: build success, all 3 entry points emit
- [ ] No new eslint warnings (`--max-warnings=0`)
- [ ] CHANGELOG.md updated with interceptor + middleware entries under `[Unreleased]`
- [ ] No file exceeds 400 LoC (split if needed)

## Final Phase: Integration Validation

Run in order:
1. `npx vitest run` — full test suite
2. `npx tsc --noEmit -p packages/http-decorators/tsconfig.json` — typecheck
3. `npx tsup` — build
4. `npx vitest run tests/unit/fixtures-index.test.ts --config vitest.config.ts` — fixture README sync
5. Manual: verify `decorator-fullstack` fixture renders timing header in UI
