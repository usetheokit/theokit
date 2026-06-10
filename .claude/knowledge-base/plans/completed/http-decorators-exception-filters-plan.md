---
slug: http-decorators-exception-filters
created_at: 2026-06-09
goal: Ship NestJS-style exception filters in @theokit/http-decorators so that HttpException subclasses map to typed HTTP responses and @UseFilters/@Catch decorators enable custom error handling per route, measured by 15+ new tests GREEN covering HttpException hierarchy, @Catch filter execution, @UseFilters binding, global fallback filter, and HTTP roundtrip error scenarios.
---

# Plan: `@theokit/http-decorators` — NestJS Exception Filters

> **Version 1.1** (2026-06-09) — Absorbed 2 MUST FIX from edge-case review: EC-1 (recursion guard when filter itself throws), EC-2 (check res.headersSent before writing error response). Plus 2 SHOULD TEST items folded into TDD sections.
>
> **Version 1.0** — Deliver the `@Catch` / `@UseFilters` exception filter layer that was explicitly deferred in Pattern D3 ("v0.2.0 follow-up plans Filters"). Three deliverables: (1) `HttpException` class hierarchy with 18 built-in exception classes mapped to HTTP status codes, (2) `@Catch(ExceptionType)` decorator + `ExceptionFilter` interface, (3) `@UseFilters()` decorator (method + class level) with global fallback. Replaces the bare `catch (err) { 500 }` in all 3 handlers with the exception filter pipeline.

## Goal

> Ship `HttpException` class hierarchy + `@Catch`/`@UseFilters` exception filter pipeline in `@theokit/http-decorators` so that thrown `HttpException` subclasses produce typed HTTP responses and custom `ExceptionFilter` classes handle errors per route, measured by `pnpm --filter @theokit/http-decorators test` returning exit 0 with ≥ 15 new passing tests covering HttpException mapping, @Catch filter dispatch, @UseFilters binding, global fallback, and HTTP error roundtrip.

## Context

Pattern D3 from `theokit-http-decorators-pattern-from-nestjs-patterns` explicitly states: "`@Catch(HttpException)` Filter class is deferred to v0.2.0+ follow-up discovery." The middleware-interceptors plan (shipped `e8bef2b`) completed the pipeline: middleware → guards → interceptors → handler. Exception filters are the LAST piece — they wrap the entire pipeline and catch any thrown exception.

Currently all 3 handlers (create-server.ts:149-153, theokit-plugin.ts:222-224, app.ts:232-235) use bare `catch (err) { 500 INTERNAL_SERVER_ERROR }` — no type discrimination, no custom error formatting, no per-route filter binding.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/http-decorators/src/bridge/create-server.ts` | 335 | `077406f` (2026-06-09) | Standalone HTTP server; catch block at line 149-153 | Replace catch with exception filter pipeline |
| `packages/http-decorators/src/theokit-plugin.ts` | 386 | `077406f` (2026-06-09) | TheoKit plugin; catch block at line 222-224 | Same replacement |
| `packages/http-decorators/src/app.ts` | 306 | `fdc30d5` (2026-06-09) | TheoApp.create(); catch block at line 232-235 | Same replacement |
| `packages/http-decorators/src/decorators/middleware.ts` | 17 | `0b7cef6` (2026-06-09) | `@UseGuards` + `@UseInterceptors` | Add `@UseFilters` + `@Catch` |
| `packages/http-decorators/src/metadata/keys.ts` | 20 | `1964636` (2026-06-09) | Symbol.for metadata keys | Add USE_FILTERS + CATCH_EXCEPTIONS keys |
| `packages/http-decorators/src/bridge/walk-metadata.ts` | 132 | `1964636` (2026-06-09) | WalkResult with guards + interceptors | Add `filters: Function[]` field |
| `packages/http-decorators/src/bridge/exception-filter-chain.ts` (NEW) | 0 | — | Exception filter pipeline | — |
| `packages/http-decorators/src/exceptions/http-exception.ts` (NEW) | 0 | — | HttpException + 18 built-in subclasses | — |
| `packages/http-decorators/src/exceptions/index.ts` (NEW) | 0 | — | Exception barrel | — |
| `packages/http-decorators/src/index.ts` | 5 | `fdc30d5` (2026-06-09) | Public barrel | Export exceptions + filter types |
| `tests/unit/http-exception.test.ts` (NEW) | 0 | — | Exception class tests | — |
| `tests/unit/exception-filter-chain.test.ts` (NEW) | 0 | — | Filter chain tests | — |
| `tests/integration/exception-filter-roundtrip.test.ts` (NEW) | 0 | — | HTTP roundtrip error tests | — |
| `fixtures/decorator-fullstack/server/controllers/tasks.controller.ts` | 67 | `c5fd672` (2026-06-09) | Fixture controller | Throw HttpException in demo |

### Current callers / dependents

- **Symbol:** `catch (err)` blocks in create-server.ts:149, theokit-plugin.ts:222, app.ts:232
  - **Callers:** `handleRequest()`, `handleDecoratorRoute()`, TheoApp handler
  - **Change:** Replace with `runExceptionFilters(err, filters, req, res)`

- **Symbol:** `USE_GUARDS`, `USE_INTERCEPTORS` in metadata/keys.ts
  - **Callers:** decorators/middleware.ts, bridge/walk-metadata.ts
  - **Pattern to replicate:** Add `USE_FILTERS`, `CATCH_EXCEPTIONS` same way

### Domain glossary

- **HttpException** — base exception class with statusCode + message. Thrown in handlers to produce typed HTTP error responses.
- **ExceptionFilter** — class implementing `catch(exception, host)`. Bound via `@UseFilters()` or globally.
- **@Catch(Type)** — decorator that marks which exception type(s) a filter handles.
- **@UseFilters()** — method/class decorator binding filters to routes (same pattern as `@UseGuards`).
- **ArgumentsHost** — simplified context object providing `getRequest()` + `getResponse()` accessors.

### Architecture boundaries affected

- All changes inside `packages/http-decorators/` — no TheoKit core changes (barrel-only imports per patterns skill).
- New `src/exceptions/` directory — same layer as `src/decorators/` and `src/bridge/`.

## Prior Art & Related Work

- **Patterns skill:** `theokit-http-decorators-pattern-from-nestjs-patterns` — Pattern D3 deferred `@Catch` to v0.2.0
- **NestJS Exception Filters chapter** (user-provided, 2026-06-09) — HttpException hierarchy, @Catch, @UseFilters, ExceptionFilter interface, ArgumentsHost
- **TheoKit error envelope:** `packages/theo/src/core/contracts/error-envelope.ts` — existing `{code, message}` shape used in guards (401) and validation (422) responses. Exception filters should produce compatible output.

## Objective

- [ ] `HttpException` base class with `statusCode` + `message` + optional `cause`
- [ ] 18 built-in exception subclasses (BadRequest, Unauthorized, Forbidden, NotFound, etc.)
- [ ] `ExceptionFilter` interface: `catch(exception, host): void`
- [ ] `ArgumentsHost` helper with `getRequest()` + `getResponse()`
- [ ] `@Catch(ExceptionType)` class decorator storing exception type metadata
- [ ] `@UseFilters()` method + class decorator (same composition as `@UseGuards`)
- [ ] `runExceptionFilters()` that matches exception → filter by `@Catch` type
- [ ] Global fallback: unmatched exceptions → `{statusCode: 500, message: "Internal server error"}`
- [ ] HttpException auto-handler: `HttpException` without custom filter → `{statusCode, message}`
- [ ] Wired in all 3 handlers replacing bare `catch (err) { 500 }`
- [ ] Fixture updated with `NotFoundException` demo
- [ ] 148 existing tests stay GREEN

## ADRs

### D1 — Simplified ArgumentsHost (no switchToHttp/switchToRpc/switchToWs)

**Decision:** `ArgumentsHost` exposes `getRequest(): IncomingMessage` + `getResponse(): ServerResponse` directly. No `switchToHttp()` indirection.

**Rationale:** TheoKit is HTTP-only. NestJS's `switchToHttp()` exists for microservices/WS abstraction. Per KISS (per `rules/architecture.md`), no abstraction without 2+ consumers.

**Alternatives:** (a) Full NestJS ArgumentsHost with switchTo* — overengineered for HTTP-only framework.

**Consequences:** NestJS teams using `host.switchToHttp().getResponse()` need trivial migration to `host.getResponse()`.

### D2 — HttpException carries `code` field for TheoKit error envelope compatibility

**Decision:** `HttpException` constructor accepts optional `code: string` (e.g., `'NOT_FOUND'`, `'FORBIDDEN'`). Default fallback: derive from status code. Response shape: `{error: {code, message, statusCode}}` — matches the existing guard/validation error format.

**Rationale:** Per DRY, the error response shape must be consistent with `runGuards()` (401 `UNAUTHORIZED`) and `resolveBody()` (422 `VALIDATION_ERROR`). Adding a third shape breaks API consumers.

**Alternatives:** (a) NestJS shape `{statusCode, message}` — inconsistent with existing TheoKit responses.

**Consequences:** Error responses are uniform across guards, validation, and exception filters.

### D3 — Filter composition: method-level overrides class-level (NestJS convention)

**Decision:** When both class-level and method-level `@UseFilters` exist, method-level filters run FIRST. If none match, class-level filters run. If none match, global fallback runs.

**Rationale:** Follows NestJS convention — more specific scope wins.

**Alternatives:** (a) Merge class + method filters (like guards) — NestJS doesn't do this for filters; specificity is the point.

**Consequences:** `@UseFilters(A)` on class + `@UseFilters(B)` on method → only B runs for that method's exceptions.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Replacing bare catch blocks may change error response shape for existing consumers | Medium | Keep `{error: {code, message}}` shape identical to current output | implementer |
| 18 built-in exception classes adds ~100 LoC of boilerplate | Low | Single file with factory pattern; each class is 3-4 lines | implementer |
| `@Catch()` without args catches everything — may swallow unexpected errors silently | Medium | Global fallback always logs to console.error before sending response | implementer |

## Unresolved Questions

(none — every decision is resolved at plan time. Pattern D3 deferred this feature; the NestJS chapter provides the complete spec.)

## Dependency Graph

```
Phase 1 (HttpException hierarchy) ──▶ Phase 2 (Filter decorators + chain) ──▶ Phase 3 (Wire + fixture)
```

All sequential.

---

## Phase 1: HttpException Hierarchy

**Objective:** Create the exception class tree with all 18 built-in exceptions.

### T1.1 — HttpException base + built-in subclasses

#### Objective
Create `HttpException` and 18 subclasses, each pre-configured with its HTTP status code.

#### Why this step
**Action:** Create `src/exceptions/http-exception.ts` with `HttpException` base class and 18 named subclasses (BadRequestException, UnauthorizedException, etc.).

**Reasoning:** Per D2, every exception carries `statusCode`, `message`, and `code`. The hierarchy enables `instanceof` checks in exception filters. This is the foundation — filters and the pipeline depend on it.

#### Evidence
- NestJS ships 18 built-in exceptions per the user-provided chapter
- Current error responses use `{error: {code, message}}` shape (create-server.ts:151-152)

#### Files to edit
```
packages/http-decorators/src/exceptions/http-exception.ts (NEW) — HttpException + 18 subclasses
packages/http-decorators/src/exceptions/index.ts (NEW) — barrel
packages/http-decorators/src/index.ts — re-export exceptions
tests/unit/http-exception.test.ts (NEW) — unit tests
```

#### Deep file dependency analysis
- `http-exception.ts` (NEW): exports `HttpException` + 18 subclasses. Each subclass calls `super(message, statusCode)`.
- `index.ts`: adds `export * from './exceptions/index.js'`

#### Pseudo-code / Signatures

```typescript
export class HttpException extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    options?: { cause?: Error }
  )
}

export class BadRequestException extends HttpException {
  constructor(message = 'Bad Request', opts?) {
    super(message, 400, 'BAD_REQUEST', opts)
  }
}
// ... 17 more
```

#### Tasks
1. Create `src/exceptions/http-exception.ts`
2. Create barrel `src/exceptions/index.ts`
3. Export from `src/index.ts`
4. Write unit tests

#### TDD
```
RED:     test_http_exception_has_status_and_message — expect new HttpException('x', 400).statusCode === 400
RED:     test_http_exception_is_error — expect new HttpException('x', 400) instanceof Error
RED:     test_not_found_exception_defaults — expect new NotFoundException().statusCode === 404
RED:     test_bad_request_with_custom_message — expect new BadRequestException('invalid').message === 'invalid'
RED:     test_exception_with_cause — expect new HttpException('x', 500, { cause: origErr }).cause === origErr
RED:     test_all_18_builtins_have_correct_status — expect each maps to correct HTTP code
GREEN:   Implement HttpException + 18 subclasses
REFACTOR: None expected
VERIFY:  npx vitest run tests/unit/http-exception.test.ts
```

#### Concurrency tests
```
(none — single-threaded)
```

---

## Phase 2: Filter Decorators + Chain

**Objective:** `@Catch`, `@UseFilters`, `ExceptionFilter` interface, `runExceptionFilters()`.

### T2.1 — @Catch + @UseFilters decorators + metadata

#### Objective
Create `@Catch(ExceptionType)` and `@UseFilters()` decorators that store metadata, and extend `WalkResult` with `filters` field.

#### Why this step
**Action:** Add `USE_FILTERS` and `CATCH_EXCEPTIONS` Symbol.for keys. Create `@Catch()` (class decorator storing exception types) and `@UseFilters()` (method + class decorator storing filter classes). Update `walk-metadata.ts` to collect filters like guards.

**Reasoning:** Same metadata pipeline as guards/interceptors — proven pattern. EC-9 composition rule applies: method-level overrides class-level per D3.

#### Evidence
- `@UseGuards` pattern at decorators/middleware.ts:3-8 — replicate for `@UseFilters`
- `walk.guards` collection at walk-metadata.ts:105-108 — replicate for `walk.filters`

#### Files to edit
```
packages/http-decorators/src/metadata/keys.ts — Add USE_FILTERS + CATCH_EXCEPTIONS symbols
packages/http-decorators/src/decorators/middleware.ts — Add @UseFilters + @Catch
packages/http-decorators/src/bridge/walk-metadata.ts — Add filters to WalkResult
tests/unit/exception-filter-decorators.test.ts (NEW) — decorator tests
```

#### Tasks
1. Add 2 Symbol.for keys to metadata/keys.ts
2. Implement `@Catch(...exceptions)` class decorator
3. Implement `@UseFilters(...filters)` method + class decorator
4. Update WalkResult + walkControllerMetadata to collect filters
5. Write unit tests

#### TDD
```
RED:     test_catch_decorator_stores_exception_types — expect @Catch(HttpException) stores [HttpException]
RED:     test_catch_no_args_catches_all — expect @Catch() stores empty array (catch-all)
RED:     test_use_filters_method_level — expect @UseFilters(F) on method stores [F]
RED:     test_use_filters_class_level — expect @UseFilters(F) on class stores [F]
RED:     test_walk_metadata_collects_filters — expect walkControllerMetadata produces filters array
GREEN:   Implement decorators + metadata
REFACTOR: None expected
VERIFY:  npx vitest run tests/unit/exception-filter-decorators.test.ts
```

#### Concurrency tests
```
(none — single-threaded)
```

### T2.2 — ExceptionFilter interface + runExceptionFilters chain

#### Objective
Create `ExceptionFilter` interface, `ArgumentsHost` helper, and `runExceptionFilters()` that matches exception → filter by `@Catch` type.

#### Why this step
**Action:** Create `src/bridge/exception-filter-chain.ts` with the filter execution engine. The chain: (1) check method-level filters first, (2) then class-level, (3) then global fallback. Match by `@Catch` type — filter handles the exception if `exception instanceof CatchedType`. HttpException without custom filter auto-formats to `{error: {code, message, statusCode}}`.

**Reasoning:** Per D3, method-level overrides class-level. The fallback ensures no unhandled exception produces a bare stack trace — always a JSON response.

#### Files to edit
```
packages/http-decorators/src/bridge/exception-filter-chain.ts (NEW) — chain runner
packages/http-decorators/src/bridge/index.ts — export new types
tests/unit/exception-filter-chain.test.ts (NEW) — unit tests
```

#### Pseudo-code / Signatures

```typescript
export interface ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void | Promise<void>
}

export interface ArgumentsHost {
  getRequest(): IncomingMessage
  getResponse(): ServerResponse
}

export function runExceptionFilters(
  exception: unknown,
  methodFilters: Function[],
  classFilters: Function[],
  req: IncomingMessage,
  res: ServerResponse,
  container?: DiContainer,
): void
```

#### Tasks
1. Create `src/bridge/exception-filter-chain.ts`
2. Export from bridge/index.ts
3. Write unit tests

#### TDD
```
RED:     test_filter_catches_matching_exception — @Catch(NotFoundException) catches NotFoundException
RED:     test_filter_ignores_non_matching — @Catch(NotFoundException) does NOT catch BadRequestException
RED:     test_catch_all_filter — @Catch() catches any exception
RED:     test_method_filter_overrides_class — method filter runs instead of class filter
RED:     test_http_exception_auto_formats — HttpException without filter produces {error: {code, message, statusCode}}
RED:     test_unknown_exception_produces_500 — non-HttpException → 500 Internal Server Error
RED:     test_filter_di_resolution — filter resolved via container.resolve()
RED:     test_filter_that_throws_falls_to_global — EC-1: filter.catch() throws → global fallback 500, no recursion
RED:     test_headers_already_sent_skips_response — EC-2: res.headersSent=true → log error, don't write
GREEN:   Implement runExceptionFilters with recursion guard + headersSent check
REFACTOR: None expected
VERIFY:  npx vitest run tests/unit/exception-filter-chain.test.ts
```

#### Concurrency tests
```
(none — single-threaded)
```

---

## Phase 3: Wire + Fixture Integration

**Objective:** Replace bare catch blocks with exception filter pipeline. Update fixture.

### T3.1 — Wire exception filters into all 3 handlers

#### Objective
Replace the `catch (err) { 500 }` blocks with `runExceptionFilters()` in create-server.ts, theokit-plugin.ts, and app.ts.

#### Why this step
**Action:** In each handler's catch block, call `runExceptionFilters(err, walk.filters, classFilters, req, res, container)` instead of the bare 500 response. Pass method-level and class-level filters from `WalkResult`.

**Reasoning:** The bare catch was always a placeholder. Exception filters give consumers control over error formatting, logging, and response shape — NestJS's core value proposition for error handling.

#### Files to edit
```
packages/http-decorators/src/bridge/create-server.ts — Replace catch block
packages/http-decorators/src/theokit-plugin.ts — Replace catch block
packages/http-decorators/src/app.ts — Replace catch block
tests/integration/exception-filter-roundtrip.test.ts (NEW) — HTTP roundtrip
```

#### Tasks
1. Import `runExceptionFilters` in all 3 files
2. Replace catch blocks
3. Write integration tests

#### TDD
```
RED:     test_not_found_exception_returns_404 — throw NotFoundException → 404
RED:     test_bad_request_returns_400 — throw BadRequestException → 400
RED:     test_custom_filter_formats_error — @UseFilters(CustomFilter) + throw → custom JSON
RED:     test_unhandled_exception_returns_500 — throw Error('boom') → 500
RED:     test_existing_guard_401_unchanged — guards still return 401 correctly
RED:     test_existing_validation_422_unchanged — Zod validation still returns 422
GREEN:   Wire filters in all handlers
REFACTOR: Ensure error response shape is consistent (D2)
VERIFY:  npx vitest run tests/integration/exception-filter-roundtrip.test.ts
```

#### Concurrency tests
```
(none — single-threaded)
```

### T3.2 — Fixture: NotFoundException demo

#### Objective
Update the fixture controller to throw `NotFoundException` when task not found.

#### Why this step
**Action:** In `findOne(@Param('id') id)`, replace `?? { error: 'Task not found' }` with `throw new NotFoundException('Task not found')`. Frontend catches 404 and displays error.

**Reasoning:** Demonstrates the exception filter in a real full-stack TheoKit app.

#### Files to edit
```
fixtures/decorator-fullstack/server/controllers/tasks.controller.ts — throw NotFoundException
fixtures/decorator-fullstack/app/page.tsx — handle 404 in UI
```

#### Tasks
1. Import NotFoundException in controller
2. Replace null-coalesce with throw
3. Update frontend error handling
4. Verify with manual test

#### TDD
```
RED:     test_fixture_404_on_missing_task — GET /api/v2/tasks/999 → 404
GREEN:   Implement NotFoundException throw in controller
REFACTOR: None expected
VERIFY:  npx vitest run (full suite)
```

#### Concurrency tests
```
(none — single-threaded)
```

---

## Failure scenarios

(none — no external I/O touched)

## Coverage Matrix

| Requirement | Task(s) |
|---|---|
| HttpException base class | T1.1 |
| 18 built-in exception subclasses | T1.1 |
| @Catch decorator | T2.1 |
| @UseFilters decorator (method + class) | T2.1 |
| WalkResult.filters collection | T2.1 |
| ExceptionFilter interface | T2.2 |
| ArgumentsHost helper | T2.2 |
| runExceptionFilters chain | T2.2 |
| Method-level overrides class-level (D3) | T2.2 |
| HttpException auto-format | T2.2 |
| Global fallback (500 for unknown) | T2.2 |
| Filter DI resolution | T2.2 |
| Wired in create-server.ts | T3.1 |
| Wired in theokit-plugin.ts | T3.1 |
| Wired in app.ts | T3.1 |
| Existing guard/validation responses unchanged | T3.1 |
| Fixture with NotFoundException | T3.2 |
| Frontend 404 handling | T3.2 |

## Global DoD

- [ ] `npx vitest run` in http-decorators: 163+ tests GREEN (148 existing + 15+ new)
- [ ] `npx tsc --noEmit -p packages/http-decorators/tsconfig.json` exit 0
- [ ] `npx tsup` build success
- [ ] No new eslint warnings (`--max-warnings=0`)
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] No file exceeds 400 LoC

## Final Phase: Integration Validation

1. `npx vitest run` — full suite
2. `npx tsc --noEmit` — typecheck
3. `npx tsup` — build
4. `npx vitest run tests/unit/fixtures-index.test.ts --config vitest.config.ts` — fixture README
5. Manual: `npx tsx fixtures/decorator-fullstack/demo-launcher.ts` → GET /api/v2/tasks/999 → 404
