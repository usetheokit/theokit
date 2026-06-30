# Implementation Summary — no-progress-signature-tool-calls-only (theokit#53)

**Date:** 2026-06-30
**Plan:** `.claude/knowledge-base/plans/no-progress-signature-tool-calls-only-plan.md` (v1.1, plan-confidence SHIPPABLE 97.2)
**Commit:** `3c2bf61` — `fix(agents): no_progress signature keys on tool-calls only (closes #53)`
**Verdict:** IMPLEMENTATION_COMPLETE

## Tasks

### T1.1 — Remove `responseText` from the no-progress fingerprint ✅
- **RED → GREEN proven:** the positive regression test (`fires no_progress on identical tool-calls despite drifting assistant text`) FAILED before the fix (`expected 'step_limit' to be 'no_progress'`) and PASSES after. Evidence captured live.
- **Fix:** `packages/agents/src/loop/run-reflective-loop.ts` — `roundSignature` dropped the `text` parameter (signature = sorted `name:stableStringify(input)` joined); call-site `:512` updated to `roundSignature(r.toolCalls)`; doc comment updated to cite theokit#53 + opencode `doom_loop`.
- **Tests added:** `packages/agents/tests/unit/no-progress-signature.test.ts` (3 deterministic tests):
  1. identical tool-calls + drifting text → `no_progress` within ≤ 3 rounds (the bug).
  2. varying tool input ({n:round}) → `step_limit`, never `no_progress` (no false positive).
  3. text-only round → `stop` (the `:511` TOOL_CALLS-gate edge guard).
- **Regression fixed:** `runtime-overrides.test.ts` harness yielded identical tool calls and relied on unique assistant TEXT to simulate progress (codified the old buggy behavior). Updated to vary the tool NAME per round (`t-${i}` — genuine progress: a different action each round) so `test_maxIterations_override_caps_loop_with_step_limit` legitimately reaches the ceiling. Comments updated to reflect the corrected semantics.

### T2.1 — Integration validation ✅
- Full `@theokit/agents` suite: **485 passed, 3 skipped, 0 failed**.
- `npx tsc --noEmit -p packages/agents/tsconfig.test.json`: exit 0.
- `npx eslint` (3 changed files, `--max-warnings=0`): exit 0.
- `pnpm --filter @theokit/agents build` (tsup DTS): success.

## Wiring triad
- **Caller:** the loop's no_progress check at `run-reflective-loop.ts:511-515` is the production caller of `roundSignature` (unchanged call-site, corrected argument).
- **Integration test:** `tests/integration/runtime-overrides.test.ts` + `tests/integration/reflective-loop-wiring.test.ts` exercise the loop end-to-end through both on-ramps (delegate + AgentRunner).
- **Runtime metric:** the existing `[THEO_AGENT_MAINLOOP_RUNTIME_APPLIED]` log line already surfaces `terminal: 'no_progress'` — observable in production (it is exactly the metric that revealed `terminal: 'stop'` for the spin in theokit#53).

## ADRs honored
- D1 (key on tool-calls only) ✅ — text dropped from signature.
- D2 (keep NO_PROGRESS_THRESHOLD = 2) ✅ — constant unchanged; tests assert no_progress by round 3 (K=2).
- D3 (no new dependency) ✅ — reused in-file `stableStringify`; `/deps-audit` PASS.

## Global DoD
- [x] roundSignature keys on tool-calls only; single call-site updated; comment updated.
- [x] 3 new deterministic tests (positive RED→GREEN, negative, text-only); full suite green.
- [x] tsc 0, eslint 0, DTS build success.
- [x] Changeset added (`@theokit/agents` patch) citing theokit#53.
- [x] No new dependency.
