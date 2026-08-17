# Review — unified-agent-surface (M2)

**Date:** 2026-07-04
**Slug:** unified-agent-surface
**Milestone:** M2 (theokit-ai-first, Eixo B)
**Verdict:** READY_TO_MERGE

## Scope reviewed

6 commits `ed0cf95..87cbe2b` on `develop`. 27 files, +1677/-3. The `agents/*.ts` zero-config
convention: `defineAgent` surface, `agents/` scan + manifest, dev+prod endpoint mount, typed
`useAgent` client + `.theokit/agents.d.ts` codegen, ADR 0037, ROADMAP correction.

## Method

Two independent reviewers spawned in parallel (architecture/boundary + test-coverage/wiring),
plus a self adversarial pass. Findings triaged by severity; all HIGH/MEDIUM addressed with tests.

## Findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| HIGH | Agent endpoints had NO CSRF — cross-origin POST spends LLM tokens | `mountAgent` (shared dev+prod point) enforces `X-Theo-Action`+Origin at `csrfMode` (strict default) → 403 before the SDK. Tests: CSRF-missing 403, csrf-off 400. |
| HIGH | `tryServeAgent` (prod) + `createAgentMiddleware` (dev) untested | `tests/unit/agent-handlers.test.ts`: prefix ownership, not-found fall-through, 405, factory wiring. |
| HIGH | Negative case asserted `instanceof` only, not message | `mount-agent` now asserts the message names the source file. |
| HIGH/WARN | EC-3 route collision unimplemented / no detection | Reframed as RESERVED prefix (agent wins dev+prod, like `/api/__actions/`) — documented in ADR 0037; `scanAgents` rejects bare `index.ts` (empty name). |
| MEDIUM | `asAgentStream` cast has no compile-time guard | Documented sanctioned narrowing (runtime values ARE AgentStreamEvents; translator ignores unknown variants). ADR 0037. |
| MEDIUM | EC-2 (no-input default) + hook binding tests missing | Type test: no-input agent infers `unknown` (safe, never `any`) — honest deviation from blueprint `{message}` nicety. |
| WARN | Rate-limit absent in dev agent-middleware | Resolved at the CSRF layer (shared mountAgent); rate-limit parity matches the dev action-middleware baseline (dev does not flat-rate-limit actions either). |
| LOW | consume-ui-message-stream error path untested | error-mid-stream test added (partial text preserved, no throw). |
| INFO | sdk-adapter.ts 604 LoC | Pre-existing, not M2. Tracked. |

## Gates

- **G1 (dep direction):** PASS — `@theokit/agents` imports zero theo core; theo→agents only.
- **G2 (SDK-only runtime):** PASS — no direct LLM calls; wires `createSdkAgentStream`.
- **Typecheck:** workspace `pnpm typecheck` = 0 errors (gate green).
- **Lint:** 0 warnings across changed files.
- **Tests:** 49 M2 tests green (agents 12 + theo 37). 0 real regressions (1 found+fixed: the
  bare-import typecheck-gate break).

## Pre-existing failures (NOT M2, not blocking)

12 files / ~32 tests fail on the baseline unrelated to agents: removed `create-theo` package
smoke, missing `docs/migration/*`, missing `cli/cleanup/`, `usetheo-ui` contract, version drift.
None reference any agents/ symbol.

## DoD verification

- [x] `agents/<name>.ts` auto-serves the SSE route dev + built — 1 file, 0 manual wiring.
- [x] Typed client hook inferred end-to-end from `defineAgent({input})` (`.theokit/agents.d.ts`).
- [x] `@Agent` decorator ↔ file convention convergence recorded in ADR 0037.
