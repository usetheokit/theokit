# Edge Case Review — v4d-react-loop-terminals

Date: 2026-06-23
Tasks analyzed: 3 (T1.1, T1.2, T2.1)
Edge cases found: 3 (MUST FIX: 2, SHOULD TEST: 1, DOCUMENT: 1)

## MUST FIX

### EC-1: "empty round = no_progress" contradicts the existing EC-1 `stop` behavior (unreachable test)
- **Affected task:** T2.1
- **Family:** State
- **Scenario:** The plan's D2 + T2.1 say an empty round (no tool calls AND no text) counts toward `no_progress`. But the shipped `deriveFinishReason` (`run-reflective-loop.ts:82`) already returns `'stop'` for an empty round (no error, no done, no tool_result → default `'stop'`), so the loop terminates at round 1 with `finishReason='stop'` and NEVER reaches the round-2 no_progress check. The planned `test_loop_empty_rounds_are_no_progress` would FAIL (it gets `'stop'` at round 1, not `'no_progress'` at round 2).
- **Impact:** A test that can never pass + a contradictory terminal definition (empty is both `stop` and `no_progress`).
- **Suggested fix:** Scope `no_progress` to rounds that WOULD continue (`r.finishReason === 'tool-calls'`); drop "empty round" from the `no_progress` definition (empty already terminates as `stop` per EC-1). Replace `test_loop_empty_rounds_are_no_progress` with `test_loop_empty_round_terminates_as_stop_not_no_progress` (asserts the empty round → `stop` at round 1, no_progress NOT triggered).

### EC-2: off-by-one — K=2 ("tolerates one retry") terminates at round 3, not round 2
- **Affected task:** T2.1
- **Family:** Boundary
- **Scenario:** With `stuck` counting consecutive repeats: round 1 sig=S (prev=∅, stuck=0); round 2 sig=S==prev (stuck=1 — the first repeat); round 3 sig=S==prev (stuck=2 → terminate). So K=2 ("tolerate one retry") fires at **round 3**, not round 2. The planned `test_loop_terminates_on_no_progress` asserts `rounds === 2`, which is wrong for K=2.
- **Impact:** Test expectation contradicts the documented K=2 semantics; implementer would either break the test or silently use K=1.
- **Suggested fix:** Fix the expected count to `rounds === 3` in `test_loop_terminates_on_no_progress` AND the Phase-3 integration test; state explicitly in D2: "terminate when `stuck >= 2`, i.e. on the 2nd consecutive repeat (round 3 for an all-identical stream)."

## SHOULD TEST

### EC-3: tool-call ORDER independence in the round signature
- **Affected task:** T2.1
- **Suggested test:** `test_loop_signature_is_tool_order_independent` — round calling `[read, write]` then `[write, read]` (same tools+inputs, different order) → signature equal → counts as no-progress. Asserts the "sorted" in the signature is intentional (re-ordering the same calls is NOT progress).

## DOCUMENT

### EC-4: precedence — no_progress is checked BEFORE the step_limit ceiling
- **Affected task:** T1.2, T2.1
- **Accepted risk:** When a round is both stuck and at the ceiling, `no_progress` (the earlier, more-informative signal) should win. By construction `no_progress` needs `stuck>=2` (≥3 rounds), so if `maxIterations < 3` the ceiling (`step_limit`) fires first — that is correct and intended. Document the order in `run-reflective-loop.ts`: evaluate no_progress terminal first, then the `loop.shouldContinue` ceiling.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 1 (EC-4) | 0 | 0 | 1 |
| T2.1 | 4 | 2 | 1 | (EC-4) |

**Verdict:** PLAN NEEDS ADJUSTMENT (2 MUST FIX — both in the no_progress semantics; absorb into v1.1, then `/deps-audit` → `/plan-confidence`).
