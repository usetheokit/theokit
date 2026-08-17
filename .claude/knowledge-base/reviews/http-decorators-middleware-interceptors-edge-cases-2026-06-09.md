# Edge Case Review — http-decorators-middleware-interceptors

Date: 2026-06-09
Tasks analyzed: 5 (T1.1, T1.2, T2.1, T2.2, T3.1)
Edge cases found: 8 (MUST FIX: 3, SHOULD TEST: 4, DOCUMENT: 1)

## MUST FIX

### EC-1: Interceptor `next()` closure captures stale `res` — response already sent on error
- **Affected task:** T1.2
- **Family:** State
- **Scenario:** The plan says "wrap handler+body-parse+args-build into async closure". But `resolveBody()` may send a 422 response (line 173-174 in create-server.ts) and return `BODY_REJECTED`. If the interceptor wraps this entire block, `BODY_REJECTED` is returned to the interceptor which may try to transform it and send a SECOND response on an already-ended stream.
- **Impact:** `ERR_HTTP_HEADERS_SENT` crash — Node throws when writing headers to an already-closed response.
- **Suggested fix:** The interceptor chain must wrap ONLY the handler call (after body parsing + validation), not the body parsing itself. Body parsing + validation stays OUTSIDE the interceptor chain. Interceptors receive the already-parsed args. This matches NestJS where Pipes (validation) run BETWEEN guards and interceptors, not inside the interceptor's `next()`.

### EC-2: Interceptor response transform vs `sendResponse()` — double serialization
- **Affected task:** T1.2
- **Family:** State
- **Scenario:** The plan's pseudo-code returns `runInterceptors()` result and feeds it to `sendResponse()`. But if an interceptor transforms the result (e.g., wraps in `{ data: result, timestamp: ... }`), `sendResponse()` will JSON.stringify it. Fine. BUT if the interceptor ALSO writes headers directly to `res` (e.g., `res.setHeader('X-Custom', '...')`), there's a conflict — the interceptor has `req` but NOT `res`, so it can't set headers.
- **Impact:** Interceptors that need to set response headers (e.g., `TimingInterceptor` adding `X-Response-Time`) have NO access to `res` in the plan's `intercept(req, next)` signature.
- **Suggested fix:** Change the interceptor interface to include `res`: `intercept(request: IncomingMessage, response: ServerResponse, next: () => Promise<unknown>): Promise<unknown>`. This matches the real-world need (timing headers, caching headers, CORS headers from interceptors). NestJS achieves this via `ExecutionContext` which wraps both req/res — the plan's simplified interface must still provide `res` access.

### EC-3: `resolveOrNew()` duplicated across 4 files — DRY violation
- **Affected task:** T1.1
- **Family:** State
- **Scenario:** `resolveOrNew(Ctor, container)` exists in `create-server.ts` (line 315-324), `theokit-plugin.ts` (line ~350), `app.ts` (line ~270). T1.1 plans to "extract to shared utility if duplicated". This is a MUST FIX, not a REFACTOR suggestion — adding a 4th copy in `interceptor-chain.ts` violates DRY (Unbreakable Rule 12).
- **Impact:** Bug fix in one copy doesn't propagate to others. Already a 3-way violation; adding a 4th makes it worse.
- **Suggested fix:** Extract `resolveOrNew` to `bridge/di-resolve.ts` as shared function BEFORE implementing interceptors. All 4 files import from one location. Task T1.1 step 1 becomes: "Extract resolveOrNew to bridge/di-resolve.ts, update imports in create-server.ts, theokit-plugin.ts, app.ts".

## SHOULD TEST

### EC-4: Interceptor throws — error must propagate to catch block, not swallow
- **Affected task:** T1.2
- **Suggested test:** `test_interceptor_error_propagates_to_500` — interceptor throws Error inside `intercept()`, expect HTTP 500 with `INTERNAL_SERVER_ERROR` code (same as handler errors). Verify the error doesn't get silently caught by the onion model.

### EC-5: Interceptor calls `next()` multiple times — should only execute handler once
- **Affected task:** T1.1
- **Suggested test:** `test_interceptor_double_next_only_executes_once` — interceptor calls `next()` twice, expect handler to execute only once (second `next()` returns cached result OR throws). NestJS uses `CallHandler.handle()` which returns Observable that replays — the Promise equivalent is: second `await next()` returns same result (memoized) OR throws "handler already executed".

### EC-6: Middleware `next()` not called — request hangs
- **Affected task:** T2.2
- **Suggested test:** `test_middleware_without_next_hangs_detection` — middleware class `use()` never calls `next()`. Per NestJS docs: "if the current middleware function does not end the request-response cycle, it must call next()". Test should verify timeout behavior or that the response is sent by the middleware itself (both valid).

### EC-7: MiddlewareConsumer `forRoutes` with controller prefix mismatch
- **Affected task:** T2.1
- **Suggested test:** `test_forRoutes_matches_with_controller_prefix` — `forRoutes('tasks')` should match routes under `@Controller('api/v2/tasks')`. The matching logic must account for the controller prefix. Test: `forRoutes('api/v2/tasks')` matches, `forRoutes('tasks')` does NOT match (requires full path). Decide and test the chosen behavior.

## DOCUMENT

### EC-8: Interceptor return type mismatch with existing `sendResponse()`
- **Accepted risk:** `sendResponse()` handles `undefined | null | string | object`. If an interceptor returns a non-serializable value (e.g., a Buffer, a ReadableStream), `JSON.stringify()` will produce garbage. This is the same limitation that exists for handler return values today — not new. Document that interceptor return values must be JSON-serializable (same contract as route handlers).

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 3 | 1 (EC-3 DRY) | 1 (EC-5 double next) | 0 |
| T1.2 | 3 | 2 (EC-1 stale res, EC-2 no res access) | 1 (EC-4 error propagation) | 1 (EC-8 serialization) |
| T2.1 | 1 | 0 | 1 (EC-7 prefix matching) | 0 |
| T2.2 | 1 | 0 | 1 (EC-6 no next() call) | 0 |
| T3.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 3 MUST FIX items require plan revision before `/implement`.
