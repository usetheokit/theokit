# Edge Case Review — theokit-observability-builtin

Date: 2026-06-10
Tasks analyzed: 6
Edge cases found: 7 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: theo-cloud adapter fetch failure silently drops spans
- **Affected task:** T30.3 (OTLP serializer + theo-cloud adapter)
- **Family:** I/O / Resource
- **Scenario:** `fetch()` to TheoCloud ingest fails (network down, DNS error, 5xx). The adapter calls `flush()` but the spans are discarded. No retry, no buffer-to-disk, no error signal to the developer.
- **Impact:** Production telemetry silently lost. Developer doesn't know observability is broken.
- **Suggested fix:** On fetch failure, log a warning via `console.error('[theokit:observability] flush failed: ${err.message}')` and increment a `flush_errors` counter. Do NOT retry (KISS) — just make the failure visible.

### EC-2: span.end() called after adapter.shutdown() — write-after-close
- **Affected task:** T30.1 (ObservabilityAdapter interface)
- **Family:** State / Timing
- **Scenario:** Server is shutting down. `adapter.shutdown()` is called. An in-flight request's span calls `span.end()` after shutdown. The adapter tries to accumulate a span into a closed batch buffer.
- **Impact:** Crash or silent data loss depending on implementation.
- **Suggested fix:** Add `isShutdown` boolean to adapter. `startSpan()` after shutdown returns a noop span. `flush()` after shutdown is a no-op.

## SHOULD TEST

### EC-3: OTLP serializer with empty spans array
- **Affected task:** T30.3 (OTLP serializer)
- **Suggested test:** `test_otlp_serializer_empty_spans()` — `serializeSpansToOtlp([])` returns valid OTLP JSON with empty `resourceSpans[0].scopeSpans[0].spans` array, not null/undefined.

### EC-4: Adapter registry with both env vars AND config provider set
- **Affected task:** T30.4 (Adapter registry)
- **Suggested test:** `test_config_provider_overrides_env()` — when `THEO_CLOUD_INGEST_URL` is set AND `config.observability.provider` is a custom adapter, config wins per D457 priority chain. Verify this is correct (plan says config overrides env, but D457 says env first — clarify).

### EC-5: Middleware span with streaming response (SSE)
- **Affected task:** T30.5 (Middleware)
- **Suggested test:** `test_middleware_span_with_sse_response()` — SSE responses don't have a clean "response end" moment. The span should end when the response stream closes (res.on('close')), not when headers are sent.

## DOCUMENT

### EC-6: OTLP serializer doesn't handle nested spans (parent-child)
- **Accepted risk:** The plan mentions parent-child in the SpanHandle interface but OTLP serialization only serializes flat spans. Nested span trees require `parentSpanId` field in the serializer. For v1, flat spans are sufficient — HTTP requests are top-level. Agent sub-spans (tool calls inside LLM loops) are a follow-up.

### EC-7: No sampling — every request produces a span
- **Accepted risk:** For the initial implementation, every request emits a span. At high traffic, this produces significant volume. Sampling (head-based or tail-based) is a v2 feature. TheoCloud's ingest endpoint handles volume on their side. Dev mode (console adapter) is bounded by terminal output speed.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T30.1 | 1 | 1 (EC-2) | 0 | 0 |
| T30.2 | 0 | 0 | 0 | 0 |
| T30.3 | 2 | 1 (EC-1) | 1 (EC-3) | 1 (EC-6) |
| T30.4 | 1 | 0 | 1 (EC-4) | 0 |
| T30.5 | 1 | 0 | 1 (EC-5) | 0 |
| T30.6 | 0 | 0 | 0 | 0 |
| (cross) | 1 | 0 | 0 | 1 (EC-7) |

**Verdict:** PLAN NEEDS ADJUSTMENT — 2 MUST FIX items (flush failure visibility + shutdown guard) need absorption before implementation.
