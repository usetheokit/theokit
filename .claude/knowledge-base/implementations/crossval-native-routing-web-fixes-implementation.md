# Implementation Contract — crossval-native-routing-web-fixes

**Plan:** `.claude/knowledge-base/plans/crossval-native-routing-web-fixes-plan.md` (v1.4, SHIPPABLE_WITH_CAVEATS 70)
**Progress (gitignored):** `.claude/knowledge-base/implementations/.progress-crossval-native-routing-web-fixes.json`
**SEPA:** `.claude/agents/implement-crossval-native-routing-web-fixes-2026-06-16/sepa.md`
**Started:** 2026-06-16 · Branch: `develop`

The halt-loop drives the 8 tasks below in dependency order. Each task runs RED → GREEN → REFACTOR → WIRING → COMMIT with SEPA consulted 3×. Full TDD blocks, Acceptance Criteria, and DoD live in the plan — this file is the working index.

## Task order (dependency-resolved)

| # | Task | Phase | Depends on | Key files | RED target |
|---|---|---|---|---|---|
| 1 | T1.1 — `findRebuildCwd` | 1 | — | `scripts/preflight-native-bindings.mjs` | `tests/unit/preflight-native-bindings.test.ts` (4 EC-1 cases + EC-14) |
| 2 | T1.2 — real `ensureNativeBindings` | 1 | T1.1 | `scripts/preflight-native-bindings.mjs` | same file (module-shape + EC-6/7/8) |
| 3 | T1.3 — `engines.node` floor | 1 | T1.2 | root + 4 `package.json` | `tests/unit/engines-node-floor.test.ts` (NEW) |
| 4 | T2.1 — dynamic-segment scan | 2 | T1.3 | `router/scan.ts`, `core/contracts/route-node.ts` | `tests/unit/router-dynamic-segments.test.ts` (NEW) |
| 5 | T2.2 — generate `:param`/`*` | 2 | T2.1 | `router/generate.ts` | `tests/unit/router-dynamic-segments.test.ts` + `router-generate-golden.test.ts` (NEW) |
| 6 | T2.3 — dynamic route e2e | 2 | T2.2 | `tests/e2e/app-router-dynamic-routes.spec.ts` (NEW) | Playwright |
| 7 | T3.1 — thread `matchRoute` params | 3 | T1.3 | `server/web-handler.ts`, `server/http/node-web-adapter.ts` | `tests/integration/web-handler-params.test.ts` (NEW) |
| 8 | T3.2 — Web-path middleware | 3 | T3.1 | `server/web-handler.ts`, `server/http/web-middleware-runner.ts` (NEW) | same integration file |

## Guardrails carried into every iteration (SEPA enforces)

- **D3:** `router/` MUST NOT import from `server/` (architecture.md DAG). `[CRITICAL]` if violated.
- **D4:** Phase 3 does NOT touch `executeRoute` or the 6 cloud adapters; no full pipeline rewrite.
- **EC-3:** CSRF gate fires before user middleware on the Web path.
- **EC-4/5:** `parseSegment` build-errors on `[[...]]` + invalid param charset.
- **G6:** `web-handler.ts` (572 LoC) must NOT grow — extract to sibling files.
- **Backward compat:** additive `opts.params`/`opts.middleware`, additive `RouteNode.dynamic`, stable `scanRoutes`/`executeWebRequest` signatures.
- **TDD-first:** never edit `preflight-native-bindings.test.ts` to pass — implement against it.

## Terminal

`<promise>IMPLEMENTATION_COMPLETE</promise>` only when all 8 tasks are `committed` (or honestly `blocked` with reason) AND every Acceptance/DoD checkbox holds. Then Step 5 runs `run_validation.py`.
