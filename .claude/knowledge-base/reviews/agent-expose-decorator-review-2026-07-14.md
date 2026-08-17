# Review — agent-expose-decorator (M47)

**Date:** 2026-07-14
**Slug:** agent-expose-decorator · **milestone:** M47
**Scope:** commits `494824b`..`81e202b`, base `50c2ad0`.
**Verdict:** **READY_TO_MERGE** (after fixes applied)

## Method

Two independent specialist agents reviewed the M47 change with fresh eyes:

1. **Architecture reviewer** — G1/G2 boundary, CSRF exactly-once, guard ordering, handle discrimination,
   the codegen path-vs-`@Expose`-path consistency, `@UseGuards` widening.
2. **Type-safety + test-coverage auditor** — `any`/`as` hygiene, phantom-type soundness, edge/negative
   coverage per `testing.md § 4.1`.

## Findings + resolution

| # | Sev | Finding | Resolution |
|---|-----|---------|------------|
| 1 | **BLOCKER** | `opts.path` let the `@Expose`-served URL diverge from the generated handle's path (codegen hardcodes `/api/agents/<name>` from the file scan). `useAgent(handle)` could POST to the wrong URL (404/wrong agent) with no warning. | **FIXED** — removed `opts.path`; served path = `prefix + propertyKey` (must equal the convention route). New guard test `test_expose_served_path_equals_the_generated_handle_convention_route` pins `fullPath == /api/agents/<name>` — the exact invariant `opts.path` broke. `ExposeOptions` is now reserved (empty), documented to return only when wired end-to-end (codegen reads `@Expose` metadata). |
| 2 | **HIGH** | `opts.csrf` was a documented public field but `serveAgent` discarded it — a silent no-op (misleading contract: `{ csrf: false }` did NOT disable CSRF). | **FIXED** — removed `csrf`. CSRF is enforced exactly once at the controller-dispatch boundary (the secure default); a per-route opt-out returns only when it can thread through the dispatcher. |
| 3 | MEDIUM | Interceptors on an `@Expose` property are silently ignored (the dispatcher delegates to `mountAgent` before the interceptor chain). | **FIXED (documented)** — `@Expose` JSDoc + walker comment state interceptors do NOT run for agent routes; guards DO (G5). The walker no longer collects them (was `[...classInterceptors]`, now `[]`). |
| 4 | LOW | A misplaced JSDoc block (`createDecoratorServer`'s doc landed on `ServeAgent`). | **FIXED** — moved back to `createDecoratorServer`. |

## Adjudication note

The architecture reviewer's CSRF exactly-once analysis (Finding #3 in its report) was **confirmed PASS**:
`dispatchControllerRequest` enforces CSRF once for the matched agent route; `mountAgent` runs with
`csrfMode 'off'`. No path skips CSRF inadvertently. The `isAgentHandle` discrimination was confirmed
unambiguous (no shipped `AgentTransport` has a `.path` field; all have `sendMessages`).

## Sound-by-review (no action)

- G1 respected — `@theokit/http` imports nothing from theo/agents; the `serveAgent` callback keeps http
  agent-runtime agnostic. G2 — no parallel streamer (grep gate `agent-exposure-reconciliation.test.ts`).
- Guard ordering correct — a denying guard blocks the agent before `serveAgent` (tested).
- Handle is serializable (`JSON.stringify` drops the binder methods); phantom-type inference sound.
- `@UseGuards` widening to `PropertyDecorator` is strictly permissive (back-compat).

## Gates

- BLOCKER: 0 · HIGH: 0 (after fixes) — both fixed with a regression guard.
- Full root suite green (baseline + M47); `tsc` (workspace) clean; `eslint --max-warnings=0` clean; showcase
  re-validated live (`@Expose` route streams via OpenRouter, CSRF 403).

**→ READY_TO_MERGE.**
