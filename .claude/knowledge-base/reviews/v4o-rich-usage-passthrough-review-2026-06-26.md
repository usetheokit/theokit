# Review — V4-O rich usage passthrough

**Date:** 2026-06-26 · **Slug:** v4o-rich-usage-passthrough · **Commit:** d69f7b4 (+ LOW-1 JSDoc fix)
**Reviewers:** 2 independent (adversarial + cross-validation). **Verdict: READY_TO_MERGE**

## Severity matrix (after LOW-1 remediation)
| BLOCKER | HIGH | MEDIUM | LOW | INFO |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 (L1 fixed) | 1 |

## Adversarial — READY_TO_MERGE
- Exactly-one-terminal HOLDS: V4-O only enriches `realUsageDone`'s payload; the V4-N.1 done-suppression + `!sawError` single re-emit are untouched.
- Backward-compat HOLDS: new fields optional on `DoneEvent.usage` + `DelegationResult`; buckets referenced only in the 4 diff files; `test_done_carries_real_usage_from_wait` `toEqual` correctly updated (buckets always emitted, default 0).
- Accumulation CORRECT: `accumulateUsage` covers all 7 usage fields; `(acc.x ?? 0) + r.x` everywhere; `applyDone` reads `?? 0`; loop test proves 2-round summation (6/10/4).
- DIP/G2 HOLDS: SDK `TokenUsage` never crosses the bridge — inline structural types with 3 named numbers (ADR D1 alt-b honored); no `@theokit/sdk` type import added.
- Complexity G6 HOLDS: `accumulateUsage` extraction reduced `runReflectiveLoopStream`; lint clean at `--max-warnings=0`.
- Edges COVERED: partial/omitted buckets → triple `?? 0` defense (adapter, applyDone, accumulator); error round → buckets stay 0; single-shot → routes through the loop, seeded 0.
- Tests REAL, not tautological.

## Cross-validation — READY_TO_MERGE
- Coverage Matrix 6/6 confirmed with code + assertion evidence (G1..G6).
- ADR D1 (passthrough, no SDK type leak) + D2 (optional fields) respected.
- Goal metric passes (`adapter-real-usage.test.ts` 6 passed): done + DelegationResult carry the buckets end-to-end.
- All 4 promised sites edited; no missed construction site (`delegate()` shares the loop driver; the single `DelegationResult` literal at run-reflective-loop seeds buckets; `event-translator.ts` done is suppressed — correctly left unedited).
- Gates: suite 399 passed / 3 skipped; tsc 0; eslint 0; sizes under 500; changeset present (minor).

## LOW-1 (RESOLVED)
- **Finding:** JSDoc/ADR wording "Absent for the single-shot path" was imprecise — every loop-driven run seeds the buckets to 0 (not absent), since `delegate()` and `AgentRunner.run` share `runReflectiveLoop`. Carried forward from V4-N's identical wording.
- **Remediation:** `delegation-types.ts` JSDoc updated to "0 on any loop-driven run; the loop seeds them; Optional for type compat."

## INFO
- The diff reformatted 6 type-guard one-liners in `agent-stream-events.ts` (prettier reflow, no behavior change).

## Decision
No BLOCKER/HIGH/MEDIUM; the one LOW (doc wording) fixed. **READY_TO_MERGE.** Closes the usage-richness regression the theocode loop-adoption discover found — unblocks the zero-regression collapse.
