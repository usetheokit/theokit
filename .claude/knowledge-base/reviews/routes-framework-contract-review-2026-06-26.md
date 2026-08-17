# Review — routes-framework-contract (theokit Plan A)

**Date:** 2026-06-26 · **Slug:** routes-framework-contract · **Commits:** `8182aba` (feature + changeset), `5401e4d` (review LOW fix)
**Reviewer:** 1 adversarial (backward-compat + contract + regression focus). **Verdict: READY_TO_MERGE**

## Gates
- Targeted + regression (`route-config-response-validation`, `web-handler-status-symmetry`, `define-agent-endpoint-params`, `define-agent-endpoint-signal`, `define-route`, `define-agent-endpoint`): **25 + 16 passed**, independently re-run.
- `npx tsc --noEmit`: **0 errors** (proves the `TParams` generic addition did not shift inference anywhere in the monorepo).
- `pnpm lint`: clean on all changed files (pre-commit lint-staged eslint `--max-warnings=0` + prettier passed both commits).
- Full `pnpm test`: 30 failures — **all verified pre-existing** (baseline stash comparison; domains: create-theo packaging, docs-presence, @theokit/ui peerDep — none in routes/response/agent/web).
- plan-confidence: **SHIPPABLE_WITH_CAVEATS 84.0** (0 hard caps, coverage 100%).

## What shipped
- `RouteConfig.response?: z.ZodType` (plain field, no new generic — preserves 5-generic arity). Both runtimes validate a plain-object handler return against it → **500 INTERNAL_SERVER_ERROR** on mismatch (server contract breach, distinct from 400 input validation). `Response`-instance + `undefined`/`null`→204 NOT validated (SSE/streaming safe; Node↔Web parity).
- `defineAgentEndpoint` gains `params?: TParams` Zod slot; `AgentEndpointHandlerArgs.params` typed `z.infer<TParams>` (fixes the `undefined` type lie); runner now validates path params (400 before generator runs). SSE/prime-error/AbortSignal cancellation byte-for-byte unchanged.
- Web `toResponse` honors `config.status` for plain-object returns (status symmetry with Node).
- `isZodLike` exported from `execute-stages.ts` and reused by both runners (DRY/G12).
- Changeset: `theokit` minor bump.

## Adversarial verification (dominant risks refuted)
- **Backward compat:** `response?` is a plain optional field (zero inference shift); `TParams` appended last with default `z.ZodUndefined` on the function AND (after the LOW fix) on the exported `AgentEndpointHandlerArgs`/`AgentEndpointConfig` interfaces → `<MyCtx, MyBody>` consumers bind identically. `tsc` 0 across monorepo.
- **Contract:** 500-on-mismatch is real (not bypassed), asserted by tests checking status 500 + envelope code. `Response`/`undefined`/`null` genuinely skipped in both runtimes.
- **Status symmetry:** `toResponse(result, status)` uses `status ?? 200` only in the plain-object branch; 204 + Response-passthrough branches keep their own status (regression test confirms 201-config + undefined-return → 204).
- **SSE/cancellation:** define-agent-endpoint diff contains ONLY type-generic + `params: config.params` + handler-arg type fix; no change to encodeSSE / resolveAbortSignal / generator.return().
- **Tests non-vacuous:** all new tests exercise the REAL runners (`executeRoute`/`executeWebRequest`); 4 confirmed RED before GREEN (invalid→500 Node + Web, status 201, params mismatch→400-with-generatorRan-false).

## Findings — RESOLVED
- **LOW (public-type generic order):** `AgentEndpointHandlerArgs`/`AgentEndpointConfig` prepended `TParams`, a technical break for consumers explicitly parameterizing those inferred-arg types under a minor bump. **Fixed** (`5401e4d`) — `TParams` appended last (`<TCtx, TBody, TParams>`); tsc 0 + 16 agent-endpoint tests green after.
- **LOW (web-handler.ts +29 LoC vs plan's ≤+10):** accepted — the excess is a well-named `validateResponseOutput` helper extracted to stay under the cyclomatic-complexity lint cap (15); file was already over the G6 500 budget (pre-existing, documented in plan Drawbacks).
- **INFO (pre-existing null-return Node/Web divergence):** untouched, out of scope (D3 scoped the symmetry fix to plain-object 200-vs-status). Logged.

## Decision
Dominant risks (inference shift, contract bypass, SSE regression) fully refuted; the LOW (public-type generic order) remediated. **READY_TO_MERGE.** Next: open theokit `develop → main` PR; on merge the changesets bot bumps `theokit` → 0.10.0 and publishes. TheoCode adoption (Plan B: #1 prompt.ts params, #3 routes drop `.parse()`) consumes the published version; #2 (NotFoundError adoption) needs no release.
