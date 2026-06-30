# Edge Case Review — no-progress-signature-tool-calls-only

Date: 2026-06-30
Tasks analyzed: 2 (T1.1, T2.1)
Cases found: 4 (EDGE: 2, NEGATIVE: 2 | MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 3)

## MUST FIX

(none — the change is a one-line fingerprint narrowing on an internal function with a single call-site; the `:511` TOOL_CALLS gate already protects the only dangerous adjacency, text-only rounds.)

## SHOULD TEST

### EC-1: negative test (varying input) must terminate deterministically
- **Affected task:** T1.1 (RED test 2 — "different tool inputs do NOT trigger no_progress")
- **Kind:** EDGE (boundary of the detector — distinct signatures must NOT trip it)
- **Suggested test:** `test_varying_tool_input_runs_to_step_limit_not_no_progress` — the fake factory must yield a BOUNDED, deterministic sequence (e.g., `resolveLoopStrategy('plan-act-reflect', 3)` + a factory that yields `read` with input `{n: round}` each round). Assert `result.finishReason === 'step_limit'` (it reached the ceiling because every round differed) AND explicitly `!== 'no_progress'`. Without a bounded maxIterations the assertion is ambiguous (the loop could run long). Fold the explicit `maxIterations` into the test setup.

## DOCUMENT

### EC-2: identical tool re-issue after a transient failure is treated as no-progress at K=2
- **Kind:** NEGATIVE (a failure-then-retry that does not change input)
- **Accepted risk:** transient retries are handled at the SDK layer (`withRetry`, `RunReflectiveLoopConfig.retry`), NOT as separate loop rounds. A LOOP round that re-issues the identical tool+input after a failure without changing anything IS no-progress by definition. Intended per ADR D2 ("K=2 tolerates one retry"). Already captured in the plan's Drawbacks table (polling row) — no change needed.

### EC-3: empty `toolCalls` on a TOOL_CALLS round → empty signature
- **Kind:** EDGE (degenerate extreme)
- **Accepted risk:** not reachable — `deriveFinishReason` only sets `finishReason === 'tool-calls'` when ≥1 tool call occurred, so the `:511` gate never admits an empty-toolCalls round into the no_progress check. Already documented in the plan's Deep Dives (T1.1). No guard added (YAGNI).

### EC-4: non-serializable / circular tool input would break `stableStringify`
- **Kind:** NEGATIVE (malformed input)
- **Accepted risk:** tool inputs originate from the LLM's `tool_call.arguments`, which are JSON-parsed (acyclic, scalar/object/array only). A circular reference cannot reach `stableStringify`. `stableStringify` already handles `undefined`/`null`/scalars (`:100-101`). No guard added (boundary is the JSON parse upstream).

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 2 | 2 | 0 | 1 | 3 |
| T2.1 | 0 | 0 | 0 | 0 | 0 |

**Coverage check:** T1.1 (the only input-boundary task) has both EDGE (empty/varying signatures) and NEGATIVE (retry-after-failure, circular input) lenses considered. T2.1 is a validation gate (no input boundary).

**Verdict:** PLAN OK (absorb EC-1 SHOULD TEST into T1.1 TDD — make the negative test's `maxIterations` explicit)
