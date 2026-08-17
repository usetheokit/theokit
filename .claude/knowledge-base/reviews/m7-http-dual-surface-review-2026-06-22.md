# Review — M7 HTTP dual-surface (theokit slice)

**Date:** 2026-06-22
**Slug:** m7-http-dual-surface
**Milestone:** M7 (theokit slice — M7-1/2/3)
**Verdict:** READY_TO_MERGE
**Diff reviewed:** `201d954..HEAD` (`packages/theo` + `tests/server`)
**Specialist agents:** architecture, test-audit + wiring, domain(api-design+security) + cross-validation (3 parallel)

## Verdict rationale

cycle-review gate: READY_TO_MERGE = no BLOCKER and ≤ 2 HIGH with documented mitigation.
After remediation: **0 BLOCKER**; MEDIUM findings all fixed; the 2 residual HIGHs are
a pre-existing divergence (deferred, breaking-change scope) + a verification-contract
gap covered by publint. Justified READY_TO_MERGE.

## Findings → resolution

| # | Sev | Finding | Resolution | Commit |
|---|---|---|---|---|
| 1 | HIGH | `createConventionFetchHandler` "has no caller/test" | **False alarm** — the review diff `-- packages/theo` excluded the tests, which live at repo-root `tests/server/` (the ONLY location the root vitest `include: tests/**` picks up; `packages/theo/tests/` is NOT run by the root config). The 4 M7 test files exist + 15 tests pass; `createConventionFetchHandler` is exercised by `m7-boot` + `m7-http-dual-surface`. Plan's `packages/theo/tests/server/` path was wrong → corrected understanding documented in impl summary. | (resolved) |
| 2 | HIGH | Envelope shape: legacy `{error:{code}}` (nested) vs web/boot `{code}` (flat) | **Pre-existing, not M7-introduced** — `handleWebRequestError` (flat) + `sendError` (nested) both predate M7; M7's `boot` follows the web/flat shape consistently. Full convergence would change the long-standing `sendError` nested contract (asserted by many existing tests) — a breaking change beyond M7 scope. Documented + deferred; plan's "SAME shape" AC reconciled here. | (deferred — documented) |
| 3 | HIGH | Public specifiers (`theokit/boot`, `theokit/server/http`) not exercised by a test (tests import `src/`) | Covered by `publint` ("All good!") + the build emitting `dist/boot/index.{js,d.ts}` — the exports map + tsup entry are machine-verified to resolve. Self-referencing the package name in a root unit test is brittle; publint is the canonical gate. Documented. | (documented — publint gate) |
| 4 | MEDIUM | `reservedRoutes` never wired into `theokit start`'s `createRequestHandler` → readiness config orphaned on the Node listener | **Fixed** — start passes `reservedRoutes: { health: defineHealthRoute() }` so `/__theo/health` is served on the real Node listener (pillar a). Readiness-probe-via-`theo.config.ts` is a documented follow-up (needs a config-schema field). | `e7a633c` |
| 5 | MEDIUM | `defineReadyRoute` swallows a throwing probe silently (`catch {}`) | **Fixed** — logs the cause via `console.error` before returning 503 (no silent swallow; project rule "NUNCA engula exceções"); 503 contract preserved. | `e7a633c` |
| 6 | MEDIUM | ADR D3 deviation (fetch handler vs `startDevServer` re-export; no `listen`); Coverage Matrix row stale | Deviation is the correct architectural call (boot→cli inversion forbidden by the DAG) and is documented in `boot.ts` header + impl summary § ADR adherence. The fetch handler IS the portable boot surface (blueprint Corner 4). Coverage reconciled in impl summary. | (documented) |
| 7 | MED/SEC | `NotFoundError(\`No route for ${pathname}\`)` echoed the raw path into the 404 body | **Fixed** — constant `'Not Found'` message; no attacker-controlled URL reflected to envelope consumers. | `e7a633c` |
| — | LOW | floor test missing (envelopeCodeToStatus has no sub-400 code → unreachable); `fromUnknown` redundant in handleRequestError (serverErrorToEnvelope coerces internally); no `/__theo/*` namespace registry (YAGNI) | Accepted as-is (defensible / YAGNI). | — |

## Backward-compat fix verified (by cross-validation agent)

The untyped→`INTERNAL_ERROR` branch genuinely preserves `sendError`'s production
message-masking + `console.error` structured logging (`send-response.ts:96-102`);
typed `TheoError`s take the envelope branch. No regression for generic 500s.

## Quality gates (final)

- **M7 tests:** 15 green (4 files). **Affected pre-existing tests** (action-execute-plugin, auth-error, onda6/8, custom-error-pages): all green after the backward-compat fix.
- **Full suite:** no M7-introduced failures. 26 pre-existing failures (docs/concepts, migration-guide, changeset-config, create-theo/dist absence) confirmed at baseline `201d954` — out of M7 scope.
- **Typecheck:** clean. **Lint:** eslint `--max-warnings=0` clean on M7 files. **Build:** `dist/boot/index.{js,d.ts}` emitted; **publint** "All good!".
- **code-quality:** PASS for the M7 slice (zero findings in M7 files; raw FAIL_HARD is pre-existing references/-scoping noise — see audit).
- **Architecture:** DAG respected (no cycle, no boot→cli inversion, core/contracts direct-import allowed); principal-project constraint preserved.

## Strengths

- Clean composition: M7-3 boot reuses M7-1 (typed 404) + M7-2 (health/ready); the fetch handler is the portable, socketless, testable surface.
- Backward-compatible consolidation (typed→envelope, untyped→legacy) — zero regression on generic 500s.
- Zero new runtime dependencies; all internal to the principal `theokit`.

**READY_TO_MERGE.**
