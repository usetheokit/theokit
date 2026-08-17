# Edge Case Review — http-decorators-exception-filters

Date: 2026-06-09
Tasks analyzed: 5 (T1.1, T2.1, T2.2, T3.1, T3.2)
Edge cases found: 5 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: Exception filter itself throws — infinite recursion risk
- **Affected task:** T2.2
- **Family:** State
- **Scenario:** A custom `ExceptionFilter.catch()` throws an error. If `runExceptionFilters` is called recursively to handle the filter's own error, it triggers infinite recursion → stack overflow.
- **Impact:** Process crash via `RangeError: Maximum call stack size exceeded`.
- **Suggested fix:** `runExceptionFilters` must have a one-shot guard: if handling the filter's own error, fall through directly to the global fallback (500 JSON) — never re-enter the filter chain. `let filterDepth = 0; if (filterDepth > 0) { sendGlobalFallback(); return; } filterDepth++; try { ... } finally { filterDepth--; }`

### EC-2: Response already sent when exception filter runs — ERR_HTTP_HEADERS_SENT
- **Affected task:** T3.1
- **Family:** State
- **Scenario:** The handler partially writes a response (e.g., `res.writeHead(200)` then throws mid-body). The exception filter calls `res.writeHead(500)` → Node throws `ERR_HTTP_HEADERS_SENT`.
- **Impact:** Process crash if not caught.
- **Suggested fix:** Check `res.headersSent` at the top of `runExceptionFilters`. If already sent, log the error to console.error and return without writing — the response is already in-flight and cannot be replaced.

## SHOULD TEST

### EC-3: HttpException with object `response` arg (NestJS overload)
- **Affected task:** T1.1
- **Suggested test:** `test_http_exception_with_object_response` — NestJS allows `new HttpException({status: 403, error: 'custom'}, 403)` where the first arg is an object that becomes the response body. The plan shows only string `message`. Test that passing an object as first arg works (either serialize it or reject with clear error).

### EC-4: @UseFilters with filter INSTANCE vs CLASS
- **Affected task:** T2.1
- **Suggested test:** `test_use_filters_with_instance` — NestJS supports both `@UseFilters(new MyFilter())` (instance) and `@UseFilters(MyFilter)` (class). The plan only shows class refs. Test that passing an already-instantiated filter works (detect via `typeof arg === 'object'` vs `typeof arg === 'function'`).

## DOCUMENT

### EC-5: Filter ordering when multiple @Catch types match
- **Accepted risk:** If two filters both `@Catch(HttpException)`, only the FIRST one in the `@UseFilters(A, B)` array runs. This is NestJS behavior — not a bug. Document that filter ordering in `@UseFilters()` args determines priority. No code change needed.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 1 (EC-3) | 0 |
| T2.1 | 1 | 0 | 1 (EC-4) | 0 |
| T2.2 | 1 | 1 (EC-1) | 0 | 0 |
| T3.1 | 1 | 1 (EC-2) | 0 | 0 |
| T3.2 | 0 | 0 | 0 | 0 |
| General | 1 | 0 | 0 | 1 (EC-5) |

**Verdict:** PLAN NEEDS ADJUSTMENT — 2 MUST FIX items (EC-1 recursion guard, EC-2 headersSent check).
