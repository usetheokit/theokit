# Edge Case Review — architecture-remediation

Date: 2026-06-12
Tasks analyzed: 7
Edge cases found: 7 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: Cycle claims not validated against real dependency-cruiser output
- **Affected task:** T2.1, T3.1, T3.2 (all cycle-breaking tasks)
- **Family:** State
- **Scenario:** The plan claims 6 dependency cycles exist based on the `loop-architecture-review` module-level analysis (48 abstract modules). However, running `npx dependency-cruiser --output-type err packages/theo/src/server/` returns **0 errors** and `npx dependency-cruiser --output-type err packages/agents/src/` also returns **0 violations**. The project's `.dependency-cruiser.cjs` (14 rules) does not flag any cycles.
- **Impact:** The plan may be solving phantom problems. The architecture review detected cycles at an *abstract module grouping* level (e.g., grouping all `server/auth/*.ts` as "server-auth" module), but the actual file-level import graph is acyclic. The refactoring work (Phases 2+3) may be unnecessary or misdirected — the DRY extractions (Phase 1) remain valid regardless.
- **Suggested fix:** Before implementing Phases 2 and 3, run `npx dependency-cruiser --output-type err --do-not-follow node_modules packages/` and `npx madge --circular packages/theo/src/ packages/agents/src/` to confirm whether real file-level cycles exist. If depcruise passes clean, the cycle-breaking tasks (T2.1, T3.1, T3.2) should be downgraded from CRITICAL to INFORMATIONAL and the plan re-scoped to focus on DRY extractions (Phase 1) and CC reduction (T3.3) only. The depcruise output is the source of truth — the abstract module grouping in the review is a heuristic.

### EC-2: T2.1 misses 6 additional importers of `types.ts`
- **Affected task:** T2.1
- **Family:** State
- **Scenario:** The plan identifies 2 files importing from `types.ts` (`agent-execution-context.ts:9`, `policies.ts:9`). But grep reveals **8 total importers**: `bridge/agent-execution-context.ts`, `bridge/walk-agent-metadata.ts`, `index.ts`, `decorators-entry.ts`, `decorators/policies.ts`, `decorators/main-loop.ts`, `decorators/tool.ts`, `decorators/agent.ts`. Moving `types.ts` to `contracts/types.ts` without updating all 8 importers will break the build.
- **Suggested fix:** Update T2.1 to list all 8 importers. The compat re-export (`types.ts` → re-exports from `./contracts/`) handles `index.ts` and `decorators-entry.ts` (they import from `./types.js` which would still resolve). But `bridge/walk-agent-metadata.ts` and 3 additional `decorators/*.ts` files need explicit import path updates or the compat shim.

## SHOULD TEST

### EC-3: `isAuthRequiredError` shape-only guard drops `instanceof` fast path
- **Affected task:** T1.2
- **Suggested test:** `test_isAuthRequiredError_with_real_AuthRequiredError_instance()` — verify that an actual `AuthRequiredError` instance (with `code='AUTH_REQUIRED'` and `status=401` set in constructor) is correctly detected by the shape-only guard. The existing code uses `instanceof` as a fast path before falling back to duck-type. Dropping `instanceof` is correct (Vite HMR breaks it), but a test confirming the real class passes the shape check is prudent.

### EC-4: `envelopeCodeToStatus` should stay in sync with `TheoErrorCode` enum
- **Affected task:** T1.1
- **Suggested test:** `test_envelopeCodeToStatus_covers_all_TheoErrorCode_values()` — import all `TheoErrorCode` values from `error-envelope.ts` and assert each one has a mapping in `envelopeCodeToStatus`. This prevents future drift where a new error code is added to the enum but not to the status mapping.

### EC-5: `csp-report.ts` has a second caller in `vite-plugin/api-middleware.ts`
- **Affected task:** T3.2
- **Suggested test:** After changing `handleCspReport` to accept a logger parameter, verify `vite-plugin/api-middleware.ts:94` still compiles. This caller already passes `{ auditLogger: ctx.auditLogger, onViolation: ctx.onCspViolation }` as options — the logger parameter change must be compatible with this call pattern. Add a compilation check to T3.2's acceptance criteria.

## DOCUMENT

### EC-6: `web-handler.ts` is in `server/`, not `core/` — cycles C5/C6 may be misclassified
- **Accepted risk:** The architecture review classified `web-handler.ts` under "theokit-core" module, but the file lives at `packages/theo/src/server/web-handler.ts`, which is the `server` module per `architecture.md` v3. The edge `server → security` is an **allowed** dependency direction (`server → core, cache, config, devtools, services`). The `server → security` edge was not explicitly listed in `architecture.md`, but `security/` is a sub-directory of `server/` — it's an intra-module import, not a cross-module dependency. This means cycles C5 and C6 may not violate any architectural boundary. The DIP injection in T3.2 is still a good practice (reduces coupling between peer sub-modules), but it's an improvement, not a critical fix.

### EC-7: `rate-limit → http` edge (`parseCookieHeader`) remains after cycle breaking
- **Accepted risk:** T3.1 breaks `auth → rate-limit` and `http → auth` edges but leaves `rate-limit/rate-limit-per-route.ts:10 → http/cookies.ts` intact. This single-direction edge is not a cycle. `parseCookieHeader` is a pure utility function in `http/cookies.ts` — the coupling is narrow and functional. Moving it to a shared location would be YAGNI (only 2 callers).

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 1 | 0 |
| T1.2 | 1 | 0 | 1 | 0 |
| T2.1 | 1 | 1 | 0 | 0 |
| T3.1 | 1 | 0 | 0 | 1 |
| T3.2 | 2 | 0 | 1 | 1 |
| T3.3 | 0 | 0 | 0 | 0 |
| T4.1 | 1 | 1 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT

**Key finding:** EC-1 is the most impactful edge case. The plan's primary justification (6 CRITICAL dependency cycles) may be based on abstract module-level heuristics that do not correspond to real file-level cycles detectable by `dependency-cruiser`. Before investing 8-12 hours on cycle-breaking refactoring:

1. Run `npx madge --circular --extensions ts,tsx packages/` to confirm/deny file-level cycles.
2. If no real cycles exist: re-scope the plan to Phase 1 (DRY extractions — valid regardless) + T3.3 (CC reduction — valid regardless). Downgrade Phases 2 and 3 cycle-breaking tasks to "nice-to-have coupling reduction."
3. If real cycles exist at file level: proceed as planned, but fix EC-2 (8 importers, not 2).

EC-2 is a straightforward fix (list all importers). EC-3, EC-4, EC-5 are test additions.
