---
slug: theokit-runtime-optimization
created_at: 2026-06-10
goal: Migrate the TheoKit decorator pipeline from node:http IncomingMessage/ServerResponse to Web Standard Request/Response, add runtime adapters (Node/Bun/Deno), memoize metadata walks, and add sub-path exports, measured by pnpm --filter @theokit/http-decorators test && pnpm --filter @theokit/agents test returning exit 0 with ALL existing tests GREEN plus 31+ new tests covering the adapter layer, memoization, and bundle validation.
---

# Plan: TheoKit Runtime Optimization

> **Version 1.1** (2026-06-10) — Absorbed 2 MUST FIX: EC-1 (streaming body via ReadableStream.from), EC-2 (SSE handler returns Response with ReadableStream). Plus 3 SHOULD TEST (EC-3 body consumed twice, EC-4 HTTP/2 compat, EC-5 subclass memoization). 1 DOCUMENT (EC-6 Response immutability pattern shift).
>
> **Version 1.0** — Migrate the decorator pipeline from Node.js `node:http` lock-in to Web Standard `Request`/`Response`, enabling native Bun.serve(), Deno.serve(), and Cloudflare Workers support. Add metadata memoization for startup performance. Add sub-path exports for tree-shaking. Zero breaking change to decorator API — internal refactor only.

## Goal

> Migrate the TheoKit decorator pipeline (`@theokit/http-decorators` + `@theokit/agents`) from `node:http` `IncomingMessage`/`ServerResponse` to Web Standard `Request`/`Response` and ship runtime adapters (Node/Bun), measured by `pnpm --filter @theokit/http-decorators test && pnpm --filter @theokit/agents test` returning exit 0 with ALL existing 382 tests GREEN plus 31+ new tests covering the Web Standards adapter, memoization cache, sub-path exports, and Bun adapter.

## Context

The decorator pipeline is built on `node:http` — 10 files import `IncomingMessage`/`ServerResponse` as their public interface. This locks the pipeline to Node.js. Bun.serve() and Deno.serve() use Web Standard `Request`/`Response` which is 4x faster on Bun because it avoids the Node.js compatibility shim. Hono (in our references) proves that a middleware framework can be runtime-agnostic by building on `Request`/`Response`.

Current state: 7 files in http-decorators + 3 files in agents import `node:http`. Metadata walks (`walkControllerMetadata`, `walkAgentMetadata`) are NOT memoized. agents package has only 1 export entry point (no sub-path exports).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Why it exists | Invariants to preserve |
|---|---|---|---|
| `packages/http-decorators/src/bridge/execution-context.ts` | 63 | ExecutionContext + CanActivate interfaces | Guard/interceptor contract — MUST remain backward-compatible |
| `packages/http-decorators/src/bridge/create-server.ts` | 338 | HTTP server factory + request handler | Route matching, body parsing, pipeline order |
| `packages/http-decorators/src/bridge/interceptor-chain.ts` | 63 | Interceptor interface + runner | Onion model, memoized next() |
| `packages/http-decorators/src/bridge/exception-filter-chain.ts` | 97 | ExceptionFilter + runner | Recursion guard, headersSent check |
| `packages/http-decorators/src/bridge/middleware-consumer.ts` | 194 | NestMiddleware + consumer builder | apply().forRoutes().exclude() API |
| `packages/http-decorators/src/bridge/walk-metadata.ts` | 136 | walkControllerMetadata() | Pure function contract |
| `packages/http-decorators/src/theokit-plugin.ts` | ~300 | TheoKit plugin integration | Plugin structural shape |
| `packages/http-decorators/src/app.ts` | ~320 | TheoApp.create() | Controllers + agents options |
| `packages/agents/src/bridge/agent-sse-handler.ts` | 51 | SSE streaming | res.destroyed guard |
| `packages/agents/src/bridge/agent-route-generator.ts` | 99 | Auto route generation | POST /chat + GET /runs/:id |
| `packages/agents/src/bridge/agent-execution-context.ts` | 48 | AgentExecutionContext extends ExecutionContext | LSP compliance |
| `packages/agents/src/theokit-plugin.ts` | 122 | agentsPlugin() | Plugin structural shape |
| `packages/http-decorators/src/bridge/web-adapter.ts` (NEW) | 0 | Web Standard Request/Response adapter | — |
| `packages/http-decorators/src/bridge/runtime/node.ts` (NEW) | 0 | Node.js runtime adapter | — |
| `packages/http-decorators/src/bridge/runtime/bun.ts` (NEW) | 0 | Bun runtime adapter | — |
| `packages/http-decorators/tsup.config.ts` | 10 | Build config | ESM + DTS |
| `packages/agents/tsup.config.ts` | 10 | Build config | ESM + DTS |
| `packages/agents/package.json` | 34 | Package manifest | peerDeps |

### Current callers / dependents

- **`ExecutionContext`** — used in 15+ test files, all guard implementations, interceptors. THE most critical interface to migrate without breaking.
- **`IncomingMessage`/`ServerResponse`** — typed in execution-context.ts, consumed by every guard's `canActivate(ctx)` → `ctx.getRequest()`.
- **`walkControllerMetadata()`** — called by create-server.ts:71, theokit-plugin.ts:160, app.ts:148. 3 callers.
- **`walkAgentMetadata()`** — called by agents theokit-plugin.ts:initRoutes. 1 caller.

### Domain glossary

- **Web Standard Request/Response** — The `Request` and `Response` classes from the Fetch API spec, available in all modern runtimes (Node 18+, Bun, Deno, CF Workers).
- **Runtime Adapter** — A thin shim that converts between the runtime's native server API and the Web Standard Request/Response interface.
- **Memoization** — Cache the result of metadata walks per class constructor, avoiding redundant Reflect.getMetadata calls.
- **Sub-path exports** — Package.json `"exports"` field with multiple entry points for selective imports.

### Architecture boundaries affected

- **http-decorators bridge layer** — refactored to use Web Standard types. Node.js `createServer` moves to a runtime adapter.
- **agents bridge layer** — SSE handler and route generator adapted to use `Response` instead of `ServerResponse`.
- **No cross-package boundary changes** — the dependency direction remains `agents → http-decorators`.

## Prior Art & Related Work

- **Internal reference:** `knowledge-base/references/hono/` — Hono's compose.ts uses framework-agnostic Context, not node:http. `compose()` returns `(context, next) => Promise<Context>`. Zero node:http dependency in middleware chain.
- **Internal reference:** `knowledge-base/references/workers-sdk/` — Cloudflare Workers SDK uses Web Standard Request/Response natively.
- **External:** Bun.serve() documentation — `fetch(req: Request): Response` handler signature. Zero conversion overhead.
- **Patterns skill:** `theokit-http-decorators-pattern-from-nestjs-patterns` — "reuse existing test harness" pattern. Tests remain as `fetch()` → assert, which already IS Web Standard.

## Objective

- [ ] `ExecutionContext.getRequest()` returns `Request` (Web Standard), not `IncomingMessage`
- [ ] Guards, interceptors, filters operate on Web Standard types
- [ ] Node.js runtime adapter: converts `IncomingMessage`/`ServerResponse` → `Request`/`Response`
- [ ] Bun runtime adapter: zero conversion — native `Bun.serve()` handler
- [ ] `walkControllerMetadata()` memoized per class (cache invalidation: never — metadata is immutable)
- [ ] `walkAgentMetadata()` memoized per class+toolbox tuple
- [ ] agents package gains sub-path exports: `@theokit/agents/decorators`, `@theokit/agents/bridge`
- [ ] Bundle size regression test
- [ ] ALL existing 382 tests GREEN + 25 new tests

## ADRs

### D460 — Web Standard Request/Response as pipeline type (not node:http)

**Decision:** The pipeline (guards, interceptors, filters, SSE handler) operates on Web Standard `Request`/`Response`. Node.js `IncomingMessage`/`ServerResponse` is converted at the runtime adapter boundary.

**Rationale:** Per Hono pattern (reference project), Web Standard types work on Node 18+, Bun, Deno, CF Workers. This makes the pipeline runtime-agnostic without sacrificing any capability. Per `architecture.md` Prohibitions: "Node.js APIs only in adapter layer (use Web Standards in core)".

**Alternatives considered:**
- (a) Keep node:http as primary, add Bun shim — rejected: forces Bun users through a Node.js compat layer (4x perf penalty documented by Bun team).

**Consequences:** Guards that currently access `req.headers['x-role']` will use `request.headers.get('x-role')`. One-time migration in existing tests.

### D461 — Backward-compatible migration via overloaded getRequest()

**Decision:** During migration, `ExecutionContext.getRequest()` returns `Request` (Web Standard). A new `getNodeRequest()` method returns the original `IncomingMessage` for code that genuinely needs Node streams. This preserves backward compatibility for consumers who import the type.

**Rationale:** Per CLAUDE.md §11 (YAGNI), we don't add `getNodeRequest()` everywhere — only in the Node runtime adapter's ExecutionContext. Bun/Deno adapters don't have it.

**Alternatives considered:**
- (a) Breaking change — remove IncomingMessage entirely — rejected: breaks all existing guard implementations in one PR. Too risky.

**Consequences:** Tests migrate from `req.headers['x-role']` to `request.headers.get('x-role')`. Guards work unchanged on both Node and Bun.

### D462 — Metadata walk memoization via WeakMap

**Decision:** `walkControllerMetadata()` and `walkAgentMetadata()` cache results in a `WeakMap<Function, WalkResult[]>`. Key = class constructor. Value = walk result. WeakMap allows GC when class is no longer referenced.

**Rationale:** Metadata is defined at class decoration time (static, immutable). Walking it multiple times produces identical results. Per KISS, a WeakMap cache is the simplest memoization — no TTL, no invalidation logic, no size limit.

**Alternatives considered:**
- (a) LRU cache with TTL — rejected: metadata never changes; TTL is unnecessary complexity.

**Consequences:** First call is uncached (same perf as today). Subsequent calls are O(1) lookup.

### D463 — Sub-path exports for tree-shaking

**Decision:** agents package exports 3 sub-paths: `@theokit/agents` (full), `@theokit/agents/decorators` (decorators only), `@theokit/agents/bridge` (bridge only). http-decorators keeps its current 3 sub-paths.

**Rationale:** Users who only need `@Agent()` and `@Tool()` decorators shouldn't bundle the SSE handler, route generator, and compiler. Per KISS, 3 sub-paths is enough — not 15.

**Alternatives considered:**
- (a) One barrel only — rejected: forces bundling everything even when only decorators are needed.

**Consequences:** tsup entry points grow from 1 to 3 in agents. Bundle size for decorator-only consumers drops ~60%.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Header API change — `req.headers['x']` → `request.headers.get('x')` breaks existing guards | Medium | Provide `getNodeRequest()` escape hatch on Node adapter. Migrate all tests in the same PR. | Implementer |
| Bun.serve() not available in CI (GitHub Actions default is Node) | Low | Bun adapter tested via conditional `typeof Bun !== 'undefined'` check. CI runs Node adapter tests. Bun tests are env-gated. | Implementer |
| WeakMap memoization hides bugs in metadata mutation | Low | Metadata is set at decoration time, never mutated. Tests verify cache hit returns identical result to uncached walk. | Implementer |
| EC-6: Response immutability forces interceptor pattern shift | Low | Interceptors return NEW Response with added headers instead of mutating ServerResponse. Document in migration guide. Same pattern as Hono middleware. | Implementer |
| EC-1: Large POST body memory spike during conversion | Medium | Use ReadableStream.from(nodeReq) for streaming body — zero buffering. Tested with 10MB body in integration test. | Implementer |

## Unresolved Questions

- UQ1 — Should `createDecoratorServer()` accept a runtime adapter option, or should there be separate `createNodeServer()` / `createBunServer()` factories? Leaning toward adapter option for simplicity.
- UQ2 — Should the Deno adapter be shipped in v1 or deferred? Leaning toward defer (YAGNI — no Deno users yet).

## Dependency Graph

```
Phase 1 (Web Standard types)
  ↓
Phase 2 (Runtime adapters — Node + Bun)
  ↓  
Phase 3 (Memoization + Sub-path exports)
  ↓
Phase 4 (Integration Validation)
```

All phases sequential.

---

## Phase 1: Web Standard Types Migration

**Objective:** Migrate `ExecutionContext`, `CanActivate`, `Interceptor`, `ExceptionFilter`, `NestMiddleware` from `node:http` types to Web Standard `Request`/`Response`.

### T1.1 — ExecutionContext Web Standards migration

#### Objective
Change `getRequest()` to return `Request` and `getResponse()` to work with Web Standard response patterns.

#### Why this step
**Action:** The ExecutionContext interface is the foundation — every guard, interceptor, and filter depends on it. Migrating this first means all downstream code naturally follows.
**Reasoning:** Per D460, Web Standard types are the pipeline type. Per `architecture.md` Prohibitions: "Node.js APIs only in adapter layer."

#### Evidence
- `packages/http-decorators/src/bridge/execution-context.ts:12-18` — current interface with `IncomingMessage`/`ServerResponse`
- 15+ test files consume `ExecutionContext`

#### Files to edit
```
packages/http-decorators/src/bridge/execution-context.ts — migrate to Request/Response
packages/http-decorators/src/bridge/web-adapter.ts (NEW) — Web Standard adapter utilities
packages/http-decorators/tests/unit/web-standards.test.ts (NEW) — Web Standard type tests
```

#### Deep file dependency analysis
- `execution-context.ts` is imported by: create-server.ts, theokit-plugin.ts, app.ts, all tests with guards
- Changing the return type of `getRequest()` affects every `CanActivate` implementation

#### Deep Dives

**New ExecutionContext interface:**
```typescript
export interface ExecutionContext {
  getRequest(): Request              // Web Standard (was IncomingMessage)
  getUrl(): URL                       // Parsed URL (convenience)
  getClass(): Function
  getMethodName(): string | symbol
}
```

**Response handling:** Instead of `getResponse(): ServerResponse`, the pipeline RETURNS a `Response` object. Guards return `boolean`. If rejected, the runtime adapter creates the `403 Response`.

**Key insight from Hono:** The handler returns `Response`, it doesn't write to `ServerResponse`. This is the fundamental shift:
```typescript
// BEFORE: imperative write to mutable stream
res.writeHead(200); res.end(JSON.stringify(data))

// AFTER: return immutable Response object
return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
```

#### Tasks
1. Create `web-adapter.ts` with `WebRequest` utilities (header helpers, body parsing)
2. Update `ExecutionContext` interface to return `Request` + `URL`
3. Update `CanActivate` — guards receive Web Standard context
4. Update `createExecutionContext()` factory
5. Write tests for the new interface

#### TDD
```
RED:     test_execution_context_returns_request() — getRequest() returns Web Standard Request
RED:     test_execution_context_returns_url() — getUrl() returns parsed URL
RED:     test_guard_receives_web_request() — guard accesses request.headers.get('x-role')
RED:     test_backward_compat_guard() — guard written for new API works correctly
RED:     test_request_body_clone_for_double_read() — EC-3: guard reads body, handler also reads body, both succeed via request.clone()
GREEN:   Implement Web Standard ExecutionContext with body-safe cloning
REFACTOR: Remove unused IncomingMessage import
VERIFY:  pnpm --filter @theokit/http-decorators test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/http-decorators test` exits 0 with ALL existing tests migrated
- [ ] `ExecutionContext.getRequest()` returns `Request` (Web Standard)
- [ ] `request.headers.get('x-role')` works in guards
- [ ] Pass: size — every file ≤ 500 lines

#### DoD
- [ ] All tests passing
- [ ] `tsc --noEmit` exits 0

### T1.2 — Interceptor + Filter + Middleware Web Standards migration

#### Objective
Migrate Interceptor, ExceptionFilter, and NestMiddleware interfaces to Web Standard types.

#### Why this step
**Action:** These interfaces use `IncomingMessage`/`ServerResponse` directly. They need to accept `Request` and return/modify `Response`.
**Reasoning:** Follows T1.1 naturally — once ExecutionContext is migrated, the remaining pipeline must follow.

#### Files to edit
```
packages/http-decorators/src/bridge/interceptor-chain.ts — migrate Interceptor interface
packages/http-decorators/src/bridge/exception-filter-chain.ts — migrate ExceptionFilter + ArgumentsHost
packages/http-decorators/src/bridge/middleware-consumer.ts — migrate NestMiddleware
packages/http-decorators/tests/unit/web-standards-pipeline.test.ts (NEW)
```

#### TDD
```
RED:     test_interceptor_receives_request() — intercept(request, next) pattern
RED:     test_exception_filter_receives_request() — ArgumentsHost.getRequest() returns Request
RED:     test_middleware_receives_request() — use(request, next) pattern
RED:     test_sse_response_as_readable_stream() — EC-2: SSE returns Response with ReadableStream body, controller.enqueue() replaces res.write()
RED:     test_interceptor_creates_new_response() — EC-6: interceptor returns NEW Response with added headers (immutable pattern)
GREEN:   Implement with Response(ReadableStream) for SSE, new Response() for interceptor mutation
REFACTOR: Remove node:http imports
VERIFY:  pnpm --filter @theokit/http-decorators test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Zero `node:http` imports in interceptor-chain, exception-filter-chain, middleware-consumer
- [ ] All pipeline interfaces use Web Standard types
- [ ] Existing tests migrated and passing

#### DoD
- [ ] All tests passing

---

## Phase 2: Runtime Adapters

**Objective:** Ship Node.js and Bun runtime adapters that bridge between the Web Standard pipeline and each runtime's server API.

### T2.1 — Node.js runtime adapter

#### Objective
Create a Node.js adapter that converts `IncomingMessage`/`ServerResponse` to/from `Request`/`Response`.

#### Why this step
**Action:** Node.js is the current runtime. The adapter ensures all existing behavior works unchanged.
**Reasoning:** Per D461, backward compatibility via adapter. `createDecoratorServer()` uses the Node adapter by default.

#### Files to edit
```
packages/http-decorators/src/bridge/runtime/node.ts (NEW) — Node.js adapter
packages/http-decorators/src/bridge/runtime/types.ts (NEW) — RuntimeAdapter interface
packages/http-decorators/tests/unit/runtime-node.test.ts (NEW)
```

#### Deep Dives

```typescript
export interface RuntimeAdapter {
  createServer(handler: (request: Request) => Response | Promise<Response>): ServerHandle
}

export interface ServerHandle {
  listen(port: number): Promise<void>
  close(): Promise<void>
  readonly port: number
}

// Node adapter
export function createNodeAdapter(): RuntimeAdapter {
  return {
    createServer(handler) {
      const server = http.createServer(async (nodeReq, nodeRes) => {
        const request = nodeIncomingToRequest(nodeReq)
        const response = await handler(request)
        await writeResponseToNode(response, nodeRes)
      })
      return { listen, close, port }
    }
  }
}
```

#### TDD
```
RED:     test_node_adapter_converts_request() — IncomingMessage → Request with headers, method, url, body
RED:     test_node_adapter_converts_response() — Response → ServerResponse with status, headers, body
RED:     test_node_adapter_handles_streaming_body() — ReadableStream body writes to ServerResponse
RED:     test_node_adapter_roundtrip() — full HTTP request → handler → response cycle
RED:     test_node_adapter_streaming_request_body() — EC-1: large POST body via ReadableStream.from(nodeReq), NOT buffered
RED:     test_node_adapter_http2_compat() — EC-4: Http2ServerRequest handled or documented as unsupported
GREEN:   Implement with ReadableStream.from(nodeReq) for streaming body (no full-body buffering)
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/http-decorators test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/http-decorators test` exits 0
- [ ] Node adapter converts IncomingMessage → Request correctly (headers, method, url, body)
- [ ] Node adapter converts Response → ServerResponse correctly (status, headers, body, streaming)

#### DoD
- [ ] Tests passing

### T2.2 — Bun runtime adapter

#### Objective
Create a Bun adapter that uses `Bun.serve()` natively — zero conversion.

#### Why this step
**Action:** Bun.serve() already accepts `fetch(req: Request): Response`. The adapter is trivial — just pass through.
**Reasoning:** Per D460, this is the reason we migrated to Web Standards. Bun users get native performance.

#### Files to edit
```
packages/http-decorators/src/bridge/runtime/bun.ts (NEW) — Bun adapter
packages/http-decorators/tests/unit/runtime-bun.test.ts (NEW) — env-gated tests
```

#### TDD
```
RED:     test_bun_adapter_creates_server_handle() — returns ServerHandle with listen/close
RED:     test_bun_adapter_handler_is_passthrough() — handler receives Request, returns Response directly
GREEN:   Implement (env-gated: typeof Bun !== 'undefined')
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/http-decorators test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Bun adapter compiles without error
- [ ] Tests are env-gated (`typeof Bun !== 'undefined'` skip on Node)
- [ ] On Bun runtime: zero conversion overhead (handler IS the fetch handler)

#### DoD
- [ ] Tests passing (or honestly skipped on Node CI)

---

## Phase 3: Memoization + Sub-path Exports + Bundle

**Objective:** Add metadata memoization, sub-path exports, and bundle validation.

### T3.1 — Metadata walk memoization

#### Objective
Memoize `walkControllerMetadata()` and `walkAgentMetadata()` via WeakMap.

#### Why this step
**Action:** Cache metadata walk results per class constructor. WeakMap allows GC.
**Reasoning:** Per D462, metadata is immutable. Walking it repeatedly is waste. 3 callers for controllers, 1 for agents.

#### Files to edit
```
packages/http-decorators/src/bridge/walk-metadata.ts — add WeakMap cache
packages/agents/src/bridge/walk-agent-metadata.ts — add WeakMap cache
packages/http-decorators/tests/unit/memoization.test.ts (NEW)
packages/agents/tests/unit/memoization.test.ts (NEW)
```

#### TDD
```
RED:     test_walk_controller_metadata_cached() — second call returns same reference (===)
RED:     test_walk_agent_metadata_cached() — second call returns same reference
RED:     test_cache_per_class() — different classes get different cached results
RED:     test_cache_does_not_leak_across_classes() — WeakMap GC behavior (skip if not testable)
RED:     test_memoization_subclass_separate_from_parent() — EC-5: ChildCtrl extends ParentCtrl get separate cached results
GREEN:   Implement WeakMap cache keyed by class constructor
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/http-decorators test && pnpm --filter @theokit/agents test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `walkControllerMetadata(Cls)` called 2x returns `===` same reference on second call
- [ ] All existing tests still pass (cache doesn't break behavior)

#### DoD
- [ ] Tests passing

### T3.2 — Sub-path exports for agents

#### Objective
Add sub-path exports to agents package: `@theokit/agents/decorators`, `@theokit/agents/bridge`.

#### Why this step
**Action:** Split tsup entry points and package.json exports for selective imports.
**Reasoning:** Per D463, users who only need decorators shouldn't bundle the entire bridge layer.

#### Files to edit
```
packages/agents/package.json — add exports field entries
packages/agents/tsup.config.ts — add entry points
packages/agents/tests/unit/subpath-exports.test.ts (NEW)
```

#### TDD
```
RED:     test_subpath_decorators_importable() — import from '@theokit/agents/decorators' resolves
RED:     test_subpath_bridge_importable() — import from '@theokit/agents/bridge' resolves
RED:     test_main_barrel_reexports_all() — import from '@theokit/agents' has all exports
GREEN:   Implement sub-path exports
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents build && pnpm --filter @theokit/agents test
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents build` produces 3 entry points in dist/
- [ ] Sub-path imports resolve correctly
- [ ] Main barrel re-exports everything (backward compatible)

#### DoD
- [ ] Tests passing

### T3.3 — Bundle size regression test

#### Objective
Add a test that asserts bundle size stays within budget.

#### Why this step
**Action:** Prevent accidental bundle bloat. Assert `dist/index.js` size in bytes.
**Reasoning:** Without a regression test, new dependencies and dead code accumulate silently.

#### Files to edit
```
packages/http-decorators/tests/integration/bundle-size.test.ts (NEW)
packages/agents/tests/integration/bundle-size.test.ts (NEW)
```

#### TDD
```
RED:     test_http_decorators_bundle_under_30kb() — dist/index.js < 30KB
RED:     test_agents_bundle_under_25kb() — dist/index.js < 25KB
RED:     test_agents_decorators_subpath_under_10kb() — dist/decorators.js < 10KB
GREEN:   Build both packages, assert sizes
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/http-decorators build && pnpm --filter @theokit/agents build
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Bundle size tests pass
- [ ] Sizes documented in test assertions

#### DoD
- [ ] Tests passing

---

## Phase 4: Integration Validation (MANDATORY)

**Objective:** Validate all changes work end-to-end.

### Execution

```bash
pnpm --filter @theokit/http-decorators test   # 199+ existing + new tests
pnpm --filter @theokit/agents test             # 183+ existing + new tests
pnpm --filter @theokit/http-decorators build   # dist output clean
pnpm --filter @theokit/agents build            # dist output with sub-path exports
tsc --noEmit                                    # zero type errors
```

### Acceptance Criteria

- [ ] http-decorators: ALL existing 199 tests GREEN + new tests
- [ ] agents: ALL existing 183 tests GREEN + new tests
- [ ] Zero type errors
- [ ] Bundle sizes within budget
- [ ] No `node:http` import in pipeline code (only in runtime/node.ts adapter)
- [ ] Bun adapter compiles (functional test env-gated)

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | ExecutionContext uses node:http types | T1.1 | Migrated to Web Standard Request |
| 2 | Interceptor/Filter/Middleware use node:http | T1.2 | Migrated to Web Standard types |
| 3 | No Node.js runtime adapter | T2.1 | Node adapter: IncomingMessage → Request |
| 4 | No Bun runtime adapter | T2.2 | Bun adapter: zero-conversion passthrough |
| 5 | Metadata walks not memoized | T3.1 | WeakMap cache per class |
| 6 | No sub-path exports in agents | T3.2 | 3 sub-paths: root, decorators, bridge |
| 7 | No bundle size regression test | T3.3 | Size assertion tests |

**Coverage: 7/7 gaps covered (100%)**

## Global Definition of Done

- [ ] All tests passing (382 existing + 25+ new)
- [ ] Zero type errors — `tsc --noEmit`
- [ ] Zero `node:http` imports in pipeline code (only in `runtime/node.ts`)
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] File-size budget: every file ≤ 500 LoC
- [ ] Backward compatible — decorator API unchanged
- [ ] Both packages build successfully

## Failure scenarios

(none — no external I/O touched. All adapters are in-process. Tests use mock servers.)

## Final Phase: Integration Validation (MANDATORY)

See Phase 4 above.
