# Edge Case Review — theokit-runtime-optimization

Date: 2026-06-10
Tasks analyzed: 7
Edge cases found: 6 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 1)

## MUST FIX

### EC-1: Node adapter body conversion loses streaming for large POST bodies
- **Affected task:** T2.1 (Node.js runtime adapter)
- **Family:** Input / Boundary
- **Scenario:** `nodeIncomingToRequest(nodeReq)` buffers the entire body into memory before creating the `Request` object. For large uploads (file upload, large JSON), this doubles memory usage (one copy in Node buffer, one in Request body).
- **Impact:** OOM on large POST bodies (>100MB). The current `create-server.ts` parses body incrementally via `req.on('data')` chunks — the adapter must preserve this.
- **Suggested fix:** Use `ReadableStream.from(nodeReq)` (Node 20+) to create a streaming Request body without buffering. Fallback to `Readable.toWeb(nodeReq)` on Node 18-19.

### EC-2: SSE handler migration — Response body must be a ReadableStream, not res.write()
- **Affected task:** T1.2 (Interceptor/Filter/Middleware migration)
- **Family:** State / Format
- **Scenario:** Current SSE handler does `res.write(event)` imperatively on each event. Web Standard `Response` is immutable — you can't write to it after creation. The SSE handler must return a `Response` with a `ReadableStream` body that the runtime adapter writes to.
- **Impact:** If not handled, SSE streaming breaks entirely on all runtimes.
- **Suggested fix:** SSE handler creates `new Response(new ReadableStream({ start(controller) { ... } }), { headers: { 'content-type': 'text/event-stream' } })`. The controller.enqueue() replaces res.write().

## SHOULD TEST

### EC-3: Web Standard Request.body consumed twice
- **Affected task:** T1.1 (ExecutionContext migration)
- **Suggested test:** `test_request_body_consumed_twice_throws()` — `Request.body` is a ReadableStream that can only be read ONCE. If a guard reads the body (to check payload size) and the handler also reads it, the second read throws. Test that the pipeline clones the request or caches the body.

### EC-4: Node adapter with HTTP/2 IncomingMessage
- **Affected task:** T2.1 (Node.js runtime adapter)
- **Suggested test:** `test_node_adapter_http2_compat()` — Node's `http2.Http2ServerRequest` has the same shape as `IncomingMessage` but is a different class. Verify the adapter handles both (or document HTTP/2 as unsupported).

### EC-5: WeakMap memoization with subclassed controllers
- **Affected task:** T3.1 (Metadata memoization)
- **Suggested test:** `test_memoization_subclass_separate_from_parent()` — if `class ChildCtrl extends ParentCtrl`, the WeakMap key is `ChildCtrl` (not `ParentCtrl`). Verify child and parent get separate cached results.

## DOCUMENT

### EC-6: Response immutability vs interceptor mutation
- **Accepted risk:** Web Standard `Response` is immutable — headers and status can't be changed after creation. Interceptors that currently do `res.setHeader('X-Response-Time', ...)` must instead create a NEW Response with the added header. This is a pattern shift (immutable pipelines) but not a bug — Hono solves it the same way. Document in the migration guide.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 1 (EC-3) | 0 |
| T1.2 | 2 | 1 (EC-2) | 0 | 1 (EC-6) |
| T2.1 | 2 | 1 (EC-1) | 1 (EC-4) | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T3.1 | 1 | 0 | 1 (EC-5) | 0 |
| T3.2 | 0 | 0 | 0 | 0 |
| T3.3 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 2 MUST FIX items (streaming body conversion + SSE ReadableStream) need absorption before implementation.
