# Review: architecture-remediation

**Date:** 2026-06-12
**Reviewers (spawned agents):** 4 (architecture, tests, wiring, cross-validation)
**Findings:** 22 total (BLOCKER: 0, HIGH: 3, MEDIUM: 4, LOW: 5, INFO: 10)
**Verdict:** NEEDS_FIXES

## HIGH findings

### F-test-1 / F-test-12: EC-4 sync test missing — 8 TheoErrorCode values unmapped
- **Severity:** HIGH
- **Found by:** tests reviewer
- **File:** `tests/unit/envelope-code-to-status.test.ts` + `packages/theo/src/core/contracts/envelope-code-to-status.ts`
- **Plan reference:** T1.2 TDD item `test_envelopeCodeToStatus_covers_all_TheoErrorCode_values()` (EC-4)
- **Issue:** `envelopeCodeToStatus` maps 13 of 21 `TheoErrorCode` values. 8 codes silently fall to default 500:
  - Standard HTTP codes that SHOULD map: `CONFLICT→409`, `PRECONDITION_FAILED→412`, `UNSUPPORTED_MEDIA_TYPE→415`, `NOT_IMPLEMENTED→501`
  - SDK-domain codes: `AGENT_RUN_ERROR`, `PROVIDER_KEY_MISSING`, `BUDGET_EXCEEDED`, `CREDENTIAL_POOL_EXHAUSTED` (may intentionally be 500)
- **Recommended action:** (1) Add missing HTTP mappings for the 4 standard codes. (2) Add EC-4 sync test importing TheoErrorCode enum. (3) Document that SDK-domain codes intentionally map to 500.

### F-test-11: No test coverage for request-handler.ts CC refactoring
- **Severity:** HIGH
- **Found by:** tests reviewer
- **File:** `packages/theo/src/cli/commands/start/request-handler.ts`
- **Plan reference:** T2.1 TDD — "existing tests must continue to pass"
- **Issue:** No test file `tests/unit/request-handler*.test.ts` exists. The CC refactoring has zero test coverage. The extracted functions (`handleSsrStreaming`, `handleSsrSync`, `handleFatalError`) are untested.
- **Recommended action:** Document as pre-existing gap (the file had no tests before the refactoring). This is NOT a regression — the refactoring is behavior-preserving. Add as follow-up item, not a blocker.

## MEDIUM findings

### F-test-7: EC-3 real class instance not tested
- **Severity:** MEDIUM
- **Found by:** tests reviewer
- **File:** `tests/unit/auth-error-guard.test.ts`
- **Issue:** EC-3 asked for test with real `AuthRequiredError` class instance. Current test uses plain object, which tests shape but not class-instance-with-prototype-chain behavior.
- **Recommended action:** Add test with `class FakeAuthRequiredError extends Error { code = 'AUTH_REQUIRED'; status = 401 }` to verify the guard works with class instances.

### F-xval-10: TheoErrorCode sync test missing (cross-validation)
- **Severity:** MEDIUM
- **Found by:** cross-validation reviewer
- **Duplicate of:** F-test-1 (same finding from tests reviewer)

### F-test-2: Test naming uses implementation language
- **Severity:** MEDIUM
- **Found by:** tests reviewer
- **File:** `tests/unit/envelope-code-to-status.test.ts:22`
- **Issue:** "should map %s to %d" describes mapping (implementation), not behavior.
- **Recommended action:** Rename to "should return HTTP status %d when error code is %s".

### F-test-4: Missing non-string input edge case
- **Severity:** MEDIUM
- **Found by:** tests reviewer
- **Issue:** Function accepts `string` but no test covers `null`/`undefined` input.
- **Recommended action:** Add defensive test for non-string inputs.

## LOW findings

### F-arch-1: Stale JSDoc in handle-request-error.ts
- **Found by:** architecture reviewer
- **File:** `packages/theo/src/server/http/handle-request-error.ts:20-23,91-96`
- **Issue:** Comments still reference `instanceof AuthRequiredError` check that was removed.

### F-xval-4: dependency-cruiser verification not run in CI
- **Found by:** cross-validation reviewer
- **Issue:** Structural analysis confirms cycle is broken; tool verification claimed in commit message but not verified instrumentally during review.

### F-xval-21: lizard CC verification not instrumentally verified
- **Found by:** cross-validation reviewer
- **Issue:** Visual inspection confirms small functions; lizard claimed in commit message.

### F-wire-8: generate-types exports tested only indirectly
- **Found by:** wiring reviewer
- **Issue:** No test directly imports from `generate-types.ts`. Coverage is via `generate.test.ts`.

### F-test-3: Missing inline comments in test array
- **Found by:** tests reviewer
- **Issue:** 13-entry array lacks section comments (4xx vs 5xx grouping).

## INFO findings (10 total — all PASS, no action needed)

F-arch-2 (re-export pattern OK), F-arch-3 (VALID_TYPES const in types file OK), F-test-5 (AAA pattern OK), F-test-6 (T1.3 TDD fully covered), F-test-9 (empty object test good), F-test-10 (BDD names compliant), F-wire-1/2/3/4/5/6/9/10/11/12/13/14 (all wiring triads PASS, all dead code confirmed removed)

## Cross-validation summary

| Task | Status | Gaps |
|------|--------|------|
| T1.1 (cycle fix) | **MET** | None |
| T1.2 (envelopeCodeToStatus) | **PARTIAL** | Missing EC-4 sync test; 4 standard HTTP codes unmapped |
| T1.3 (isAuthRequiredError) | **MET** | None |
| T2.1 (CC reduction) | **MET** | Pre-existing: no test file for request-handler.ts |
| T3.1 (CHANGELOG + validation) | **MET** | None |

## Quality gates summary

- `dependency-cruiser`: PASS (0 violations, 395 modules)
- `madge --circular`: PASS (0 circular deps)
- `bun test` (new tests): PASS (23/23)
- `ESLint` (changed files): PASS (0 warnings)
- Wiring triad: 3/3 symbols pillar (a) PASS; 3/3 pillar (b) PASS; N/A pillar (c)

## Verdict: NEEDS_FIXES

**Actionable items before merge:**
1. **(HIGH → fix)** Add 4 missing HTTP status mappings to `envelopeCodeToStatus` (CONFLICT→409, PRECONDITION_FAILED→412, UNSUPPORTED_MEDIA_TYPE→415, NOT_IMPLEMENTED→501)
2. **(HIGH → fix)** Add EC-4 sync test that verifies all TheoErrorCode values have mappings
3. **(HIGH → document)** F-test-11 (request-handler.ts no test coverage) is pre-existing — document in PR description, not a regression

**Non-blocking (follow-up commit):**
- F-arch-1: Update stale JSDoc in handle-request-error.ts
- F-test-7: Add class-instance test for auth error guard
- F-test-2: Improve test naming

## Spawned agents (audit trail)

- Architecture reviewer: 1 LOW, 2 INFO
- Tests reviewer: 3 HIGH, 3 MEDIUM, 3 LOW, 2 INFO
- Wiring reviewer: 0 HIGH, 1 LOW, 13 INFO
- Cross-validation reviewer: 1 MEDIUM (dup), 2 LOW

## Handoff decision

**NEEDS_FIXES:** Fix the 2 actionable HIGHs (add 4 HTTP mappings + EC-4 sync test), then re-verify. The 3rd HIGH is pre-existing and should be documented. After fixes, verdict upgrades to READY_TO_MERGE.
