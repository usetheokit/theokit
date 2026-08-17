---
slug: routes-framework-contract
created_at: 2026-06-26
goal: Add response-schema validation + agent-endpoint params to the RouteConfig contract so consumers stop hand-rolling output validation and URL parsing.
---

# Plan: Routes framework contract — response schema slot + agent-endpoint params

> **Version 1.0** — Extend the `theokit` route contract with two backward-compatible authoring affordances that consumers (TheoCode is the reference app) currently work around by hand: (1) a `response?` Zod slot on `RouteConfig` that BOTH runtimes validate before serializing a plain-object handler return, and (2) a `params?` Zod slot on `defineAgentEndpoint` so streaming endpoints get typed, validated path params instead of re-parsing `request.url`. A latent status-code asymmetry between the Node and Web runtimes is fixed in the same return-handling path. All three changes are additive — existing routes with no `response`/`params` are byte-for-byte unaffected.

## Goal

> "Enable `theokit` route authors to declare a `response` Zod schema and `defineAgentEndpoint` path-param schema so that the runtime validates output and threads typed params, measured by `pnpm test` passing the new `tests/unit/route-config-response-validation.test.ts` + `tests/unit/define-agent-endpoint-params.test.ts` + `tests/unit/web-handler-status-symmetry.test.ts` suites green."

## Context

TheoCode (the framework's reference application) is being aligned to use the maximum of the `theokit` framework; an alignment audit (theocode `reviews/theokit-alignment-audit-2026-06-26.md`) surfaced three route-layer gaps where the app reimplements what the framework must own:

1. **Output validation is hand-rolled.** `RouteConfig` (`packages/theo/src/core/contracts/route-config.ts:18-45`) validates `query`/`body`/`params` via Zod but has no `response` slot. 4 TheoCode routes call `xResponse.parse(...)` in their handlers — output-contract logic that belongs in the runtime.
2. **`defineAgentEndpoint` cannot type/validate path params.** It returns `RouteConfig<z.ZodUndefined, z.ZodUndefined, z.ZodUndefined, …>` (`packages/theo/src/server/define/define-agent-endpoint.ts:120-135`); the runtime passes `params` to the wrapper at runtime (`:132`) but the public type `AgentEndpointHandlerArgs.params` is declared `undefined` (`:29-32`) — a type lie. A consuming streaming route must re-parse `request.url` to read `:id`.
3. **Status asymmetry (latent bug).** The Node runner honors `config.status` for plain-object returns (`packages/theo/src/server/http/execute.ts:290`), but the Web runner hardcodes `200` in `toResponse` (`packages/theo/src/server/web-handler.ts:246-257`). Adding `response` validation makes this divergence consumer-visible (a `status: 201` plain-object route would 200 under the Web runtime).

This plan closes all three on the framework side so the reference app can drop the workarounds (TheoCode adoption is tracked in a sibling plan).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/theo/src/core/contracts/route-config.ts` | 45 | `9d29df8` (2026-05-28) | Canonical `RouteConfig<TQuery,TBody,TParams,TCtx,TResponse>` contract (per ADR-0001) | Existing 5 generic params + `query`/`body`/`params`/`status`/`csrf`/`handler` fields stay; default type params unchanged so existing call-sites infer identically |
| `packages/theo/src/server/http/execute.ts` | 334 | `744a87e` (2026-06-12) | Node/`IncomingMessage` route runner — validates input, calls handler, serializes result (`sendJson`/Response passthrough) | Response-instance passthrough (`:271-287`) and `undefined→204` (`:253-256`) unchanged; input Zod validation (`runZodValidation`) unchanged |
| `packages/theo/src/server/web-handler.ts` | 639 | `17430c1` (2026-06-19) | Web-standards (`Request`/`Response`) route runner — `runHandler` + `toResponse` | `Response` passthrough + `undefined→204` in `toResponse` unchanged; `validationErrorResponse` 400 shape unchanged |
| `packages/theo/src/server/define/define-agent-endpoint.ts` | 219 | `9d29df8` (2026-05-28) | Wraps an `AsyncGenerator` handler into an SSE `RouteConfig`; manages cookies + abort signal | SSE encoding (`encodeSSE` `:75-77`), prime-error handling (`:149-186`), AbortSignal cancellation (`:163-171`) ALL unchanged; only params typing/threading added |
| `tests/unit/route-config-response-validation.test.ts` (NEW) | 0 | — | (file to be created) | — |
| `tests/unit/define-agent-endpoint-params.test.ts` (NEW) | 0 | — | (file to be created) | — |
| `tests/unit/web-handler-status-symmetry.test.ts` (NEW) | 0 | — | (file to be created) | — |
| `.changeset/routes-framework-contract.md` (NEW) | 0 | — | (changeset for the minor release) | — |

### Current callers / dependents

- **Symbol:** `RouteConfig` (type) in `packages/theo/src/core/contracts/route-config.ts`
  - **Callers (production):** `src/server/define/define-route.ts`, `src/server/define/define-agent-endpoint.ts`, `src/server/define/health-route.ts`, `src/server/web-handler.ts`, `src/router/generate.ts`, `src/vite-plugin/openapi-emit/load-routes.ts`, `src/cache/define-cached-route.ts`, `src/cache/index.ts`, `src/core/contracts/index.ts` (re-export)
  - **Callers (tests):** `tests/unit/define-route.test.ts`, `tests/unit/define-agent-endpoint.test.ts`
  - **External (public API consumed by other repos):** yes — `theokit/server/define` + `theokit/server` barrels; TheoCode imports `defineRoute`/`defineAgentEndpoint`. New fields are OPTIONAL so the published type stays backward-compatible.
- **Symbol:** `defineAgentEndpoint` in `packages/theo/src/server/define/define-agent-endpoint.ts`
  - **Callers (production):** internal only within theokit; consumed externally by TheoCode `server/routes/session/[id]/prompt.ts:1`.
  - **Callers (tests):** `tests/unit/define-agent-endpoint.test.ts`, `tests/integration/define-agent-endpoint-signal.test.ts`, `tests/integration/fixture-agent-endpoint.test.ts`, `tests/unit/regression-1-define-agent-endpoint-incoming-message.test.ts`
- **Symbol:** `toResponse` (internal) in `packages/theo/src/server/web-handler.ts:246-257`
  - **Callers (production):** `executeWebRequest` (`:482`).
  - **Callers (tests):** exercised via `tests/integration/node-web-adapter*.test.ts`, `tests/unit/send-response-web.test.ts`.

### Domain glossary

- **RouteConfig** — the object returned by `defineRoute`/`defineAgentEndpoint`; the runtime reads its `query`/`body`/`params`/`status`/`handler` fields to validate and dispatch a request.
- **Node runner** — `executeRoute` in `http/execute.ts`, drives requests for the `IncomingMessage`/`ServerResponse` (Node http) surface.
- **Web runner** — `executeWebRequest` in `web-handler.ts`, drives requests for the WHATWG `Request`/`Response` surface (Workers/Deno/Bun adapters).
- **Plain-object return** — a handler return value that is NOT a `Response` instance; the runner auto-serializes it to JSON (`sendJson` / `toResponse`).
- **SSE wrapper** — the `RouteConfig.handler` that `defineAgentEndpoint` synthesizes; converts an `AsyncGenerator<AgentEvent>` into a streaming `Response`.

### Architecture boundaries affected

Per `rules/architecture.md` + `rules/system-design-guardrails.md`: the contract type lives in `core/contracts/` (the lowest layer); both runners (`server/http`, `server/`) depend INWARD on it (allowed direction). No new cross-layer edge is introduced — `define-agent-endpoint.ts` already depends on `route-config.ts`. `rules/type-safety.md`: Zod schema is the single source of truth (SSoT) for both input and output validation — the `response` slot reuses the same `z.ZodType` discipline already in place for `query`/`body`/`params`.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `zod` | (existing peer/dep in `packages/theo`) | npm | The `response`/`params` slots reuse the same `z.ZodType` already used for `query`/`body`/`params` validation (DRY — no new validation library) |

### New — to be introduced

(none — this plan adds zero new dependencies; it extends an existing contract using the already-present `zod`.)

### Removed

(none)

## Prior Art & Related Work

- **In-repo contract precedent:** `defineRoute` already proves the `RouteConfig` Zod-slot pattern for `query`/`body`/`params` (`packages/theo/src/server/define/define-route.ts:14-24`); the `response` slot is the symmetric output-side application of the same pattern.
- **In-repo runner precedent:** input validation in both runners (`http/execute.ts runZodValidation`, `web-handler.ts:174-220 validationErrorResponse`) is the template the new output-validation step mirrors — same `safeParse` + structured-error shape.
- **In-repo type-lie precedent:** `regression-1-define-agent-endpoint-incoming-message.test.ts` shows the project already hardened `defineAgentEndpoint`'s arg duck-typing once; the `params: undefined` type lie is the same class of defect (declared type ≠ runtime value).
- **External literature:** tRPC `.output()` validators (https://trpc.io/docs/server/validators) — runtime output validation against a schema is an established framework affordance; relevance: justifies that `response` belongs in the runtime, not the handler.
- The status-asymmetry fix is first-of-its-kind hardening on the Web runner's `toResponse` — no prior art beyond the Node runner's existing `rc.status` honoring at `execute.ts:290`.

## Objective

- [ ] Add optional `response?: TResponse (z.ZodType)` to `RouteConfig` without changing how existing call-sites infer the other 5 generic params.
- [ ] Node runner validates a plain-object return against `config.response` (when present) before `sendJson`; on mismatch throws a `TheoError`-mapped 500-class envelope (server-side contract breach), Response-instance returns untouched.
- [ ] Web runner does the same validation in `toResponse`/`runHandler` AND honors `config.status` for plain-object returns (fixes the 200 hardcode).
- [ ] Add optional `params?: TParams (z.ZodType)` to `defineAgentEndpoint`; set it on the returned `RouteConfig`; type `AgentEndpointHandlerArgs.params` as `z.infer<TParams>`; thread the validated params to the generator.
- [ ] Backward compatibility: every existing route/test green; no behavior change when `response`/`params` are absent.
- [ ] A changeset declares the `theokit` minor bump.

## ADRs

### D1 — `response` is an optional Zod slot validated by the runner, NOT a separate `defineValidatedRoute`
- **Decision:** Add `response?: z.ZodType` to the existing `RouteConfig` as a **plain optional field (NO new generic param)** and validate inside the two existing runners. (Implementation refinement 2026-06-26: a plain field — not a 6th `TResponseSchema` generic — because D4/YAGNI already places static inference of the handler return from `response` out of scope; a plain field keeps runtime `safeParse` identical, preserves the existing 5-generic arity byte-for-byte, and fully dissolves the inference-shift risk in Drawbacks. The stale comment in `route-config.ts:11-13` references a `route-config-generic-arity.test.ts` that does not exist; no test pins arity, but a plain field is the KISS choice regardless.)
- **Rationale:** KISS + DRY — reuses the exact `z.ZodType` + `safeParse` machinery already present for input; one contract type, not two. Aligns with `rules/type-safety.md` (Zod as SSoT).
- **Alternatives considered:** (a) A new `defineValidatedRoute` wrapper — rejected: forks the contract surface, violates DRY, and consumers would have two route factories to choose between (KISS). (b) Keep output validation in handlers (status quo) — rejected: that is exactly the reimplementation the radar thesis says to remove.
- **Consequences:** Enables consumers to drop `.parse()`; constrains the runner to treat a `response` mismatch as a server fault (the handler produced data violating its own declared contract).

### D2 — A `response` mismatch is a SERVER error (500-class), not a client 400
- **Decision:** When `config.response.safeParse(result)` fails, the runner raises through the existing error→envelope path (`serverErrorToEnvelope` → 500 `INTERNAL_SERVER_ERROR`), distinct from the 400 used for input (`query`/`body`/`params`) validation failures.
- **Rationale:** Input is untrusted (client's fault → 400); output is produced by our own handler (our fault → 500). Fail-fast/fail-loud (CLAUDE.md §8): a contract breach must surface, never be silently shipped to the client.
- **Alternatives considered:** (a) Return the unvalidated object anyway + log — rejected: silent contract drift, the precise failure mode `response` exists to prevent. (b) Reuse the 400 path — rejected: misattributes a server bug as a client error, corrupting observability.
- **Consequences:** A handler whose output drifts from its schema returns 500 in tests/CI immediately; constrains handlers to honor their declared `response`.

### D3 — Fix the Web-runner status asymmetry inside this plan (not deferred)
- **Decision:** `toResponse` (web) accepts and honors `config.status` for plain-object returns, matching the Node runner's `rc.status ?? 200`.
- **Rationale:** YAGNI says don't add unused knobs — but `status` already EXISTS and is already honored on one of two runners; the asymmetry is a latent bug the `response` slot would amplify (a validated `status:201` plain object would still 200 on Web). Fixing it now is in the same return-handling code path (KISS — one edit site).
- **Alternatives considered:** (a) Defer to a separate plan — rejected: the `response` work touches the exact lines; splitting doubles the regression surface. (b) Leave asymmetric + document — rejected: ships a known divergence between two supposedly-equivalent runtimes.
- **Consequences:** Web and Node runners become status-equivalent for plain-object returns; one more behavioral guarantee the test suite locks.

### D4 — `defineAgentEndpoint` gains `params` only; `query`/`body` typing stays as-is
- **Decision:** Add `params?: TParams` to `AgentEndpointConfig`; set `params` on the returned `RouteConfig`; type the generator's `params` arg as `z.infer<TParams>`. Do NOT add `query`/`response` to agent endpoints in this plan.
- **Rationale:** YAGNI — the concrete, evidenced consumer need is path params (`:id`) for the streaming route; output of an SSE stream is a `Response`, so `response` validation is N/A for agent endpoints. Scope stays minimal.
- **Alternatives considered:** (a) Full `query`+`body`+`response` parity for agent endpoints — rejected: no consumer need (YAGNI), and `response` is meaningless for a streaming `Response`. (b) Leave `params: undefined` and document the type lie — rejected: the runtime already passes params; the type should tell the truth (`rules/type-safety.md`).
- **Consequences:** Streaming routes get typed/validated path params; the existing AbortSignal/SSE/prime-error behavior is untouched.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Generic-param addition to `RouteConfig` could shift type inference for existing call-sites | Medium | New param has a default (`z.ZodType = z.ZodUndefined` style); add a `tests/**/*.test-d.ts` type test asserting an existing `defineRoute` still infers identically; run `tsc --noEmit` across the monorepo | framework |
| `response` validation adds a per-request `safeParse` on the hot path | Low | Only runs when `config.response` is set (opt-in); routes without it pay zero cost (early `if`) | framework |
| Throwing on output mismatch could turn a previously-200 route into a 500 if a handler already drifts from an intended (but unvalidated) shape | Low | Opt-in — only routes that ADD `response` get the check; no existing route changes behavior until it adopts the slot | framework |
| Web `toResponse` status change could alter a route that relied (accidentally) on the 200 hardcode | Low | Audit: only plain-object returns with an explicit `config.status` change; `Response`-instance routes (the common case) already carry their own status and are untouched; covered by the new symmetry test | framework |

## Unresolved Questions

- Q1 — Should a `response` mismatch in production be downgraded to "log + serve" behind a config flag (vs always-500)? Resolved at plan time per D2: always-500 in all environments; a flag is YAGNI until a consumer asks. Documented, not built.
- Q2 — Does any existing internal route already return a plain object with a non-200 `config.status` under the Web runner that the symmetry fix would change? Verified at plan time: the Node-vs-Web status divergence is exercised only via `Response`-instance returns in current tests; the symmetry test (T1.4) will assert the new behavior and a full `pnpm test` run confirms no regression. If the run surfaces a relying route, it becomes a MUST-FIX in `/edge-case-plan`.

## Dependency Graph

```
Phase 1 (response slot + status symmetry) ──▶ Phase 3 (changeset + integration validation)
Phase 2 (agent-endpoint params) ────────────▶ Phase 3

Phase 1 and Phase 2 are INDEPENDENT (different files; route-config.ts touched only by P1)
and MAY run in parallel. Phase 3 depends on both.
```

---

## Phase 1: `response` slot + Web status symmetry

**Objective:** Add a runner-validated `response` Zod slot to `RouteConfig` and make the Web runner honor `config.status` for plain-object returns.

### T1.1 — Add `response?: TResponse` to `RouteConfig`

#### Objective
Extend the contract type with an optional output schema generic without disturbing existing inference.

#### Why this step (action + reasoning)
1. **What this step does** — adds a 6th generic `TResponseSchema extends z.ZodType = z.ZodUndefined` and a `response?: TResponseSchema` field to `RouteConfig`.
2. **Why it is necessary now** — every downstream runner edit (T1.2/T1.3) reads `config.response`; the type must exist first (D1). Per `## Baseline Context`, `RouteConfig` is the canonical contract all route factories build on.

#### Evidence
`packages/theo/src/core/contracts/route-config.ts:18-45` — current 5-generic interface with `query`/`body`/`params`/`status`/`csrf`/`handler`; no `response`.

#### Files to edit
```
packages/theo/src/core/contracts/route-config.ts — add TResponseSchema generic + response? field
tests/unit/route-config-response-validation.test.ts — RED type+unit test (created here, asserted in T1.2)
```

#### Deep file dependency analysis
- `route-config.ts` (Baseline row 1) — adds a generic param with a default; because the default preserves arity-by-default, the 9 production callers (Baseline § callers) keep inferring identically. `define-route.ts` will gain the ability to pass `response` but is not required to.

#### Deep Dives
- Data structures: `response?: TResponseSchema` where `TResponseSchema extends z.ZodType = z.ZodUndefined`; the handler return type stays `TResponse = unknown` (the `response` schema validates at runtime; static inference of handler return from `response` is out of scope — YAGNI per D4).
- Invariants: existing fields + their defaults unchanged (Baseline "Invariants to preserve").
- Edge cases: `response` absent → no type change observable to callers.

#### Tasks
1. Add the `TResponseSchema` generic with default `z.ZodUndefined`.
2. Add `response?: TResponseSchema` field with a doc comment.

#### TDD
```
RED:     test_existing_defineRoute_still_infers_body_and_params() (.test-d.ts) — asserts a defineRoute without `response` infers the same handler ctx types as before (MUST compile-fail only if inference broke)
RED:     test_routeConfig_accepts_response_schema() — a RouteConfig literal with `response: z.object({...})` typechecks
GREEN:   add the generic + field
REFACTOR: None expected
VERIFY:  pnpm test -- route-config-response-validation && pnpm typecheck
```

#### Concurrency tests (only when applicable)
(none — single-threaded)
Rationale: a type/field addition has no runtime concurrency surface; the agent-endpoint AbortSignal path (the plan's only concurrency signal) is untouched by Phase 1.

#### Acceptance Criteria
- [ ] `response?` field present and optional — `grep -n "response?" packages/theo/src/core/contracts/route-config.ts` returns a hit
- [ ] Existing inference preserved — `pnpm typecheck` exits 0 across the monorepo
- [ ] Pass: lint — `pnpm lint` zero warnings on changed files
- [ ] Pass: size — `route-config.ts` ≤ 500 lines (`wc -l packages/theo/src/core/contracts/route-config.ts`)

#### DoD
- [ ] `pnpm test -- route-config-response-validation` green
- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm lint` zero warnings
- [ ] File-size budget respected

### T1.2 — Node runner validates `config.response` before `sendJson`

#### Objective
Validate a plain-object return against `config.response` in `execute.ts`, raising a 500-class error on mismatch.

#### Why this step (action + reasoning)
1. **What this step does** — inserts, in the plain-object branch of `execute.ts` (`:290`), a guard: if `config.response` is a Zod type, `safeParse(handlerResult)`; on failure throw a `TheoError` (caught by the existing `:292-300` catch → 500 envelope); on success serialize the parsed value.
2. **Why it is necessary now** — it is the Node-side half of D1/D2; the contract from T1.1 is inert until a runner enforces it.

#### Evidence
`packages/theo/src/server/http/execute.ts:253-291` (result decision tree); plain-object serialization at `:290 sendJson(res, handlerResult, (rc.status ?? 200))`. Catch + envelope mapping at `:292-300`.

#### Files to edit
```
packages/theo/src/server/http/execute.ts — add response validation in the plain-object branch
tests/unit/route-config-response-validation.test.ts — assert Node-runner validation (valid passes, invalid → 500)
```

#### Deep file dependency analysis
- `execute.ts` (Baseline row 2) — adds a guard BEFORE `sendJson` in the plain-object branch only; the `Response`-instance branch (`:271-287`) and `undefined→204` (`:253-256`) are untouched (Baseline invariant). Reuses the existing `serverErrorToEnvelope`/`envelopeCodeToStatus` path (no new error machinery — DRY).

#### Deep Dives
- Algorithm: `if (isZodLike(rc.response)) { const r = rc.response.safeParse(handlerResult); if (!r.success) throw new TheoError({code:'INTERNAL_SERVER_ERROR', message:'response validation failed', ext:{issues:r.error.issues}}); sendJson(res, r.data, rc.status ?? 200) } else { sendJson(res, handlerResult, rc.status ?? 200) }`.
- Invariants: Response passthrough + 204 unchanged; `rc.status` honoring unchanged.
- Edge cases: `response` absent → existing path verbatim; handler returns `Response` → no validation (D1, validation is for plain objects only).

#### Pseudo-code / Signatures
```pseudocode
# plain-object branch of executeRoute, replacing the single sendJson at :290
if isZodLike(rc.response):
  parsed = rc.response.safeParse(handlerResult)
  if not parsed.success:
    throw TheoError(code=INTERNAL_SERVER_ERROR, message="response validation failed", ext={issues})
  sendJson(res, parsed.data, rc.status ?? 200)
else:
  sendJson(res, handlerResult, rc.status ?? 200)

# Example
config.response = z.object({ id: z.string() })
handler returns { id: 123 }  -> 500 INTERNAL_SERVER_ERROR (id not a string)
handler returns { id: "x" }  -> 200 {"id":"x"}
```

#### Tasks
1. Import `TheoError` (already in module scope via the error path) / `isZodLike`.
2. Replace the single `sendJson` at the plain-object branch with the guarded version.

#### TDD
```
RED:     test_node_runner_passes_valid_response() — handler returns matching object → 200 + body
RED:     test_node_runner_rejects_invalid_response_with_500() — handler returns drifting object → status 500, envelope code INTERNAL_SERVER_ERROR
RED:     test_node_runner_skips_validation_when_no_response_schema() — no response slot → unchanged 200
RED:     test_node_runner_does_not_validate_Response_instance() — handler returns a Response → passthrough, no parse
GREEN:   implement the guard
REFACTOR: None expected
VERIFY:  pnpm test -- route-config-response-validation
```

#### Concurrency tests (only when applicable)
(none — single-threaded)
Rationale: request handling is per-call; the validation guard introduces no shared state. Existing concurrency coverage (AbortSignal) lives in the agent-endpoint path (Phase 2), unaffected here.

#### Acceptance Criteria
- [ ] Valid output passes, invalid output → 500 — both assertions green in `pnpm test -- route-config-response-validation`
- [ ] `Response`-instance + no-schema paths unchanged — regression assertions green
- [ ] Pass: lint — `pnpm lint` zero warnings on `execute.ts`
- [ ] Pass: size — `execute.ts` ≤ 500 lines (`wc -l`)

#### DoD
- [ ] `pnpm test -- route-config-response-validation` green
- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm lint` zero warnings
- [ ] File-size budget respected

### T1.3 — Web runner validates `config.response`

#### Objective
Mirror T1.2 in the Web runtime (`web-handler.ts`).

#### Why this step (action + reasoning)
1. **What this step does** — adds the same `config.response` `safeParse` guard for plain-object returns in the Web runner, routing a mismatch through `handlerErrorResponse` (→ 500 envelope).
2. **Why it is necessary now** — runtime parity (D1): a contract the Node runner enforces must hold identically on the Web surface, or the same route behaves differently per adapter.

#### Evidence
`packages/theo/src/server/web-handler.ts:236-257` (`runHandler` result + `toResponse`); `handlerErrorResponse` at `:264-273`; catch wiring at `:467-484`.

#### Files to edit
```
packages/theo/src/server/web-handler.ts — validate config.response in the plain-object branch of toResponse/runHandler
tests/unit/route-config-response-validation.test.ts — assert Web-runner parity (valid passes, invalid → 500)
```

#### Deep file dependency analysis
- `web-handler.ts` (Baseline row 3) — the plain-object branch of `toResponse` (`:253-256`) gains the guard; `Response`-passthrough + `undefined→204` unchanged. Reuses `serverErrorToEnvelope`/`envelopeCodeToStatus` already imported for `handlerErrorResponse` (DRY).

#### Deep Dives
- Algorithm: in `runHandler`, after obtaining `result` and before `toResponse`, if `config.response` is Zod, `safeParse`; on failure return `handlerErrorResponse(new TheoError(INTERNAL_SERVER_ERROR,…))`; on success pass `parsed.data` forward. (Placing the guard in `runHandler` keeps `toResponse` a pure serializer.)
- Invariants: 400 input-validation shape (`validationErrorResponse`) unchanged; Response passthrough unchanged.
- Edge cases: identical to T1.2.

#### Tasks
1. Add the guard in `runHandler` (between `config.handler(...)` and the `{ok:true,result}` return) OR in `toResponse` with status threading — choose `runHandler` so `toResponse` stays a pure serializer.
2. Route mismatch to `handlerErrorResponse`.

#### TDD
```
RED:     test_web_runner_passes_valid_response() — matching object → 200 + body
RED:     test_web_runner_rejects_invalid_response_with_500() — drifting object → 500 envelope INTERNAL_SERVER_ERROR
RED:     test_web_runner_skips_validation_when_no_response_schema() — unchanged
GREEN:   implement the guard
REFACTOR: None expected
VERIFY:  pnpm test -- route-config-response-validation
```

#### Concurrency tests (only when applicable)
(none — single-threaded)
Rationale: same as T1.2 — per-request, no shared mutable state.

#### Acceptance Criteria
- [ ] Web runner valid/invalid/absent paths match Node runner behavior — `pnpm test -- route-config-response-validation` exits 0
- [ ] Pass: lint — `pnpm lint` zero warnings on `web-handler.ts`
- [ ] Pass: size — `web-handler.ts` ≤ 500 lines? (currently 639 — see note) — change is additive (~6 lines); pre-existing over-budget file documented, not worsened beyond +10 lines
- [ ] Pass: coverage — `pnpm test` ≥ 90% on changed lines

#### DoD
- [ ] `pnpm test -- route-config-response-validation` green
- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm lint` zero warnings
- [ ] File-size delta ≤ +10 lines (pre-existing 639-LoC file; not split in this plan — see Drawbacks)

### T1.4 — Web `toResponse` honors `config.status` (asymmetry fix)

#### Objective
Make the Web runner return `config.status` for plain-object returns, matching the Node runner.

#### Why this step (action + reasoning)
1. **What this step does** — threads `config.status` into `toResponse` so a plain-object return uses `config.status ?? 200` instead of the hardcoded `200`.
2. **Why it is necessary now** — D3: the `response` slot makes this latent divergence consumer-visible; fixing it in the same return-handling path is KISS.

#### Evidence
`packages/theo/src/server/web-handler.ts:246-257` — `toResponse` hardcodes `status: 200`. Node counterpart honors `rc.status` at `execute.ts:290`.

#### Files to edit
```
packages/theo/src/server/web-handler.ts — pass config.status into toResponse for plain-object returns
tests/unit/web-handler-status-symmetry.test.ts — RED test: plain-object return with status:201 yields 201 on Web runner
```

#### Deep file dependency analysis
- `web-handler.ts` (Baseline row 3) — `toResponse` signature gains a `status?: number` param (or reads it from a passed config); `undefined→204` and `Response`-passthrough branches keep their own status (untouched).

#### Deep Dives
- Algorithm: `toResponse(result, status)` → plain-object branch uses `new Response(JSON.stringify(result), { status: status ?? 200, … })`.
- Invariants: `undefined→204` and `Response` passthrough unchanged.
- Edge cases: no `config.status` → 200 (current default preserved).

#### Tasks
1. Add `status` param to `toResponse` (or compute at call-site `:482`).
2. Pass `config.status` from `executeWebRequest`.

#### TDD
```
RED:     test_web_plain_object_honors_config_status_201() — config.status:201 + plain object → response.status === 201
RED:     test_web_plain_object_defaults_to_200_without_status() — no config.status → 200 (regression)
RED:     test_web_undefined_return_still_204() — regression on the 204 branch
GREEN:   thread config.status
REFACTOR: None expected
VERIFY:  pnpm test -- web-handler-status-symmetry
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] `config.status:201` plain object → 201 on Web runner — `pnpm test -- web-handler-status-symmetry` green
- [ ] 200 default + 204 branches preserved — regression assertions green
- [ ] Node and Web runners agree on status for the same `config.status` — `pnpm test -- web-handler-status-symmetry` exits 0
- [ ] Pass: lint — `pnpm lint` zero warnings

#### DoD
- [ ] `pnpm test -- web-handler-status-symmetry` green
- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm lint` zero warnings
- [ ] File-size delta within budget (additive)

---

## Phase 2: `defineAgentEndpoint` params

### T2.1 — Add `params?: TParams` to `defineAgentEndpoint` + fix the type lie + thread params

#### Objective
Give streaming endpoints typed, validated path params end-to-end.

#### Why this step (action + reasoning)
1. **What this step does** — adds `params?: TParams (z.ZodType)` to `AgentEndpointConfig`; sets `params` on the returned `RouteConfig` (so the runner validates path params); changes `AgentEndpointHandlerArgs.params` from `undefined` to `z.infer<TParams>`; threads the runtime-validated `params` (already passed at `:132`) into the generator with the correct type.
2. **Why it is necessary now** — D4: the consuming streaming route re-parses `request.url` because the public type says params are `undefined`; the runtime already has them — the type and schema just need to tell the truth.

#### Evidence
`packages/theo/src/server/define/define-agent-endpoint.ts:120-135` (wrapper handler destructures+passes `params: params` at `:132`); `:29-32` declares `AgentEndpointHandlerArgs.params: undefined`; the returned `RouteConfig` is `<z.ZodUndefined,z.ZodUndefined,z.ZodUndefined,…>` so the runner doesn't validate path params.

#### Files to edit
```
packages/theo/src/server/define/define-agent-endpoint.ts — add params? to config + RouteConfig + handler-args type; thread params
tests/unit/define-agent-endpoint-params.test.ts — RED tests for typed/validated params
```

#### Deep file dependency analysis
- `define-agent-endpoint.ts` (Baseline row 4) — the config interface, the `AgentEndpointHandlerArgs` type, and the returned `RouteConfig`'s `TParams` position change. SSE encoding, prime-error handling, and AbortSignal cancellation are NOT touched (Baseline invariant). External consumer `prompt.ts` (TheoCode) adopts in the sibling plan.

#### Deep Dives
- Data structures: `AgentEndpointConfig<TParams extends z.ZodType = z.ZodUndefined, TCtx, TBody>` gains `params?: TParams`; return type becomes `RouteConfig<z.ZodUndefined, z.ZodUndefined, TParams, TCtx, Response>`; `AgentEndpointHandlerArgs.params: z.infer<TParams>`.
- Invariants: cancellation (`:163-171`), prime-error (`:149-186`), SSE (`:75-77`) unchanged — assert via existing `define-agent-endpoint-signal.test.ts` staying green.
- Edge cases: `params` absent → `TParams = z.ZodUndefined`, generator `params` is `undefined` (today's behavior, now typed honestly); invalid path param (when schema present) → runner returns 400 before the generator runs.

#### Pseudo-code / Signatures
```pseudocode
interface AgentEndpointConfig<TParams extends z.ZodType = z.ZodUndefined, TCtx=unknown, TBody=unknown> {
  params?: TParams
  handler: (args: AgentEndpointHandlerArgs<TParams, TCtx, TBody>) => AsyncGenerator<AgentEvent>
}
# returned RouteConfig sets params: config.params, so the runner validates :id
# wrapper passes params (already validated by runner) into config.handler({... params ...})

# Example
defineAgentEndpoint({ params: z.object({ id: z.string() }), handler: async function*({params}) { yield ev(params.id) } })
request /api/session/abc/prompt -> generator sees params.id === "abc" (typed string)
request with missing/invalid :id (schema mismatch) -> 400 before generator runs
```

#### Tasks
1. Add `TParams` generic + `params?` field to `AgentEndpointConfig`.
2. Set `params: config.params` on the returned `RouteConfig`.
3. Retype `AgentEndpointHandlerArgs.params` to `z.infer<TParams>`; pass it through (runtime line `:132` already provides the value).

#### TDD
```
RED:     test_agent_endpoint_threads_typed_params() — generator receives params.id as a string
RED:     test_agent_endpoint_validates_params_returns_400_on_mismatch() — schema mismatch → 400 before generator body runs
RED:     test_agent_endpoint_without_params_is_unchanged() — no params slot → existing behavior (regression)
GREEN:   implement config field + RouteConfig wiring + type fix + threading
REFACTOR: None expected
VERIFY:  pnpm test -- define-agent-endpoint-params && pnpm test -- define-agent-endpoint-signal
```

#### Concurrency tests (only when applicable)
The file's concurrency surface is the AbortSignal-driven generator cancellation (`:163-171`). This task does NOT modify it; the params change is a read-only per-request value.

Race-aware coverage: the existing **cancellation propagation** test `tests/integration/define-agent-endpoint-signal.test.ts` (asserts AbortSignal still calls `generator.return()` on cancel) MUST stay green as the regression guard — run via `pnpm test -- define-agent-endpoint-signal`. No new concurrent state is introduced by params threading (single read of validated params per request).

#### Acceptance Criteria
- [ ] Typed params reach the generator — `pnpm test -- define-agent-endpoint-params` green
- [ ] Schema mismatch → 400 before generator body — `pnpm test -- define-agent-endpoint-params` exits 0
- [ ] No-params path unchanged + cancellation regression green — `pnpm test -- define-agent-endpoint-signal` green
- [ ] `AgentEndpointHandlerArgs.params` is no longer `undefined` — `grep -n "params: undefined" packages/theo/src/server/define/define-agent-endpoint.ts` returns NO hit
- [ ] Pass: lint — `pnpm lint` zero warnings; Pass: size — `wc -l define-agent-endpoint.ts` ≤ 500

#### DoD
- [ ] `pnpm test -- define-agent-endpoint-params` + `define-agent-endpoint-signal` green
- [ ] `pnpm typecheck` zero errors
- [ ] `pnpm lint` zero warnings
- [ ] File-size budget respected

---

## Phase 3: Changeset + Integration Validation

### T3.1 — Changeset for the `theokit` minor bump

#### Objective
Declare the release intent via changesets (theokit uses the changesets bot; do NOT run `pnpm version-packages` in the feature commit).

#### Why this step (action + reasoning)
1. **What this step does** — writes `.changeset/routes-framework-contract.md` declaring a `minor` bump for `theokit` with a consumer-facing summary.
2. **Why it is necessary now** — the package publishes via changesets CI (`.changeset/config.json` baseBranch=main); the changeset is the contract that the bot's Version PR consumes. (Lesson from prior cycles: a feature commit must carry the changeset but must NOT consume it.)

#### Evidence
`.changeset/config.json` (changelog `@changesets/cli/changelog`, access public, baseBranch main); no pending changeset files currently.

#### Files to edit
```
.changeset/routes-framework-contract.md (NEW) — minor bump declaration for theokit
```

#### Deep file dependency analysis
- New changeset file only; no code dependency. The changesets bot bumps `theokit` 0.9.15 → 0.10.0 on the Version PR (not in this feature commit).

#### Deep Dives
- Format: frontmatter `"theokit": minor` + a one-line consumer summary ("Add `response` Zod slot to `RouteConfig` (runtime output validation) and `params` to `defineAgentEndpoint`; Web runner now honors `config.status` for plain-object returns").
- Edge cases: none.

#### Tasks
1. Write the changeset file with `minor` bump + summary.

#### TDD
```
RED:     n/a (changeset is metadata, not executable code)
GREEN:   create .changeset/routes-framework-contract.md
REFACTOR: None expected
VERIFY:  test -f .changeset/routes-framework-contract.md && grep -q "theokit" .changeset/routes-framework-contract.md
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] Changeset exists with a `minor` bump — `grep -A2 '\-\-\-' .changeset/routes-framework-contract.md | grep -q "theokit"`
- [ ] No version consumed in the feature commit — `git diff --name-only` does NOT include `packages/theo/package.json` version bump

#### DoD
- [ ] Changeset file present and well-formed
- [ ] Feature commit does NOT run `version-packages`

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `RouteConfig` has no `response` output-validation slot | T1.1, T1.2, T1.3 | Add `response?` + validate in both runners (500 on mismatch) |
| 2 | `defineAgentEndpoint` can't type/validate path params (type lie) | T2.1 | Add `params?` + fix `AgentEndpointHandlerArgs.params` type + thread validated params |
| 3 | Web runner hardcodes 200 for plain-object returns (status asymmetry) | T1.4 | `toResponse` honors `config.status` |
| 4 | Backward compatibility for all existing routes/tests | T1.1–T2.1 (additive/optional) + Final Phase | Optional fields; full `pnpm test` regression |
| 5 | Release declared without consuming the changeset | T3.1 | Changeset file with `minor` bump |
| 6 | No regression in existing route/agent-endpoint behavior | T1.1, T1.2, T1.3, T1.4, T2.1 (regression assertions) + Final Phase | Full `pnpm test` suite + `pnpm typecheck` + `pnpm lint` green |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm test` green (from theokit root)
- [ ] Zero type errors — `pnpm typecheck`
- [ ] Zero lint warnings — `pnpm lint`
- [ ] File-size budget respected (per `rules/architecture.md`); pre-existing 639-LoC `web-handler.ts` not worsened beyond +10 lines (not split in this plan — documented in Drawbacks)
- [ ] CHANGELOG handled via changeset (theokit uses changesets CI, not manual `[Unreleased]` edits)
- [ ] Backward compatibility preserved — existing `defineRoute`/`defineAgentEndpoint` callers + tests unchanged and green
- [ ] Plan-specific criteria: new fields are OPTIONAL; no existing route changes behavior without adopting a slot
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR has been merged, move to `knowledge-base/plans/completed/`.

## Failure scenarios (when I/O external)

```
(none — no external I/O touched)
```
Rationale: this plan modifies the server-side request runner and the route contract type. The runner RECEIVES requests and serializes responses in-process; it makes no outbound HTTP/DB/queue/object-store calls. No external dependency exists to fail. (The route handlers a consumer writes may do I/O, but that is consumer code, out of scope for this framework-contract plan.)

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the additive contract changes against the full existing route/agent-endpoint suite in both runtimes.

### Execution
```
pnpm test          # full vitest suite (unit + integration + type tests), from theokit root
pnpm typecheck     # tsc --noEmit across the monorepo (catches inference regressions)
pnpm lint          # eslint . --max-warnings=0
```

### Acceptance Criteria
- [ ] All test suites green (unit + integration + `.test-d.ts` type tests), including pre-existing `define-agent-endpoint-signal`, `define-route`, `send-response-web`, `node-web-adapter*`
- [ ] Coverage ≥ 90% on changed files (critical paths: the two runner validation branches: 100%)
- [ ] Zero type errors (`pnpm typecheck`) — proves the `RouteConfig` generic addition didn't shift existing inference
- [ ] Zero lint warnings
- [ ] Runtime-metric proof — n/a (no new counters declared)
- [ ] Failure scenarios green — n/a ("(none — no external I/O touched)")

### If Validation Fails
1. Distinguish plan-caused failures (inference shift from the new generic; status-symmetry change) from pre-existing.
2. Fix all plan-caused failures before completion.
3. Re-run the chain.
4. Pre-existing issues logged in the PR description, do not block.
