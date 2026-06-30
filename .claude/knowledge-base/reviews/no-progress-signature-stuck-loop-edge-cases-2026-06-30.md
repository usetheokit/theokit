# Discover Edge Case Review — no-progress-signature-stuck-loop

Date: 2026-06-30
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/no-progress-signature-stuck-loop-plan.md
Research questions analyzed: 5
Edge cases found: 3 (MUST FIX: 1, SHOULD TEST: 1, DOCUMENT: 1)

## MUST FIX

### EC-1: Q3 cites a non-existent test path
- **Affected question:** Q3 (tests corner)
- **Family:** Citation
- **Scenario:** Q3 cites `.claude/knowledge-base/references/opencode/packages/opencode/src/cli/cmd/run/permission.shared.test.ts`. That file does NOT exist (`src/cli/cmd/run/permission.shared.ts` exists, but the `.test.ts` lives under `test/`). During `/discover-execute` the halt-loop's "path exists" checkpoint marks Q3 BLOCKED ("path not found"), AND `/discover-confidence`'s fabricated-citation hard cap fires → blueprint capped INVALID.
- **Impact:** the tests corner goes unanswered → coverage < 100% → blueprint INVALID; the test-key evidence (how doom_loop is asserted) is lost.
- **Suggested fix:** repoint Q3 to the real paths — `packages/opencode/test/cli/run/permission.shared.test.ts` and `packages/opencode/test/agent/agent.test.ts` (both confirmed to contain `doom`).

## SHOULD TEST

### EC-2: codex Q2 source is a prose spec, not executable detection code
- **Affected question:** Q2 (techniques corner)
- **Suggested halt-loop checkpoint:** before marking Q2 done, label the codex finding as a **spec/convention** (`ext/goal/src/spec.rs` is the goal-status *specification* text, threshold ≥3 consecutive turns) rather than a runtime detector — so the blueprint does not over-claim codex has an algorithmic dedup. The convention still counts as an independent reference for the "≥3 consecutive identical → terminate" threshold, but its kind must be stated honestly.

## DOCUMENT

### EC-3: doom_loop detector may be split between processor.ts and agent.ts
- **Accepted risk:** Q1/Q4 scope the detector to `session/processor.ts` (confirmed: `DOOM_LOOP_THRESHOLD=3` at line 35, identity check at ~522-539). `packages/opencode/src/agent/agent.ts` also references `doom` but, per the grep, only wires the `doom_loop` permission/config — the detection equality lives in `processor.ts`. If `/discover-execute` finds the window/threshold partly in `agent.ts`, it should follow the call-site; processor.ts remains the primary hotspot. No plan change needed (the method already greps both via the config question Q4).

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 0 | 0 | 0 | 0 |
| Q2 | 1 | 0 | 1 | 0 |
| Q3 | 1 | 1 | 0 | 0 |
| Q4 | 0 | 0 | 0 | 0 |
| Q5 | 0 | 0 | 0 | 0 |
| (cross) Q1/Q4 | 1 | 0 | 0 | 1 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (1 MUST FIX — Q3 path)
