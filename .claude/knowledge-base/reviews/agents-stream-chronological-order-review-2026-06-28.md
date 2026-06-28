# Review — agents-stream-chronological-order (#44)

**Date:** 2026-06-28
**Slug:** agents-stream-chronological-order
**Branch:** develop (commits `919e138` impl, `ba59d44` review-fixes)
**Verdict:** READY_TO_MERGE

cycle-review ran 3 independent specialist agents in parallel (code-reviewer / test-auditor / cross-validation) over the committed diff. Initial consolidated verdict was **NEEDS_FIXES** (2 HIGH). All HIGH + MEDIUM were fixed in `ba59d44` and re-verified; remaining items are documented LOW/INFO. Final verdict **READY_TO_MERGE** (0 BLOCKER, 0 HIGH, 0 MEDIUM open).

## Final gate evidence

| Gate | Result |
|---|---|
| `pnpm --filter @theokit/agents test` | **443 passed \| 3 skipped (446)** — 0 regressions across 54 files |
| `npx tsc --noEmit -p packages/agents/tsconfig.test.json` | **0 errors** |
| `npx eslint packages/agents/src/bridge/{sdk-adapter,event-translator}.ts` | **0 warnings** |
| File size (G6) | `sdk-adapter.ts` 488 LoC, `event-translator.ts` 203 LoC — both < 500 |
| code-quality (`/code-quality`) | **PASS_WITH_CAVEATS** (cap 89) — 0 HARD; only `symbol_fab_unverifiable_typescript` (documented D2 TS member-introspection limitation, SOFT_FLOOR/INFO) |
| deps-audit | **PASS** — plan surface clean; repo-wide valibot HIGH is out of this plan's surface |
| plan-confidence | **SHIPPABLE_WITH_CAVEATS 88.8** — residual cap = pre-implementation symbol-fab-unverifiable artifact |

## Severity matrix (consolidated, post-fix)

| # | Source | Sev | Finding | Resolution |
|---|---|---|---|---|
| H1 | code-reviewer | HIGH→**FIXED** | `pump` IIFE rejection sits unhandled across consumer-backpressure macrotask gaps → Node `unhandledRejection` → process crash | `ba59d44`: rejection handler attached **at creation** (`.catch(thrown => { pumpError = {thrown} })`) + re-thrown after drain. Structural elimination of the unhandled window; error still surfaces as one event. Verified by `test_run_stream_throw_mid_iteration_emits_content_then_error`. |
| H2 | test-auditor | HIGH→**FIXED** | run-level `status: ERROR` from run.stream() (sawError short-circuit + done suppression) untested e2e | `ba59d44`: `test_run_stream_error_status_emits_error_and_suppresses_done` — asserts 1 error, 0 done. |
| M1 | test-auditor | MED→**FIXED** | run.stream() generator throwing mid-iteration untested | `test_run_stream_throw_mid_iteration_emits_content_then_error` — content drains before error, dispose runs. |
| M2 | test-auditor | MED→**FIXED** | multiple/parallel tool calls (>1 callId) untested (Set-keying) | `test_multiple_tool_calls_interleave_in_order_no_cross_callid_contamination`. |
| L-callid | code-reviewer | LOW→**FIXED** | empty/missing callId collapses to `''` in dedup Sets → wrong suppression | `isDuplicatedByDelta` + `createDeltaSink` now skip empty callId (favours visible double over silent loss). |
| L1 | test-auditor | LOW→**FIXED** | empty `thinking-delta` untested | `test_translate_empty_thinking_delta_emits_nothing`. |
| L2 | test-auditor | LOW→**FIXED** | null/undefined tool result via translator untested | `test_translate_tool_call_completed_null_result_falls_back_to_empty`. |
| L3 | test-auditor | LOW→**FIXED** | callId provenance not discriminated (fixtures set update.callId == toolCall.callId) | helpers now set distinct `inner-${callId}` so assertions prove production reads top-level `update.callId`. |
| L4 | test-auditor | LOW→**FIXED** | dispose on clean-run path not asserted | added `expect(h.disposed).toBeGreaterThanOrEqual(1)` to the chronological test. |
| L-dup | code-reviewer | LOW→**WONTFIX (out of scope)** | stream-internal duplicate `tool_call` (assistant tool_use block AND tool_call message) in no-onDelta fallback | Pre-existing run.stream() emission shape, NOT introduced by #44; the #44 dedup contract is explicitly onDelta-vs-stream. Tracked separately if the SDK is observed to double-emit. |
| L-fnsize | code-reviewer | LOW→**ACCEPTED** | `createSdkAgentStream` iterator near per-function statement budget | The enforced gate (`eslint max-lines-per-function` = 120) **passes**; the factory is cohesive (dynamic import + tool wiring + getOrCreate). Further extraction risks churn without lint benefit. |
| INFO | code-reviewer | INFO | `run_started`/`done` arrive after content (from post-completion run.stream()) | Pre-existing #40 behavior, not a #44 regression; consumers (theocode) drop both; terminal usage via `realUsageDone`. Documented in plan Drawbacks. |
| — | cross-validation | — | PLAN_IMPL_CONSISTENT — Goal met, 9/9 Coverage Matrix backed by code+test, ADRs D1-D4 implemented, EC-1 callId dedup correct, backward-compat preserved, G2 compliant | no action |

## Hard gates (cycle-review BLOCKER checks)

- Failing tests on branch: **none** (443 pass).
- New secrets committed: **none** (lint-staged secret scan clean).
- Direct commit to `main`: **no** (both commits on develop).
- Co-Authored-By trailer: **absent** (verified `grep -c` = 0 on both commits — theokit policy).
- CHANGELOG updated: **yes** via `.changeset/agents-stream-chronological-order.md` (changesets flow — per-package CHANGELOG generated on release).

## Notes / honest caveats

- **Coverage number not produced:** the workspace coverage provider is broken (vitest 4.1.9 vs 3.2.6 conflict — pre-existing env issue, not this change). Branch coverage is instead proven by explicit test-to-branch mapping: every branch of `translateInteractionUpdate`, `isDuplicatedByDelta`, `createDeltaSink`, and `mergeDeltaStream` (incl. error/throw/fallback paths) has a dedicated passing test (33 in the two touched suites).
- **HIGH-1 verification:** the unhandled-rejection crash is eliminated structurally (handler at creation); the passing stream-throw test confirms the error path still surfaces content-then-error + dispose. A runtime "no unhandledRejection under slow consumer" assertion is impractical to make deterministic in vitest; the structural fix is the correct remedy.

**Verdict: READY_TO_MERGE.**
