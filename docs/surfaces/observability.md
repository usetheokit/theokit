# Observability in this framework: what exists, and where it can be better than the field

Re-measured 2026-08-20, then amended the same day after three changes landed on this very surface —
span identity and parentage (usetheokit/theokit#368), the served step ceiling (#363) and a readable
stop reason (#379). The rows marked **Added 2026-08-20** are those; everything else is as first read.
A surface measured in the morning and changed in the afternoon is exactly the drift the header below
warns about, so it is recorded rather than silently refreshed.

Measured against `packages/theo/src/server/observability/`,
`packages/theo/src/server/observability-bootstrap.ts`,
`packages/theo/src/server/agent/observe-agent-run.ts`,
`packages/theo/src/server/http/trace-context.ts`,
`packages/theo/src/cli/commands/start/` and `packages/theo/src/config/schemas/observability.ts`.
Re-measure before trusting.

The 2026-08-19 version of this file listed every module in this directory under "what exists"
without asking whether anything called them. Nothing did: the framework emitted no spans at all
(`packages/theo/src/server/observability-bootstrap.ts:5`). That is the single error this re-measure
exists to correct, and the third column below is what stops it recurring.

## Contents

1. [What exists](#what-exists)
2. [What is strong](#what-is-strong)
3. [Parity gaps](#parity-gaps)
4. [Where this framework can be better](#where-this-framework-can-be-better)
5. [The order](#the-order)

---

## What exists

| Capability | Shape | Reachable from production? |
|---|---|---|
| Span implementation | `SpanImpl` — name, attributes, status, start, end, duration; `NoopSpan` for the disabled path | Yes, through the adapters |
| Adapter contract | `defineObservabilityAdapter` (`packages/theo/src/server/observability/define-adapter.ts:41`), a registry and a resolver | The registry is called at boot (`packages/theo/src/server/observability-bootstrap.ts:76`); `defineObservabilityAdapter` itself has no in-repo caller and is a public API for applications |
| Adapters | Console, noop, and a managed-platform adapter | Yes — resolved from config and environment |
| Boot wiring | `createObservabilityPluginFromConfig` builds the plugin and remembers the adapter (`packages/theo/src/server/observability-bootstrap.ts:59`) | Yes — production (`packages/theo/src/cli/commands/start/index.ts:94`) and dev (`packages/theo/src/vite-plugin/config-resolve.ts:23`) |
| Config key | `observability` in the schema, `enabled` plus `provider` (`packages/theo/src/config/schemas/observability.ts:15`), wired into the root config (`packages/theo/src/config/schema.ts:198`) | Yes |
| Request span | One `http.request` span per request, opened on `onRequest` and closed on `onResponse`/`onError` (`packages/theo/src/server/observability/middleware.ts:89`) | Yes, **on the routes that run plugin hooks** — actions, agents and `/api/*`. Not on SSR page renders. See below |
| Bounded in-flight span state | Per-instance map capped at 1024; an evicted span is ended carrying `span.abandoned` rather than dropped (`packages/theo/src/server/observability/middleware.ts:47`) | Yes |
| Agent run spans | `agent.run`, `agent.tool` and `agent.hitl` translated from the wire chunk stream (`packages/theo/src/server/agent/observe-agent-run.ts:134`) | Yes — `mountAgent` (`packages/theo/src/server/agent/mount-agent.ts:164`) and the thread route (`packages/theo/src/server/agent/build-agent-streamer.ts:85`) |
| **Span identity and parentage** | Every span carries `traceId`, `spanId` and an optional `parentSpanId`, decided when the span starts (`packages/theo/src/server/observability/span.ts:8`); the OTLP serializer reads them instead of minting (`packages/theo/src/server/observability/otlp-serializer.ts:65`). `startSpan` takes an optional third argument placing the span in a trace, forwarded by `defineObservabilityAdapter` so a custom adapter is not trace-blind | Yes. **Added 2026-08-20** (usetheokit/theokit#368). Before it, the serializer drew a `traceId` per span at export time and an agent run reached a collector as N unrelated single-span traces |
| **A run is one trace** | `observeAgentRun` mints one trace per run, pins the run span's id and names it as parent on every tool and pause span (`packages/theo/src/server/agent/observe-agent-run.ts:186`); `mountAgent` continues an incoming W3C `traceparent` rather than opening its own, via `extractW3CTraceId` (`packages/theo/src/server/http/trace-context.ts:127`) | Yes. **Added 2026-08-20.** The narrower resolver exists because `extractTraceIdFromRequest` always returns something and may return an `x-request-id` or a dashed UUID — correlation keys that are not trace ids |
| **Stop reason on the run span** | `agent.run` carries `stop.reason` (`step_limit` / `no_progress`) when the SDK truncated the run (`packages/theo/src/server/agent/observe-agent-run.ts:213`). Span status stays `ok` — a reached ceiling is a declared outcome, not a failure, and marking it error would put every capped run in an operator's error budget | Yes. **Added 2026-08-20** (usetheokit/theokit#379). The SDK's default ceiling is 8 tool-calling turns, so runs were being truncated and reported as an ordinary `done` even for agents that declared nothing |
| Token and cost attributes | Read from the producer's real shape, `usage.*` nested under the finish chunk's metadata (`packages/theo/src/server/agent/observe-agent-run.ts:70`) | Yes |
| Two counters | `http.requests` and `http.errors`, deliberately unlabelled by path (`packages/theo/src/server/observability/middleware.ts:110`, `:122`) | Emitted — but see the metrics row in § Parity gaps |
| OTLP export | An in-house serializer producing OTLP JSON, with no vendor dependency | Yes, from the managed-platform adapter |
| Exporter drain | 5 s interval timer, `unref`'d so it cannot pin the event loop (`packages/theo/src/server/observability/adapters/theo-cloud.ts:57`), plus a final flush on SIGTERM/SIGINT (`packages/theo/src/cli/commands/start/graceful-shutdown.ts:62`) | Yes |
| Bounded exporter buffer | 10 000 spans, oldest evicted with a countable drop (`packages/theo/src/server/observability/adapters/theo-cloud.ts:88`) | Yes |
| Trace-id resolution | `traceparent`, then a **validated** `x-request-id`, then a fresh UUID (`packages/theo/src/server/http/trace-context.ts:92`) | Yes — production honours the incoming header (`packages/theo/src/cli/commands/start/request-handler.ts:232`) and dev already did |
| `x-request-id` validation | `^[A-Za-z0-9_.:-]{1,128}$`, applied on both the Node and the Web resolver (`packages/theo/src/server/http/trace-context.ts:59`, `packages/theo/src/server/http/trace-context.ts:133`) | Yes |
| Trace context propagation | Extract, inject and generate — W3C-shaped | Yes — webhooks (`packages/theo/src/server/webhook/define-webhook.ts:78`), jobs (`packages/theo/src/server/jobs/job-runner.ts:58`), crons |
| Structured logging | A logger module with `warnOnce` and `logRequest` | Yes |
| Request logging | Emitted on every production route branch (`packages/theo/src/cli/commands/start/handlers.ts:168`) | Yes |
| Audit log | Separate module from application logging, used by the CSRF and CSP paths (`packages/theo/src/server/security/csrf.ts:4`) | Yes |

### Corrections to the 2026-08-19 version of this table

* It listed **"Plugin wiring — an observability plugin into the request pipeline"** as existing. The
  plugin returned `{ name, onRequest, onResponse, onError }` against a contract of
  `{ name, register }`, so putting it in `config.plugins` threw at boot; its context type was a
  second invention that only its own tests used
  (`packages/theo/src/server/observability/middleware.ts:11`). It was unregistrable, and the tests
  agreed with it because they called the hooks directly with the invented shape. Now fixed and
  wired at both boots.
* It did not say that **`observability` was absent from the config schema**, so the resolution
  chain's highest-priority source was unreachable and every consumer fell through to the
  environment (`packages/theo/src/config/schemas/observability.ts:6`). The key now exists.
* It listed **"Metrics"** as flatly missing. The adapter contract has `counter`, `histogram` and
  `log`; the console adapter implements them (`packages/theo/src/server/observability/adapters/console.ts:44`)
  and two counters are emitted. What is missing is narrower and is stated as such below.

---

## What is strong

Four decisions here are ahead of the field:

1. **The audit log is a separate module from the application log.** Almost every framework conflates
   them, and the distinction in `logs-and-safety.md` — different retention, mutability and loss
   tolerance — is one this codebase already made structurally.
2. **OTLP without a vendor dependency.** A small serializer producing the standard wire format means
   telemetry is portable to any compliant backend without pulling in a large SDK. That is the right
   trade for a framework: the format is the interoperability point, not the library.
3. **The adapter contract**, resolved once at boot and shared. An agent run's spans come from the
   chunk stream, far from the request hooks, and reach the *same* adapter
   (`packages/theo/src/server/observability-bootstrap.ts:48`) — two independently resolved adapters
   would mean two exporters and two half-complete pictures of one run.
4. **The agent is instrumented from the outside.** `observeAgentRun` translates the wire chunk
   stream rather than reaching into the agent loop, which would have required inverting the package
   graph — and would have quietly instrumented only the HTTP target, leaving Tauri and a terminal
   uncovered (`packages/theo/src/server/agent/observe-agent-run.ts:4`).

---

## Parity gaps

| Missing | Consequence |
|---|---|
| **No span on the SSR page path** | `handleSsrStreaming` and `handleSsrSync` are reached before any plugin runner is consulted (`packages/theo/src/cli/commands/start/request-handler.ts:261`), and the production SSR context carries no runner at all. Page renders — the slowest thing the framework does — produce no span |
| Framework-phase spans | One span per request and three per agent run. Nothing for routing, middleware, render, cache or data access, so the framework's own contribution to latency is still invisible inside `http.request` |
| **Metrics reach the console adapter and stop** | `counter`, `histogram` and `log` are empty bodies on the managed-platform adapter (`packages/theo/src/server/observability/adapters/theo-cloud.ts:98`), and the OTLP serializer takes spans only. So the two counters that *are* emitted are dropped by the only exporting adapter — honest empty bodies, and a metric nobody receives |
| Semantic conventions | Attribute names are the framework's own — `method`, `path`, `status`, `agent`, `tool` — so a backend cannot build standard views automatically |
| **HITL pause spans do not measure the human wait** | The approval chunk and the tool result carry different ids for the same logical call, so the pause is never matched to its resume. Every `agent.hitl` span is closed by the sweep with `hitl.resume_observed: false` and an error status saying so (`packages/theo/src/server/agent/observe-agent-run.ts:169`). The span is emitted; the number in it is the run's duration, not a human's. Honest, and not yet the measurement |
| Sampling | No strategy, and therefore no errors-always rule |
| Exemplars | Not applicable until metrics are exported |
| Trace id in the user-visible error | `digestError` lives in `@theokit/http` and has no caller anywhere in this repository (`packages/http/src/error-digest.ts:57`); the HTTP error path emits `x-request-id` instead (`packages/theo/src/server/http/handle-request-error.ts:156`). So the digest and the trace id are unrelated **and the digest is not in use at all** — a smaller gap than it looked, and a differently shaped one |
| Client-side correlation | The browser's errors cannot be joined to the server's trace; the trace id is echoed in a response header (`packages/theo/src/cli/commands/start/request-handler.ts:237`) and never surfaced to page JavaScript |
| Redaction layer | No field-name-based backstop in the logger — a repository-wide search for a redaction module finds none |
| Runtime level control | Log level appears to be fixed at start. **Not measured:** whether any adapter or logger option can change it after boot |

**Corrected from 2026-08-19.** "Metrics" and "Trace id in the user-visible error" both moved: the
first from absent to *emitted and then dropped by the exporter*, the second from *two mechanisms
that do not know about each other* to *one mechanism with no caller*. Both corrections make the work
smaller, and both would have been missed by reading module names.

---

## Where this framework can be better

The field's frameworks emit almost nothing by default and leave instrumentation to the application,
which produces the universal outcome: telemetry added after the first incident, by whoever was on
call. Four positions are available here, and three of them are cheap because the plumbing now
actually runs.

### 1. The error digest *is* the trace id

The digest exists as a function and nothing calls it; the trace id exists and reaches every
response header. Making them the same value — or storing them together, at the point the digest
starts being used — closes the gap that `signals-and-joins.md` calls the highest-leverage item in
the discipline: a user reports a code, and the code finds the request.

No framework ships this. Because the digest has no callers yet, this is now a design decision taken
before adoption rather than a migration, which is the cheaper moment.

### 2. Framework-phase spans, by default and for free

The framework owns routing, middleware, rendering, caching and data access. Emitting a span per
phase — with the middleware attribution the middleware skill asks for and the cache status the
caching skill asks for — gives every application a trace that explains itself on day one, with no
instrumentation written.

Start with the page render, because it is the phase that currently has *no* span at all and is the
one users feel.

### 3. Standard attribute names from the start

Adopting the conventional attribute names now costs nothing and means every compliant backend
builds latency-by-route, error-rate-by-route and dependency views automatically. Renaming later
breaks every dashboard built on them — and the framework has just started emitting its first
attributes, so the window is open and will not stay open.

### 4. Cache and render telemetry nobody else emits

Two distributions that are invisible in every stack and available here because the framework owns
both layers:

* **Cache status per request** — hit, miss, stale, refresh — as both a span attribute and a metric.
  The caching skill's entire measurement section depends on this and most teams approximate it.
* **Which render path a route took** — buffered, streamed, or (once it exists) static shell — which
  turns the rendering skill's claims into a graph rather than an argument. The framework already
  branches on exactly this (`packages/theo/src/cli/commands/start/request-handler.ts:261`) and
  records nothing about which branch it took.

---

## The order

1. **Give the SSR page path a span.** It is the only request class with no telemetry at all, and it
   is the slowest one. Everything below assumes a request span exists; on this path it does not.
2. **Make the exporting adapter carry metrics.** Two counters are being emitted into empty function
   bodies today. Either export them over OTLP or say in the adapter's own header that it is
   spans-only — an empty body is honest, and a caller that cannot tell is not.
3. **Framework-phase spans**: routing, middleware (per stage), render, cache, data access. Uses the
   span and adapter machinery that now runs.
4. **Semantic conventions** for every attribute the framework emits. Do this in the same change as
   item 3, before anything depends on the current names.
5. **Fix the HITL pause id, or drop the pause span.** It currently reports a duration that is not
   the thing its name implies, and it says so in an attribute nobody will read
   (`packages/theo/src/server/agent/observe-agent-run.ts:169`). A span that has to explain why its
   own number is wrong is worse than no span.
6. **Decide what `digestError` is for.** It has no caller. Either wire it as the user-visible error
   code and make it the trace id, or delete it — a published function nobody calls is the exact
   shape of defect that made the previous version of this file wrong.
7. **A sampling strategy** with the errors-and-outliers rule enforced by the framework rather than
   left to configuration, and the rate adjustable without a deploy.
8. **A redaction layer** in the logger, keyed by field name, plus a test that greps emitted
   telemetry for configured secret values.
9. **Runtime log-level control**, per module.
10. **Client correlation**: surface the trace id to the browser so client errors join server traces.
    The header is already on every response; the page cannot read it.
11. **Exemplars**, once metrics actually export.

Items 1 to 4 are days of work against machinery that is now built *and running*, which is a
different sentence from the one this file carried in its previous version — then, the machinery was
built and unreachable, and the order recommended building on top of code that never executed.
