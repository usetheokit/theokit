# Plan: TheoKit Built-in Observability Adapter Registry

> **Version 1.1** (2026-06-10) — Absorbed 2 MUST FIX from edge-case review: EC-1 (flush failure visibility), EC-2 (shutdown guard). Plus 3 SHOULD TEST items (EC-3 empty spans, EC-4 priority clarification, EC-5 SSE span close). 2 DOCUMENT items (EC-6 flat spans v1, EC-7 no sampling v1).
>
> **Version 1.0** — Ship a framework-level observability adapter registry in theokit with 3 adapters (console, theo-cloud, noop) + auto-instrumentation middleware + `defineObservabilityAdapter()` public API. Zero-config on TheoCloud deploy. Based on the observability discovery blueprint drawing from Vercel AI SDK, Hono, and OpenTelemetry JS patterns.

## Goal

> "Ship a theokit observability adapter registry with auto-instrumentation middleware so that every HTTP request emits a structured span with method, path, status, and duration, measured by `pnpm exec vitest run tests/observability/` returning 30+ GREEN tests in the theokit repo."

## Context

TheoKit's website promises "RAG, memory, and observability — built in". Cross-validation scored Observability at 2/5. The framework has raw `logRequest()` and W3C `TraceContext` propagation but no adapter-registry pattern. The SDK has 7 telemetry adapters for agent-level spans, but the framework needs its own for request-level lifecycle spans.

Blueprint: `knowledge-base/discoveries/blueprints/theokit-observability-builtin-blueprint.md` — investigated Vercel AI SDK (event dispatcher), Hono (middleware context binding), and OTel JS (OTLP serialization).

## Baseline Context (deep review of current state)

### Files that will be touched

All paths relative to `theokit/packages/theo/src/`.

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `server/observability/index.ts` | 3 | `e761aac` (2026-05-25) | Barrel export for logger + audit-log | Existing re-exports |
| `server/observability/logger.ts` | 211 | `e761aac` (2026-05-25) | TheoLogger interface + factory | `TheoLogger` interface shape |
| `server/observability/request-log.ts` | 158 | `df53626` (2026-06-06) | Request logging + devtools broadcast | `logRequest()` function signature |
| `server/observability/trace-context-propagation.ts` | 97 | `730c33a` (2026-06-06) | W3C TraceContext parsing + generation | `TraceContext` interface |
| `server/observability/adapter-registry.ts` (NEW) | 0 | — | Adapter resolution from config + env | — |
| `server/observability/adapters/types.ts` (NEW) | 0 | — | `ObservabilityAdapter` interface | — |
| `server/observability/adapters/console.ts` (NEW) | 0 | — | Dev-mode console adapter | — |
| `server/observability/adapters/theo-cloud.ts` (NEW) | 0 | — | OTLP/HTTP adapter for TheoCloud | — |
| `server/observability/adapters/noop.ts` (NEW) | 0 | — | Silent fallback | — |
| `server/observability/middleware.ts` (NEW) | 0 | — | Auto-instrument plugin (onRequest/onResponse) | — |
| `server/observability/span.ts` (NEW) | 0 | — | SpanHandle type + builder | — |
| `server/observability/otlp-serializer.ts` (NEW) | 0 | — | Lightweight OTLP JSON encoder | — |
| `server/plugin-types.ts` | 168 | `d22e490` (2026-06-06) | Plugin hook types | `PluginContext` interface |
| `server/plugins/plugin-runner.ts` | 288 | `a2a09f4` (2026-06-06) | Plugin hook execution | `runHook()` API |
| `config/schema.ts` | 292 | `5deffbd` (2026-06-06) | Config zod schema | Additive only |

### Current callers / dependents

- **Symbol:** `logRequest()` in `server/observability/request-log.ts`
  - **Callers:** `vite-plugin/action-middleware.ts`, `vite-plugin/api-middleware.ts`, `cli/commands/start/handlers.ts`
  - The new middleware replaces inline `logRequest()` calls — callers shift to the middleware

- **Symbol:** `runHook()` in `server/plugins/plugin-runner.ts`
  - **Callers:** `vite-plugin/action-middleware.ts`, `vite-plugin/configure-server-hook.ts`, `vite-plugin/api-middleware.ts`
  - The observability middleware registers as a plugin via existing hooks — no changes to plugin-runner

### Domain glossary

- **Adapter** — implementation of ObservabilityAdapter interface that receives spans/metrics/logs and exports them
- **Span** — structured unit of work with name, attributes, start time, duration, parent-child relationship
- **OTLP** — OpenTelemetry Protocol — standard wire format for exporting telemetry (JSON over HTTP)
- **Auto-instrumentation** — middleware that creates spans for every HTTP request without developer code
- **Server-Timing** — HTTP response header (RFC 7230) that exposes server-side timing to browser DevTools

### Architecture boundaries affected

- **Observability layer:** additive — new files in existing `server/observability/` directory
- **Plugin system:** no change — middleware registers as a standard plugin via existing hooks
- **Config layer:** additive — `observability` key added to config schema (per `architecture.md` section 1)
- **Direction:** observability middleware imports from `server/observability/` (same layer); does NOT import from `vite-plugin/` or `cli/` (respects `architecture.md` section 1 inward-only dependency)

## Prior Art & Related Work

- **Blueprint:** `knowledge-base/discoveries/blueprints/theokit-observability-builtin-blueprint.md` — full research with file:line citations from 3 references
- **Vercel AI SDK:** Event dispatcher + registry pattern (`/tmp/ref-vercel-ai/packages/ai/src/telemetry/telemetry.ts:85-247`)
- **Hono:** Middleware context binding + Server-Timing header (`/tmp/ref-hono/src/middleware/timing/timing.ts:76-126`)
- **OpenTelemetry JS:** OTLP JSON serialization contract (`/tmp/ref-otel-js/experimental/packages/otlp-transformer/src/i-serializer.ts:9-21`)

## Objective

- [ ] Ship `ObservabilityAdapter` interface with `startSpan`, `counter`, `histogram`, `log`, `flush`, `shutdown`
- [ ] Ship `console` adapter (dev default — JSON to stderr + Server-Timing header)
- [ ] Ship `theo-cloud` adapter (OTLP/HTTP batched export — zero-config via env vars)
- [ ] Ship `noop` adapter (silent fallback)
- [ ] Ship auto-instrumentation middleware as a theokit plugin
- [ ] Ship `defineObservabilityAdapter()` public API for custom adapters
- [ ] Ship adapter-registry with auto-detection priority chain

## ADRs

### D455 — Framework-level adapter registry separate from SDK telemetry

**Status:** Proposed.
**Context:** SDK has 7 telemetry adapters for agent-level spans. Framework needs request-level spans for HTTP lifecycle.
**Decision:** Separate registries. Framework adapter owns request/response spans. SDK adapter owns agent/tool/LLM spans. Both can emit to the same backend.
**Alternatives:** (a) Share one registry — REJECTED, different lifecycle scopes (SRP). (b) No framework obs — REJECTED, cross-validation gap + website promise.
**Rules cited:** `architecture.md` section 1 (SRP at module level), `architecture.md` section 2 (DIP — adapter implements interface).

### D456 — In-house OTLP serializer (not full OTel SDK)

**Status:** Proposed.
**Context:** Full OTel OTLP exporter requires 5 packages (~200KB). OTLP JSON format is documented and stable.
**Decision:** Ship ~50 LoC in-house serializer for the theo-cloud adapter. Users who want full OTel use `defineObservabilityAdapter()` with their own tracer.
**Alternatives:** (a) Depend on `@opentelemetry/*` — REJECTED, 5 packages for a 50 LoC serialization (KISS). (b) Proprietary format — REJECTED, lock-in (blueprint ADR on OTLP wire format).
**Rules cited:** KISS, YAGNI.

### D457 — Auto-detection priority chain for adapter resolution

**Status:** Proposed.
**Context:** TheoCloud injects env vars on deploy. Developer writes zero config.
**Decision:** Priority: (1) `theo.config.ts` observability.provider → configured adapter (explicit config always wins). (2) `THEO_CLOUD_INGEST_URL` env → theo-cloud. (3) `NODE_ENV=development` → console. (4) fallback → noop. (Updated v1.1: explicit config overrides env per EC-4.)
**Alternatives:** (a) Always require explicit config — REJECTED, breaks zero-config promise. (b) Always console in prod — REJECTED, noisy.

## Dependency Graph

```
Phase A (Foundation — types + span + noop)
  ├── T30.1 ObservabilityAdapter interface + SpanHandle + noop adapter
  └── T30.2 Console adapter (dev mode)

Phase B (depends on Phase A)
  ├── T30.3 OTLP serializer + theo-cloud adapter
  ├── T30.4 Adapter registry + auto-detection
  └── T30.5 Auto-instrumentation middleware plugin

Phase C (Integration Validation)
  └── T30.6 defineObservabilityAdapter() public API + E2E tests + validation
```

## Phase A — Foundation

### T30.1 — ObservabilityAdapter interface + SpanHandle + noop adapter

#### Why this step

**Action:** Define the core interface contract and the simplest adapter (noop) to establish the extension point.

**Reasoning:** Per blueprint Pattern 1 (Vercel AI SDK lifecycle contract), the interface is the contract that all adapters implement. Noop is the safe fallback — it does nothing, never throws, never blocks. Per `architecture.md` section 2 (DIP), the interface lives in the observability layer; adapters implement it.

#### Files to edit

- `server/observability/adapters/types.ts` (NEW) — ObservabilityAdapter + SpanHandle interfaces
- `server/observability/span.ts` (NEW) — SpanHandle implementation + span builder
- `server/observability/adapters/noop.ts` (NEW) — NoopObservabilityAdapter
- `tests/observability/adapter-interface.test.ts` (NEW)

#### TDD

```
RED: test("noop adapter startSpan returns a SpanHandle", () => {
  const adapter = new NoopObservabilityAdapter();
  const span = adapter.startSpan("test.span");
  expect(span).toBeDefined();
  expect(typeof span.end).toEqual("function");
  expect(typeof span.setAttribute).toEqual("function");
});

RED: test("noop adapter counter/histogram/log do not throw", () => {
  const adapter = new NoopObservabilityAdapter();
  expect(() => adapter.counter("test.count", 1)).not.toThrow();
  expect(() => adapter.histogram("test.duration", 42)).not.toThrow();
  expect(() => adapter.log("info", "test")).not.toThrow();
});

RED: test("noop span end is idempotent", () => {
  const adapter = new NoopObservabilityAdapter();
  const span = adapter.startSpan("test");
  span.end();
  expect(() => span.end()).not.toThrow();
});

RED: test("EC-2: startSpan after shutdown returns noop span", async () => {
  const adapter = new NoopObservabilityAdapter();
  await adapter.shutdown();
  const span = adapter.startSpan("post-shutdown");
  expect(span).toBeDefined();
  expect(() => span.end()).not.toThrow();
});

RED: test("EC-2: flush after shutdown is a no-op", async () => {
  const adapter = new NoopObservabilityAdapter();
  await adapter.shutdown();
  await expect(adapter.flush()).resolves.not.toThrow();
});
```

#### Acceptance criteria

- `ObservabilityAdapter` interface with `startSpan`, `counter`, `histogram`, `log`, `flush`, `shutdown`
- `SpanHandle` interface with `setAttribute`, `setStatus`, `end`
- `NoopObservabilityAdapter` implements all methods as no-ops
- `pnpm exec vitest run tests/observability/adapter-interface.test.ts` exit 0 with 5+ tests

#### DoD

- Tests GREEN, `pnpm typecheck` exit 0
- CHANGELOG entry

---

### T30.2 — Console adapter (dev mode)

#### Why this step

**Action:** Ship a console adapter that emits JSON-structured logs to stderr and adds Server-Timing response headers.

**Reasoning:** Per blueprint Pattern 2 (Hono middleware timing), Server-Timing is free observability visible in browser DevTools. The console adapter is the dev-mode default — developers see spans in their terminal without any setup.

#### Files to edit

- `server/observability/adapters/console.ts` (NEW) — ConsoleObservabilityAdapter
- `tests/observability/console-adapter.test.ts` (NEW)

#### TDD

```
RED: test("console adapter logs span to stderr as JSON", () => {
  const chunks: string[] = [];
  const adapter = new ConsoleObservabilityAdapter({ write: (s) => chunks.push(s) });
  const span = adapter.startSpan("http.request", { method: "GET", path: "/" });
  span.end();
  expect(chunks.length).toBeGreaterThanOrEqual(1);
  const log = JSON.parse(chunks[0]);
  expect(log.name).toEqual("http.request");
  expect(log.duration_ms).toBeGreaterThanOrEqual(0);
});

RED: test("console adapter counter emits structured log", () => {
  const chunks: string[] = [];
  const adapter = new ConsoleObservabilityAdapter({ write: (s) => chunks.push(s) });
  adapter.counter("http.requests", 1, { method: "GET" });
  expect(chunks.length).toEqual(1);
  const log = JSON.parse(chunks[0]);
  expect(log.metric).toEqual("http.requests");
  expect(log.value).toEqual(1);
});
```

#### Acceptance criteria

- `ConsoleObservabilityAdapter` emits JSON lines to configurable writer (default `process.stderr`)
- Span logs include: name, duration_ms, attributes, status
- Counter/histogram logs include: metric name, value, attributes
- `pnpm exec vitest run tests/observability/console-adapter.test.ts` exit 0 with 5+ tests

#### DoD

- Tests GREEN, CHANGELOG entry

---

## Phase B — TheoCloud adapter + registry + middleware

### T30.3 — OTLP serializer + theo-cloud adapter

#### Why this step

**Action:** Ship a lightweight OTLP JSON serializer and the theo-cloud adapter that batches and exports spans via native `fetch()`.

**Reasoning:** Per plan ADR D456, in-house OTLP serializer (~50 LoC) avoids the 5-package OTel dependency. TheoCloud accepts standard OTLP/HTTP — no proprietary format.

#### Files to edit

- `server/observability/otlp-serializer.ts` (NEW) — serialize spans to OTLP JSON
- `server/observability/adapters/theo-cloud.ts` (NEW) — TheoCloudObservabilityAdapter
- `tests/observability/otlp-serializer.test.ts` (NEW)
- `tests/observability/theo-cloud-adapter.test.ts` (NEW)

#### TDD

```
RED: test("OTLP serializer produces valid ExportTraceServiceRequest JSON", () => {
  const spans = [{ name: "http.request", traceId: "abc", spanId: "def", startTimeMs: 1000, endTimeMs: 1050, attributes: { method: "GET" }, status: "ok" }];
  const bytes = serializeSpansToOtlp(spans);
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  expect(parsed.resourceSpans).toBeDefined();
  expect(parsed.resourceSpans[0].scopeSpans[0].spans[0].name).toEqual("http.request");
});

RED: test("theo-cloud adapter batches spans and flushes via fetch", async () => {
  const fetched: { url: string; body: string }[] = [];
  const adapter = new TheoCloudObservabilityAdapter({
    ingestUrl: "https://ingest.test/v1/traces",
    token: "test-key-fixture",
    _mockFetch: async (url, init) => { fetched.push({ url: url as string, body: init?.body as string }); return new Response("ok"); },
  });
  const span = adapter.startSpan("test");
  span.end();
  await adapter.flush();
  expect(fetched.length).toEqual(1);
  expect(fetched[0].url).toEqual("https://ingest.test/v1/traces");
});

RED: test("EC-1: flush failure logs warning and does not throw", async () => {
  const warnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => warnings.push(String(args[0]));
  const adapter = new TheoCloudObservabilityAdapter({
    ingestUrl: "https://ingest.test/v1/traces",
    token: "test-key-fixture",
    _mockFetch: async () => { throw new Error("network down"); },
  });
  const span = adapter.startSpan("test");
  span.end();
  await expect(adapter.flush()).resolves.not.toThrow();
  expect(warnings.some(w => w.includes("flush failed"))).toBe(true);
  console.error = origError;
});

RED: test("EC-3: OTLP serializer with empty spans array", () => {
  const bytes = serializeSpansToOtlp([]);
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  expect(parsed.resourceSpans).toBeDefined();
  expect(parsed.resourceSpans[0].scopeSpans[0].spans).toEqual([]);
});
```

#### Acceptance criteria

- `serializeSpansToOtlp(spans)` returns `Uint8Array` of valid OTLP JSON
- `TheoCloudObservabilityAdapter` accumulates spans, flushes via `fetch()` POST to `ingestUrl`
- Mock fetch in tests (no real network calls)
- `pnpm exec vitest run tests/observability/otlp-serializer.test.ts tests/observability/theo-cloud-adapter.test.ts` exit 0 with 8+ tests

#### DoD

- Tests GREEN, CHANGELOG entry

---

### T30.4 — Adapter registry + auto-detection

#### Why this step

**Action:** Ship the adapter registry that resolves the active adapter from env vars + config with the priority chain from ADR D457.

**Reasoning:** Per blueprint Boot Sequence pattern (from Vercel AI SDK), the adapter is resolved once at boot — not via global singleton.

#### Files to edit

- `server/observability/adapter-registry.ts` (NEW) — resolveAdapter() function
- `tests/observability/adapter-registry.test.ts` (NEW)

#### TDD

```
RED: test("resolves theo-cloud when THEO_CLOUD_INGEST_URL is set", () => {
  const adapter = resolveAdapter({ env: { THEO_CLOUD_INGEST_URL: "https://ingest.test", THEO_CLOUD_API_KEY: "tck_x" } });
  expect(adapter.name).toEqual("theo-cloud");
});

RED: test("resolves console when NODE_ENV=development", () => {
  const adapter = resolveAdapter({ env: { NODE_ENV: "development" } });
  expect(adapter.name).toEqual("console");
});

RED: test("resolves noop as fallback", () => {
  const adapter = resolveAdapter({ env: {} });
  expect(adapter.name).toEqual("noop");
});

RED: test("config override takes precedence over env detection", () => {
  const custom = { name: "custom", startSpan: () => ({ setAttribute() {}, setStatus() {}, end() {} }), counter() {}, histogram() {}, log() {}, flush: async () => {}, shutdown: async () => {} };
  const adapter = resolveAdapter({ env: { NODE_ENV: "development" }, config: { provider: custom } });
  expect(adapter.name).toEqual("custom");
});

RED: test("EC-4: config provider overrides THEO_CLOUD env var", () => {
  const custom = { name: "custom-override", startSpan: () => ({ setAttribute() {}, setStatus() {}, end() {} }), counter() {}, histogram() {}, log() {}, flush: async () => {}, shutdown: async () => {} };
  const adapter = resolveAdapter({ env: { THEO_CLOUD_INGEST_URL: "https://ingest.test", THEO_CLOUD_API_KEY: "tck_x" }, config: { provider: custom } });
  expect(adapter.name).toEqual("custom-override");
});
```

#### Acceptance criteria

- `resolveAdapter({ env, config? })` returns the correct adapter per priority chain
- Priority: THEO_CLOUD env → config.observability.provider → NODE_ENV=development → noop
- `pnpm exec vitest run tests/observability/adapter-registry.test.ts` exit 0 with 4+ tests

#### DoD

- Tests GREEN

---

### T30.5 — Auto-instrumentation middleware plugin

#### Why this step

**Action:** Ship a theokit plugin that auto-instruments every HTTP request with a span using the resolved adapter.

**Reasoning:** Per blueprint Pattern 2 (Hono middleware), the plugin wraps the request lifecycle with `onRequest` (start span) and `onResponse` (end span + emit metrics). Registers via the existing theokit plugin system — no changes to plugin-runner needed.

#### Files to edit

- `server/observability/middleware.ts` (NEW) — observabilityPlugin factory
- `tests/observability/middleware.test.ts` (NEW)

#### TDD

```
RED: test("middleware creates span with method + path + status", async () => {
  const spans: { name: string; attrs: Record<string, unknown> }[] = [];
  const mockAdapter = { name: "mock", startSpan(name: string, attrs: Record<string, unknown>) { const s = { name, attrs, setAttribute(k: string, v: unknown) { attrs[k] = v; }, setStatus() {}, end() { spans.push({ name, attrs }); } }; return s; }, counter() {}, histogram() {}, log() {}, flush: async () => {}, shutdown: async () => {} };
  const plugin = createObservabilityPlugin(mockAdapter);
  // simulate onRequest + onResponse hooks
  const ctx = { requestId: "r1", request: { method: "GET", url: "/api/test" } };
  await plugin.onRequest(ctx);
  ctx.response = { statusCode: 200 };
  await plugin.onResponse(ctx);
  expect(spans.length).toEqual(1);
  expect(spans[0].attrs.method).toEqual("GET");
  expect(spans[0].attrs.status).toEqual(200);
});
```

#### Acceptance criteria

- `createObservabilityPlugin(adapter)` returns a plugin with `onRequest` + `onResponse` + `onError` hooks
- Span attributes: `method`, `path`, `status`, `duration_ms`, `requestId`
- `onError` sets span status to "error" with error message
- EC-5: SSE streaming responses end span on `res.close` event, not on headers sent
- `pnpm exec vitest run tests/observability/middleware.test.ts` exit 0 with 6+ tests

#### DoD

- Tests GREEN, CHANGELOG entry

---

## Phase C — Public API + Integration Validation

### T30.6 — defineObservabilityAdapter() + E2E + validation

#### Why this step

**Action:** Ship the public `defineObservabilityAdapter()` factory, update barrel exports, and run full validation.

**Reasoning:** The escape hatch for self-host users. Per blueprint, users who want Datadog/Grafana implement the interface and pass it to config.

#### Files to edit

- `server/observability/index.ts` — add barrel exports for new modules
- `tests/observability/define-adapter.test.ts` (NEW) — custom adapter E2E
- `tests/observability/e2e-full-pipeline.test.ts` (NEW) — console + noop + registry E2E

#### TDD

```
RED: test("defineObservabilityAdapter creates a valid adapter", () => {
  const adapter = defineObservabilityAdapter({
    name: "my-backend",
    startSpan: (name) => ({ setAttribute() {}, setStatus() {}, end() {} }),
    counter: () => {},
    histogram: () => {},
    log: () => {},
    flush: async () => {},
    shutdown: async () => {},
  });
  expect(adapter.name).toEqual("my-backend");
  const span = adapter.startSpan("test");
  expect(typeof span.end).toEqual("function");
});

RED: test("E2E: full pipeline — request through middleware emits to adapter", async () => {
  const events: string[] = [];
  const adapter = defineObservabilityAdapter({
    name: "test-e2e",
    startSpan: (name) => { events.push("span:" + name); return { setAttribute() {}, setStatus() {}, end() { events.push("end"); } }; },
    counter: (name) => events.push("counter:" + name),
    histogram: (name) => events.push("histogram:" + name),
    log: () => {},
    flush: async () => {},
    shutdown: async () => {},
  });
  const plugin = createObservabilityPlugin(adapter);
  await plugin.onRequest({ requestId: "e2e", request: { method: "POST", url: "/api/data" } });
  await plugin.onResponse({ requestId: "e2e", request: { method: "POST", url: "/api/data" }, response: { statusCode: 201 } });
  expect(events).toEqual(expect.arrayContaining(["span:http.request", "end"]));
});
```

#### Acceptance criteria

- `defineObservabilityAdapter(config)` validates shape and returns typed adapter
- Barrel export from `server/observability/index.ts` includes all public types + functions
- E2E test covers full pipeline: registry → middleware → adapter
- `pnpm exec vitest run tests/observability/` exit 0 with 25+ total tests

#### DoD

- All tests GREEN, CHANGELOG entries for all tasks
- Every new file under 200 LoC (per KISS)
- `pnpm typecheck` exit 0

---

## Coverage Matrix

| # | Gap | Severity | Dimension | Task ID |
|---|-----|----------|-----------|---------|
| OBS-1 | ObservabilityAdapter interface + SpanHandle | CRITICAL | Architecture | T30.1 |
| OBS-2 | Console adapter (dev default) | HIGH | DevTooling | T30.2 |
| OBS-3 | OTLP serializer + theo-cloud adapter | CRITICAL | TheoCloud | T30.3 |
| OBS-4 | Adapter registry + auto-detection | HIGH | DX | T30.4 |
| OBS-5 | Auto-instrumentation middleware | CRITICAL | Observability | T30.5 |
| OBS-6 | Public API + E2E validation | GATE | ALL | T30.6 |

**Coverage: 6/6 gaps mapped (100%).**

## Drawbacks & Risks

| # | Risk | Severity | Mitigation | Owner |
|---|------|----------|------------|-------|
| R1 | In-house OTLP serializer will drift from spec as OTLP evolves | MEDIUM | Pin to OTLP JSON v1.0 (stable since 2023). Add integration test against a real OTLP collector in CI (deferred to follow-up). | T30.3 owner |
| R2 | Auto-instrumentation adds latency overhead per request | LOW | Noop adapter has near-zero overhead. Console adapter writes async. TheoCloud adapter batches (5s flush). Measure p99 overhead in load test. | T30.5 owner |
| R3 | TheoCloud ingest endpoint does not exist yet (proprietary side) | MEDIUM | Mock fetch in tests. Real integration test deferred to TheoCloud milestone. Adapter works correctly in isolation. | T30.3 owner |
| R4 | EC-6: OTLP serializer is flat (no parent-child spans) | LOW | Flat spans sufficient for HTTP request-level. Agent sub-spans (tool calls) are a follow-up when SDK telemetry integration ships. | T30.3 owner |
| R5 | EC-7: No sampling — every request = 1 span | LOW | Acceptable for v1. TheoCloud handles volume on ingest side. Console adapter bounded by terminal speed. Head-based sampling is a v2 feature. | T30.5 owner |

## Unresolved Questions

- UQ1: Batch flush interval for theo-cloud adapter — 5s or 10s? Default: 5s (matches OTel default). Configurable via `THEO_CLOUD_FLUSH_INTERVAL_MS`.
- UQ2: Server-Timing header in console adapter — emit in production too or dev-only? Default: dev-only (NODE_ENV check). Production users can enable via config flag.

## Global DoD

- `pnpm exec vitest run tests/observability/` exit 0 with 30+ GREEN tests in theokit repo
- `pnpm typecheck` exit 0
- Every new file under 200 LoC
- CHANGELOG entries for all 6 tasks
- No dependency on `@opentelemetry/*` packages in the framework
