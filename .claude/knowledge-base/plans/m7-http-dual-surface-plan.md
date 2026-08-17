---
slug: m7-http-dual-surface
milestone_id: M7
created_at: 2026-06-22
goal: Give theokit's convention/filesystem-route server typed errors+404, health/ready routes, and a public programmatic boot so the M7 integration suite passes green with zero new runtime deps.
---

# Plan: M7 — HTTP dual-surface consolidation (Tema F)

> **Version 1.0** — Promote theokit's already-internal typed-error primitives to a public surface + route the legacy Node catch through them (M7-1); add `defineHealthRoute`/`defineReadyRoute` registered before the catch-all on the convention server (M7-2); promote `startDevServer`/`startCommand` to a public `theokit/boot` subpath returning a `{fetch,listen,close}` handle (M7-3). Grounded in `knowledge-base/discoveries/blueprints/m7-http-dual-surface-blueprint.md` (SHIPPABLE 99.2). All changes are internal to the `theokit` package — nothing makes another package depend on the principal `theokit` (per `rules/architecture.md`).

## Goal

Make the M7 integration suite (`packages/theo/tests/server/m7-http-dual-surface.test.ts`) pass green: a typed error thrown from a convention route yields the correct status + envelope on BOTH the legacy Node path and the web path, `/__theo/health` returns 200 `{status:"ok"}`, `/__theo/ready` returns 200/503 from a probe, and a programmatic `startDevServer`-booted server answers an in-process `fetch` — with zero new runtime dependencies.

## Context

theokit ships two HTTP surfaces sharing no primitives (gap-audit Tema F). The convention server (`theokit dev`/`theokit start`) lacks typed errors/404, a health endpoint, and a public boot; the imperative `@theokit/http` `TheoApp` already has them. The typed-error primitives `TheoError` (`src/core/contracts/theo-error.ts:38`), `fromUnknown` (`theo-error.ts` factory), `serverErrorToEnvelope` (`src/core/contracts/server-error-to-envelope.ts`), `envelopeCodeToStatus` (`src/core/contracts/envelope-code-to-status.ts:17` — `NOT_FOUND: 404`) exist but are NOT publicly exported; the legacy Node catch `src/server/http/handle-request-error.ts:35` emits a generic `INTERNAL_ERROR` 500 (`:63-67`) while its sibling `handleWebRequestError` (`:90+`) already uses `serverErrorToEnvelope`. The blueprint locked the API shapes from fastify/hono/nitro/next.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC | Last commit | Why it exists | Invariant to preserve |
|---|---|---|---|---|
| `src/core/contracts/theo-error.ts` | 154 | `efe63ed` 2026-06-11 | `TheoError` + `fromUnknown` | classes/codes unchanged; only re-exported |
| `src/core/contracts/server-error-to-envelope.ts` | 127 | `efe63ed` | error→envelope translator | behavior unchanged; re-exported |
| `src/core/contracts/envelope-code-to-status.ts` | 43 | `744a87e` 2026-06-12 | code→status map (`NOT_FOUND:404`) | unchanged; re-exported |
| `src/server/http/index.ts` | 9 | `9d29df8` 2026-05-28 | http sub-barrel (public `theokit/server/http`) | existing exports unchanged; ADD typed-error re-exports |
| `src/server/http/handle-request-error.ts` | 155 | `744a87e` | legacy + web error catches | `handleWebRequestError` unchanged; rewrite `handleRequestError` to mirror it |
| `src/server/define/index.ts` | 8 | `9d29df8` | define sub-barrel (public `theokit/server/define`) | existing exports unchanged; ADD health-route exports |
| `src/server/define/define-route.ts` | 24 | `9d29df8` | `defineRoute` identity fn | signature stays generic; 404 ergonomics additive |
| `src/server/define/health-route.ts` (NEW) | 0 | — | `defineHealthRoute`/`defineReadyRoute` | — |
| `src/cli/commands/start/start-handlers.ts` | n/a | — | branch handlers (action/route/static/404) | reserved health check added BEFORE 404 branch |
| `src/cli/commands/start/request-handler.ts` | n/a | — | `createRequestHandler` | reserved-route dispatch additive |
| `src/cli/commands/dev.ts` | 118 | `17430c1` 2026-06-19 | `startDevServer` | signature returns a handle (additive fields) |
| `src/cli/commands/start/index.ts` | 133 | `744a87e` | `startCommand` | promoted; behavior preserved |
| `src/boot/index.ts` (NEW) | 0 | — | public `theokit/boot` barrel | — |
| `package.json` | n/a | — | exports map (22 subpaths) | existing entries unchanged; ADD `./boot` |
| `packages/theo/tests/server/*.test.ts` (NEW) | 0 | — | M7 unit + integration tests | — |

Baseline sha: `68766fd`. Test convention: per-package `packages/theo/tests/{domain}/*.test.ts` (e.g. `tests/observability/*.test.ts`), Vitest (`vitest run`).

### Current callers / dependents

- **`handleRequestError`** (`src/server/http/handle-request-error.ts:35`) — called by the legacy Node request path (`theokit start` → `request-handler.ts`). Rewriting its body (not signature) is internal; the web path (`handleWebRequestError`) is the reference shape already shipped.
- **`TheoError`/`serverErrorToEnvelope`/`envelopeCodeToStatus`** — currently consumed only inside `src/core/contracts/` + `handleWebRequestError`. Re-exporting is purely additive (new public surface).
- **`startDevServer`** (`src/cli/commands/dev.ts:15`) / **`startCommand`** (`src/cli/commands/start/index.ts:44`) — called by the CLI dispatcher (`cli/index.ts`). Promotion keeps the CLI calling the same fns.
- Cross-repo: the convention HTTP surface is consumed by app authors via `theokit/server/*`; new exports are additive (backward-compatible). No other package imports `theokit` (verified — principal-project constraint holds).

### Domain glossary

- **convention server** — the filesystem-route dev/start server (`theokit dev`/`theokit start`), Surface A.
- **envelope** — the `{statusCode, code, error, message}` JSON error body produced by `serverErrorToEnvelope`.
- **legacy Node path** — `handleRequestError` over `node:http` `IncomingMessage`/`ServerResponse`.
- **web path** — `handleWebRequestError` over Web `Request`/`Response` (already typed).
- **reserved route** — a `/__theo/*` path registered before the user-route catch-all + 404 branch.

### Architecture boundaries affected

- `rules/architecture.md` — public surface grows only via additive subpath exports (`theokit/server/http`, `theokit/server/define`, new `theokit/boot`); the principal `theokit` remains a non-dependency of other packages. No inner→outer import added.

## Prior Art & Related Work

- **Internal blueprint** — `knowledge-base/discoveries/blueprints/m7-http-dual-surface-blueprint.md` (SHIPPABLE 99.2): error-on-throw + sub-400→500 floor + fixed envelope (fastify `error-status.js:7-12`, `error-serializer.js:56-124`); reserved-namespace health before catch-all (nitro `dev/app.ts:63,90`); programmatic boot returns a handle + CLI thin wrapper (nitro `dev/server.ts:135-146`); zero-dep typed-error + Web Response (hono `package.json:667`); in-process `app.request` test shape (hono `hono-base.ts:499-517`).
- **In-repo reference** — `handleWebRequestError` (`src/server/http/handle-request-error.ts:90+`) is the already-shipped typed path the legacy path will mirror.

## ADRs

### D1 — Export typed-error primitives via the existing `theokit/server/http` barrel (no new dep, no new subpath for errors)
**Decision:** re-export `TheoError`, `fromUnknown`, `serverErrorToEnvelope`, `envelopeCodeToStatus`, and a new `NotFoundError` (a `TheoError` with code `NOT_FOUND`) from `theokit/server/http`; rewrite the legacy `handleRequestError` to mirror `handleWebRequestError` (envelope + `envelopeCodeToStatus`, sub-400→500 floor). **Rationale:** `rules/architecture.md` minimal-surface — errors are an HTTP concern; the `http` barrel already exists. Blueprint D1. KISS: reuse the in-house translator (zero new deps). **Alternatives rejected:** a brand-new `theokit/errors` subpath (more surface than needed); hono-style bare-message body (no stable `code`, weak 404).

### D2 — `defineHealthRoute`/`defineReadyRoute` as reserved `/__theo/*` routes registered before the catch-all
**Decision:** ship `defineHealthRoute`/`defineReadyRoute` in `src/server/define/`; the start/dev request handler checks the reserved `/__theo/health` + `/__theo/ready` paths BEFORE the user-route match + 404 branch. Liveness = always-200 `{status:"ok"}`; readiness = 200/503 from a probe. **Rationale:** blueprint D2 (nitro reserved-namespace + readiness-as-state-503). Separating liveness from readiness is the documented best practice. **Alternatives rejected:** single `/health` (conflates liveness/readiness); user-path magic route (collides with user routes).

### D3 — `theokit/boot` returns a `{fetch,listen,close}` handle; CLI is a thin wrapper
**Decision:** new `theokit/boot` subpath re-exporting `startDevServer`/`startCommand` returning a handle exposing `fetch` (socketless), `listen` (network), `close`; the CLI keeps calling the same fns. **Rationale:** blueprint D3 (nitro `createDevServer().listen():Server` + CLI wrapper; one code path). Enables in-process M7 tests with no socket (hono `app.request` shape) → zero test dep. **Alternatives rejected:** void boot (no programmatic close/embed); `light-my-request` inject (adds a dep).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Rewriting the legacy `handleRequestError` could change error responses for existing `theokit start` apps | Medium | Mirror the already-shipped `handleWebRequestError` exactly; regression test asserts the new envelope for a plain `Error` (still 500) AND a `TheoError` (typed status) | theokit |
| Reserved `/__theo/*` could collide with a user route named `__theo` | Low | Document the reserved namespace; the check runs before user match so theokit wins; a user `/__theo/*` is shadowed by design (matches nitro `/_nitro`) | theokit |
| Returning a handle from `startDevServer` changes its return type | Low | Additive — extend the returned object with `fetch`/`close`; existing callers ignoring the return are unaffected | theokit |

## Unresolved Questions

- Q1 — Should `defineReadyRoute`'s probe be sync or async? (Plan resolves: async `() => Promise<boolean>` — readiness probes hit dependencies; a sync escape is allowed by accepting `boolean | Promise<boolean>`.)
- Q2 — (none further — D1-D3 resolve the rest at plan time.)

## Failure scenarios

The convention server is an HTTP boundary. Per task:
- **M7-1:** a handler throws an arbitrary (non-`TheoError`) value → `fromUnknown` coerces → 500 envelope (no crash, no stack in body). Test reproduces by throwing a string + a plain `Error`.
- **M7-2:** `defineReadyRoute` probe rejects/throws → 503 (not a 500 crash). Test reproduces with a throwing probe.
- **M7-3:** `startDevServer` `listen` on an in-use port → rejects with a typed error, `close` is idempotent. Test reproduces by double-`close`.

## Dependency Graph

```
Phase 1 (M7-1 typed errors) ─┐
Phase 2 (M7-2 health routes) ─┼─▶ Phase 4 (Integration Validation)
Phase 3 (M7-3 theokit/boot) ──┘
```
Phases 1/2/3 are independent (different files); Phase 4 wires them in one integration test. Phase 3's `fetch` handle makes Phases 1+2 testable in-process.

## Dependencies

### Existing — use as-is
| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `node:http` | builtin | node | `STATUS_CODES` for status text (blueprint Corner 2) |
| (internal) `serverErrorToEnvelope`/`envelopeCodeToStatus` | n/a | n/a | error→envelope→status (already in-house) |

### New — to be introduced
| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | M7 adds ZERO new runtime deps — typed-error + Web Response + stdlib only (blueprint Corner 2 verdict) | — |

## Phase 1: M7-1 — Typed errors + 404 in the convention server

### T1.1 — Export typed-error primitives + route the legacy catch through the envelope

#### Objective
Publicly export `TheoError`/`fromUnknown`/`serverErrorToEnvelope`/`envelopeCodeToStatus`/`NotFoundError` from `theokit/server/http`, and rewrite `handleRequestError` (legacy Node path) to produce the typed envelope + status (mirroring `handleWebRequestError`), with a sub-400→500 floor.

#### Why this step (action + reasoning)
1. **What** — add re-exports to `src/server/http/index.ts`; add `NotFoundError` (a `TheoError` with code `NOT_FOUND`); rewrite `handleRequestError`'s body to call `serverErrorToEnvelope(fromUnknown(err))` + `envelopeCodeToStatus` + floor.
2. **Why now** — M7-1 is the highest-severity M7 gap; the primitives already exist and `handleWebRequestError` is the proven shape (ADR D1; blueprint Corner 4 error pipeline).

#### Evidence
`src/server/http/handle-request-error.ts:35` (legacy generic 500 at `:63-67`), `:90+` (`handleWebRequestError` typed reference). `src/core/contracts/envelope-code-to-status.ts:17` (`NOT_FOUND:404`). `knowledge-base/discoveries/blueprints/m7-http-dual-surface-blueprint.md` ADR D1.

#### Files to edit
```
src/server/http/index.ts — re-export TheoError/fromUnknown/serverErrorToEnvelope/envelopeCodeToStatus/NotFoundError
src/core/contracts/theo-error.ts — add NotFoundError (TheoError subclass/factory, code NOT_FOUND)
src/server/http/handle-request-error.ts — rewrite handleRequestError to mirror handleWebRequestError
packages/theo/tests/server/m7-typed-errors.test.ts — RED tests first
```

#### Deep file dependency analysis
- `handle-request-error.ts` — `handleWebRequestError` unchanged (the reference); only `handleRequestError`'s body changes. Callers (request-handler) pass the same ctx.
- `http/index.ts` (9 LoC) — additive re-exports; existing exports preserved.
- `theo-error.ts` (154 LoC) — `NotFoundError` is additive; `TheoError`/`fromUnknown` unchanged.

#### Deep Dives
- `NotFoundError`: `new TheoError('NOT_FOUND', message)` or a thin subclass; `serverErrorToEnvelope` maps it → `{code:'NOT_FOUND'}` → `envelopeCodeToStatus` → 404.
- `handleRequestError` rewrite: `const env = serverErrorToEnvelope(fromUnknown(err)); const status = Math.max(envelopeCodeToStatus(env.code), 400 if <400 else as-is); sendError/send JSON env with status`.

#### TDD
```
RED: handleRequestError_emits_typed_envelope_for_TheoError() — throw TheoError(code X) -> status=envelopeCodeToStatus(X), body={statusCode,code,error,message}
RED: handleRequestError_floors_sub_400_to_500() — a TheoError mapping <400 -> 500
RED: handleRequestError_coerces_unknown_to_500() — throw "string"/plain Error -> 500 envelope, no stack in body
RED: NotFoundError_maps_to_404() — serverErrorToEnvelope(new NotFoundError()) -> status 404, code NOT_FOUND
RED: http_barrel_reexports_typed_error_primitives() — import { TheoError, serverErrorToEnvelope, NotFoundError } from theokit/server/http resolves
GREEN: implement re-exports + NotFoundError + handleRequestError rewrite
REFACTOR: factor the shared envelope+status logic so legacy + web paths don't drift
VERIFY: pnpm --filter theokit test -- m7-typed-errors
```

#### Concurrency tests
(none — single-threaded request handling per call; no shared mutable state introduced)

#### Acceptance Criteria
- [ ] All 5 RED tests pass.
- [ ] Legacy + web error paths produce the SAME envelope shape for the same error.
- [ ] No stack in the wire body (only in logs).
- [ ] Lint clean; files ≤ 500 LoC.

#### DoD
- [ ] `pnpm --filter theokit test -- m7-typed-errors` green; typecheck clean; CHANGELOG `[Unreleased]` updated.

## Phase 2: M7-2 — Health/ready routes on the convention server

### T2.1 — `defineHealthRoute`/`defineReadyRoute` registered before the catch-all

#### Objective
Ship `defineHealthRoute`/`defineReadyRoute` and register `/__theo/health` (always 200 `{status:"ok"}`) + `/__theo/ready` (200/503 from a probe) in the start/dev request handler before the user-route match + 404 branch.

#### Why this step (action + reasoning)
1. **What** — new `src/server/define/health-route.ts` exporting `defineHealthRoute`/`defineReadyRoute`; export from the define barrel; add a reserved-path dispatch in `start/request-handler.ts` (+ dev path) before the 404 branch in `start/start-handlers.ts`.
2. **Why now** — M7-2 closes the "convention server has no health" half of the DoD (ADR D2; blueprint Corner 4 health).

#### Evidence
`src/cli/commands/start/index.ts` (uses `start-handlers.ts` "branch handlers action/route/static/404", `start/index.ts:6-8`). `knowledge-base/discoveries/blueprints/m7-http-dual-surface-blueprint.md` ADR D2 (nitro reserved-namespace `dev/app.ts:63,90`).

#### Files to edit
```
src/server/define/health-route.ts — NEW: defineHealthRoute/defineReadyRoute
src/server/define/index.ts — export the two
src/cli/commands/start/request-handler.ts — reserved /__theo/* dispatch before user match
src/cli/commands/start/start-handlers.ts — health/ready branch before 404 branch
packages/theo/tests/server/m7-health-routes.test.ts — RED tests first
```

#### Deep file dependency analysis
- `start-handlers.ts` — adds a reserved-route branch ahead of the existing 404 branch; existing action/route/static branches untouched.
- `define/index.ts` (8 LoC) — additive exports.

#### Deep Dives
- `defineHealthRoute(handler?)` → config consumed by the reserved dispatch; default handler → `{status:"ok"}` 200.
- `defineReadyRoute(probe: () => boolean | Promise<boolean>)` → 200 `{status:"ready"}` when probe truthy, else 503 `{status:"not-ready"}`; a throwing probe → 503 (not 500).

#### TDD
```
RED: health_route_returns_200_ok() — GET /__theo/health -> 200 {status:"ok"}
RED: ready_route_returns_200_when_probe_true() — probe()=>true -> 200 {status:"ready"}
RED: ready_route_returns_503_when_probe_false() — probe()=>false -> 503 {status:"not-ready"}
RED: ready_route_returns_503_when_probe_throws() — probe throws -> 503 (no 500 crash)
RED: reserved_route_takes_precedence_over_user_404() — /__theo/health resolves even with no user route (not 404)
GREEN: implement health-route.ts + reserved dispatch
REFACTOR: extract the reserved-path table if >2 entries
VERIFY: pnpm --filter theokit test -- m7-health-routes
```

#### Concurrency tests
(none — stateless route handlers; probe is caller-supplied)

#### Acceptance Criteria
- [ ] All 5 RED tests pass.
- [ ] Reserved routes resolve before the user catch-all + 404.
- [ ] Liveness and readiness are separate routes.
- [ ] Lint clean; files ≤ 500 LoC.

#### DoD
- [ ] `pnpm --filter theokit test -- m7-health-routes` green; typecheck clean; CHANGELOG updated.

## Phase 3: M7-3 — `theokit/boot` programmatic boot

### T3.1 — Promote `startDevServer`/`startCommand` to a public `theokit/boot` returning a handle

#### Objective
Add a `theokit/boot` subpath exporting `startDevServer`/`startCommand` that return a `{ fetch, listen, close }` handle; keep the CLI calling the same fns.

#### Why this step (action + reasoning)
1. **What** — new `src/boot/index.ts` re-exporting the (promoted) `startDevServer`/`startCommand`; extend their return with `{fetch, close}`; add `./boot` to `package.json` exports + the build entry.
2. **Why now** — M7-3 closes the "no programmatic boot" half + makes M7-1/M7-2 testable in-process (ADR D3; blueprint Corner 4 boot).

#### Evidence
`src/cli/commands/dev.ts:15` (`startDevServer`), `src/cli/commands/start/index.ts:44` (`startCommand`) — CLI-internal today. `package.json` exports (22 subpaths, no `./boot`). `knowledge-base/discoveries/blueprints/m7-http-dual-surface-blueprint.md` ADR D3.

#### Files to edit
```
src/boot/index.ts — NEW: public barrel re-exporting startDevServer/startCommand
src/cli/commands/dev.ts — return a handle {fetch, listen?, close}
src/cli/commands/start/index.ts — return a handle; CLI still calls it
package.json — add "./boot" to exports (+ build entry)
packages/theo/tests/server/m7-boot.test.ts — RED tests first
```

#### Deep file dependency analysis
- `dev.ts`/`start/index.ts` — return type extended (additive); CLI dispatcher ignores the extra fields → unaffected.
- `package.json` — additive `./boot` export; existing entries unchanged. Build config must emit `dist/boot/index.js`.

#### Deep Dives
- Handle: `{ fetch(req: Request): Promise<Response>; listen(opts?): Promise<{close}>; close(): Promise<void> }`. `fetch` reuses the same request handler the listener serves (one code path, blueprint Corner 4).
- `close` idempotent (double-close safe).

#### TDD
```
RED: boot_subpath_exports_startDevServer() — import { startDevServer } from theokit/boot resolves
RED: booted_server_answers_in_process_fetch() — startDevServer().fetch(new Request('/__theo/health')) -> 200 {status:"ok"} (no socket)
RED: close_is_idempotent() — close() twice does not throw
GREEN: implement boot barrel + handle + package.json export
REFACTOR: share the fetch handler between fetch() and listen()
VERIFY: pnpm --filter theokit test -- m7-boot
```

#### Concurrency tests
(none — boot/close are sequential lifecycle calls in tests)

#### Acceptance Criteria
- [ ] All 3 RED tests pass.
- [ ] `theokit/boot` importable; `fetch` works socketless.
- [ ] CLI still boots via the same fns (no behavior change).
- [ ] Lint clean; files ≤ 500 LoC.

#### DoD
- [ ] `pnpm --filter theokit test -- m7-boot` green; typecheck clean; `package.json` `./boot` resolves via publint; CHANGELOG updated.

## Phase 4: Integration Validation

### T4.1 — Full M7 chain integration test

#### Objective
One integration test boots the convention server via `theokit/boot`, fires in-process `fetch`, and asserts: a typed-error route → envelope+status; `/__theo/health` → 200; `/__theo/ready` → 200/503; an unknown route → 404 envelope.

#### Files to edit
```
packages/theo/tests/server/m7-http-dual-surface.test.ts — NEW integration test
```

#### TDD
```
RED→GREEN: boot -> fetch('/__theo/health')=200; fetch(typed-error route)=mapped status+envelope; fetch(unknown)=404 envelope; fetch('/__theo/ready', probe-false)=503
VERIFY: pnpm --filter theokit test -- m7-http-dual-surface && pnpm --filter theokit typecheck && pnpm --filter theokit lint
```

#### Concurrency tests
(none — single in-process server per test)

#### Acceptance Criteria
- [ ] Integration test green; typecheck + lint clean; coverage ≥ 90% on changed files.
- [ ] Zero new runtime deps (`package.json` dependencies unchanged).

#### DoD
- [ ] Full chain green; CHANGELOG `[Unreleased]` has the M7 entry; `/code-quality` ∉ {FAIL_HARD, INVALID}.

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | M7-1 typed errors/404 in convention server | T1.1 | export primitives + `NotFoundError` + legacy catch → envelope |
| 2 | M7-2 health/ready routes | T2.1 | `defineHealthRoute`/`defineReadyRoute` reserved before catch-all |
| 3 | M7-3 programmatic boot | T3.1 | `theokit/boot` returns `{fetch,listen,close}` |
| 4 | Integration (DoD) | T4.1 | full chain in-process |

**Coverage: 4/4 (100%)**

## Global Definition of Done

- All task DoDs met; M7 integration suite green.
- `pnpm --filter theokit test` + `typecheck` + `lint` clean; coverage gate ≥ 90% on changed files.
- Zero new runtime dependencies (`rules/architecture.md` + blueprint Corner 2).
- CHANGELOG `[Unreleased]` updated; `/code-quality` ∉ {FAIL_HARD, INVALID}; `/review` READY_TO_MERGE.
- Principal-project constraint preserved: no other package imports `theokit`.
