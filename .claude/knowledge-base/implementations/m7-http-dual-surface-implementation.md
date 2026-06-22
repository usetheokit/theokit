---
slug: m7-http-dual-surface
milestone_id: M7
date: 2026-06-22
plan: .claude/knowledge-base/plans/m7-http-dual-surface-plan.md
blueprint: .claude/knowledge-base/discoveries/blueprints/m7-http-dual-surface-blueprint.md
status: READY_TO_MERGE
review: .claude/knowledge-base/reviews/m7-http-dual-surface-review-2026-06-22.md
---

# M7 — HTTP dual-surface consolidation (theokit slice) — Implementation Summary

Gives the convention/filesystem-route server typed errors+404, health/ready
routes, and a public programmatic boot — all internal to the principal `theokit`
package, zero new runtime dependencies.

## Tasks delivered (TDD)

| Task | Gap | Commit | What shipped |
|---|---|---|---|
| T1.1 | M7-1 typed errors | `de77073` + `99c4085` (backward-compat fix) | Export `TheoError`/`fromUnknown`/`NotFoundError`/`serverErrorToEnvelope`/`envelopeCodeToStatus` from `theokit/server/http`; legacy `handleRequestError` routes typed errors through the envelope (NotFoundError→404), while untyped errors keep the legacy `INTERNAL_ERROR` 500 path (sendError masking preserved). |
| T2.1 | M7-2 health/ready | `f1d0cbf` | `defineHealthRoute`/`defineReadyRoute` + pure `serveReservedRoute` dispatcher (`theokit/server/define`); wired as the FIRST branch of `theokit start`'s `createRequestHandler` (reserved `/__theo/health`+`/__theo/ready` before user catch-all). |
| T3.1 | M7-3 boot | `27ca36f` | `theokit/boot` subpath: `createConventionFetchHandler({reservedRoutes?})` → socketless `{fetch,close}` composing M7-1+M7-2. tsup entry + package.json `./boot` export. |
| T4.1 | Integration | `97ccfd5` | Full-chain integration test through `theokit/boot` (health 200, ready 200/503 live probe, typed 404). |

## Wiring triad per primitive

| Primitive | (a) Caller / public surface | (b) Integration test | (c) Observability |
|---|---|---|---|
| typed-error exports | `theokit/server/http`; used by `handleRequestError` + `boot.ts` | `m7-typed-errors`, `m7-http-dual-surface` | `INTERNAL_ERROR` still console.error'd via sendError; typed codes in envelope |
| `handleRequestError` rewrite | the `theokit start` Node error path (`request-handler`) | `m7-typed-errors` + existing action/auth tests | error code + status on the wire |
| `defineHealthRoute`/`defineReadyRoute`/`serveReservedRoute` | `theokit/server/define`; FIRST branch of `createRequestHandler` | `m7-health-routes`, `m7-http-dual-surface` | 200/503 status carries readiness |
| `createConventionFetchHandler` | `theokit/boot` (public subpath) | `m7-boot`, `m7-http-dual-surface` | `{status}` body + typed 404 envelope |

## Validation gates

- **M7 tests:** 15 green (m7-typed-errors 4, m7-health-routes 6, m7-boot 4 — wait: typed 4 + health 6 + boot 4 + integration 1 = 15) across 4 files.
- **Full suite:** no M7-introduced failures. 26 pre-existing failures (docs/concepts presence, migration-guide, changeset-config, create-theo/dist absence) confirmed at baseline `201d954` — outside M7 scope.
- **Typecheck:** `tsc --noEmit` clean. **Lint:** eslint `--max-warnings=0` clean on M7 files.
- **Build:** tsup success — `dist/boot/index.{js,d.ts}` emitted; `publint` "All good!".
- **code-quality:** PASS for the M7 slice (zero findings in M7 files); raw runner FAIL_HARD is pre-existing references/-scoping noise (see audit `m7-http-dual-surface-code-quality-2026-06-22.md`).

## ADR adherence

- **D1** — typed-error primitives exported via `theokit/server/http` (core/contracts importable directly per architecture Invariant 3); legacy catch consolidated to the envelope translator, backward-compatible.
- **D2** — health/ready reserved on `/__theo/*` before the catch-all (nitro pattern).
- **D3** — `theokit/boot` exposes the fetch handler as the programmatic surface; `startDevServer`/`startCommand` stay in `cli` (architecture DAG: boot must NOT depend on cli — deviation from the plan's literal "re-export startDevServer", documented here; the fetch handler is the portable surface per blueprint Corner 4).

## Coverage Matrix: 4/4 (M7-1, M7-2, M7-3, integration) — 100%

Zero new runtime dependencies. Principal-project constraint preserved: no other package imports `theokit`.

## Scope note

M7 is a multi-repo milestone. This slice covers the **theokit** core (M7-1/2/3 — the
DoD: "a builder needn't choose between convention-without-health/typed-errors and
TheoApp-that-doesn't-serve-dev-routes"). The SDK slice (M7-4/5/6) and `@theokit/orm`
slice (M7-7) are tracked separately.
