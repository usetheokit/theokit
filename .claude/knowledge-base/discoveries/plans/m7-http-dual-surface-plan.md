# Discovery Plan: M7 — HTTP dual-surface consolidation (typed errors · health · programmatic boot)

> **Version 1.0** — Investigate how mature web frameworks (fastify, hono, nitro, next.js) implement (a) thrown-error → HTTP-status → serialized-envelope mapping with first-class 404, (b) a built-in health/ready endpoint on the convention server, and (c) a programmatic boot/listen surface — so theokit can give its convention/filesystem-route dev-server the typed-errors + health + programmatic-boot it lacks today, WITHOUT making any other package depend on the principal `theokit`. Output: a blueprint locking the M7-1/M7-2/M7-3 API shapes.

**Slug:** `m7-http-dual-surface`
**Owner:** paulo
**Created:** 2026-06-22
**Time budget:** 6h (fastify 2h, hono 1h, nitro 2h, next.js 1h)

## Context

theokit ships two parallel HTTP surfaces that share almost no primitives (gap-audit Tema F / M7): the convention/filesystem-route dev-server (`theokit dev` → `startDevServer`, `theokit start` → `startCommand`) and the imperative `@theokit/http` `TheoApp`. The convention server lacks: typed errors/404 in `defineRoute` (the typed primitives `TheoError`/`fromUnknown`/`serverErrorToEnvelope` exist in `src/core/contracts/` but are NOT publicly exported, and the legacy Node catch path `src/server/http/handle-request-error.ts:35` emits a generic 500), a health endpoint (`/__theo/health` exists only on `TheoApp`; the poller `src/services/runtime/healthcheck-poller.ts:16` targets sidecars), and a public programmatic boot (`startDevServer`/`startCommand` are CLI-internal — no `theokit/boot` subpath). This discovery investigates prior art before locking the M7 API. Must respect `.claude/rules/architecture.md` (module boundaries; the principal `theokit` is never a dependency of other packages) and `.claude/rules/testing.md` (test pyramid; prefer in-process HTTP boundary tests).

## Objective

Decide the exact API shape for M7-1 (typed-error export + `defineRoute` 404 ergonomics + legacy-catch envelope wiring), M7-2 (`defineHealthRoute`/`defineReadyRoute`), and M7-3 (`theokit/boot`), grounded in how fastify/hono/nitro/next solve the same problems.

- [ ] All research questions answered with citations to `.claude/knowledge-base/references/`
- [ ] Cross-cutting comparison table populated for fastify, hono, nitro, next.js
- [ ] Recommendations section provides ≥ 1 concrete decision proposal per research question (mapped to M7-1/2/3)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/fastify/` | `lib/` (`error-handler.js`, `error-serializer.js`, `errors.js`, `error-status.js`, `reply.js`, `hooks.js`), `test/inject.test.js` | Mature error→status→serialize pipeline + in-process `inject` testing |
| `.claude/knowledge-base/references/hono/` | `src/` (`http-exception.ts`, `http-exception.test.ts`) | Minimal typed-exception → Response model + `app.fetch` programmatic surface |
| `.claude/knowledge-base/references/nitro/` | `src/runtime/virtual/error-handler.ts`, `src/dev/server.ts`, `src/cli/commands/dev.ts` | Convention/filesystem server with built-in error handling + programmatic dev listen |
| `.claude/knowledge-base/references/next.js/` | `packages/next/src/server/route-modules/` (`route-module.ts`, `app-route/`) | Route-handler error boundary in a filesystem-route framework |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/astro/`, `.claude/knowledge-base/references/workers-sdk/` | Lower-signal for these 3 patterns than fastify/hono/nitro/next; defer (ADR D2) |
| `.claude/knowledge-base/references/*/{dist,build,node_modules}/` | Build artifacts |
| `.claude/knowledge-base/references/*/docs/`, `*/website/` | Marketing/docs, not source of truth |
| `@theokit/http` `TheoApp` internals | Surface B already has health/typed-errors; M7 is about the convention server (Surface A) — not re-deriving B |

## ADRs

### D1 — Time-box per project (fastify 2h, nitro 2h, hono 1h, next 1h)
**Decision:** fastify + nitro get the deepest dig (they own the error-pipeline + convention-server-boot patterns); hono + next are corroborating. **Rationale:** matches signal density; respects the 6h budget. **Alternative rejected:** equal time → would under-investigate fastify's serializer.

### D2 — Defer astro + workers-sdk
**Decision:** exclude astro/workers-sdk from this discovery. **Rationale:** the 4 chosen refs already cover all 4 corners for the 3 patterns; adding 2 more breaks the question budget. **Alternative rejected:** include all 6 → > 10 questions, halt-loop exhaustion.

### D3 — Techniques corner gets the 3-question max
**Decision:** the 3 M7 sub-features (typed-error, health, boot) are each a "technique" question; deps/tools/tests get 1 each. **Rationale:** M7 is API-shape discovery; the technique mapping is the deliverable. **Alternative rejected:** spread across corners → would dilute the API-shape focus.

## Research Questions

| # | Question | Corner | Method | Expected answer shape |
|---|---|---|---|---|
| Q1 | How does a thrown error become an HTTP status + serialized body — what is the status-mapping + serializer contract, and how is 404/not-found represented? | techniques | Read `fastify/lib/error-handler.js`, `fastify/lib/error-serializer.js`, `fastify/lib/error-status.js`; Read `hono/src/http-exception.ts`; Read `nitro/src/runtime/virtual/error-handler.ts` | Table: per-ref {error class to status field to serialize fn to 404 path}; informs M7-1 `serverErrorToEnvelope` wiring + `defineRoute` 404 ergonomics |
| Q2 | Does the convention/filesystem server expose a built-in health/ready endpoint, and how is it registered (special route vs middleware vs reserved path)? | techniques | Grep `health\|/_nitro\|ready` in `nitro/src/`; Read `nitro/src/dev/server.ts`; Read `next.js/packages/next/src/server/route-modules/route-module.ts` | Per-ref health-endpoint registration mechanism; informs M7-2 `defineHealthRoute`/`defineReadyRoute` shape |
| Q3 | What is the programmatic boot/listen surface (function signature returning a server handle) vs the CLI entry, and how do they share one code path? | techniques | Read `nitro/src/dev/server.ts` + `nitro/src/cli/commands/dev.ts`; Grep `app.fetch\|export.*serve` in `hono/src/`; Read `fastify/lib/server.js` (listen) | Per-ref {programmatic fn returns handle, CLI wraps it}; informs M7-3 `theokit/boot` shape |
| Q4 | What runtime dependencies back the error-serialization path — is a third-party lib pulled, or is it stdlib/in-house? | deps | Read `fastify/package.json` deps + the `require`s at top of `fastify/lib/error-serializer.js`; Read `hono/package.json` | Dep list for the serialize path; confirms M7 can ship zero-new-deps in theokit |
| Q5 | How is the HTTP boundary tested in-process (no real socket) — what is the inject/request API? | tools | Read `fastify/test/inject.test.js`; Read `hono/src/http-exception.test.ts` (how it constructs requests) | The in-process request API (`app.inject` / `app.request`); informs M7-3 boot testability + M7 integration tests |
| Q6 | How do the refs test that a thrown typed error yields the right status + envelope (the M7-1 contract test)? | tests | Grep `error-handler\|http-exception` in `fastify/test/` and `hono/src/http-exception.test.ts`; Read the assertion shape | The assert pattern (throw to status + body); informs M7-1/M7-2 test design |

## Coverage Matrix

| Corner | Question(s) | Covered? |
|---|---|---|
| Techniques | Q1, Q2, Q3 | ✅ (3/3 max) |
| Dependencies | Q4 | ✅ |
| Tools | Q5 | ✅ |
| Integration tests | Q6 | ✅ |

100% — all four corners populated; 6 questions (within 5-10). No deferred corner.

## Halt-loop checkpoints (for /discover-execute)

- Before marking Q1 DONE: the status-mapping + serializer contract is cited with file:line for ≥ 2 refs.
- Before marking Q2/Q3 DONE: at least nitro (the convention-server ref) is read for both health + boot; a second ref corroborates.
- Before any question DONE: every cited path resolves via Read (no fabricated citation).
- Before BLUEPRINT_COMPLETE: all 4 coverage corners populated, ≥ 1 ADR, Cross-cutting Comparison table filled for all 4 refs, Recommendations maps each Q → an M7-1/2/3 decision.

## Acceptance Criteria

- Every Q answered with ≥ 1 `.claude/knowledge-base/references/` citation that resolves.
- Cross-cutting Comparison table has a row per ref (fastify/hono/nitro/next).
- Recommendations proposes the concrete M7-1/M7-2/M7-3 API shapes (export list, `defineHealthRoute`/`defineReadyRoute` signatures, `theokit/boot` signature) + the zero-new-deps confirmation.
- `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS.

## Global Definition of Done

Per `.claude/rules/cycle-discover.md` + `.claude/rules/discover-blueprint-golden-rule.md`: 4 corners non-empty, no fabricated citations, ADRs present, verdict ≥ SHIPPABLE_WITH_CAVEATS. Downstream: feeds `/to-plan m7-http-dual-surface`.
