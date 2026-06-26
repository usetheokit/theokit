# Review — V4-N loop outcome fidelity

**Date:** 2026-06-25
**Slug:** v4n-loop-outcome-fidelity
**Commits:** `da41c36` (artifacts), `6f1a757` (feat) + L1/changeset follow-up on `develop`
**Reviewers:** 2 independent agents (adversarial + cross-validation).
**Verdict:** **READY_TO_MERGE**

## Severity matrix

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| HIGH | 0 |
| MEDIUM | 1 (M1 — pre-existing adapter 0-usage; logged as next slice) |
| LOW | 2 (L1 fixed; L2 accepted) |
| INFO | 2 |

## Adversarial — READY_TO_MERGE

- **Correlation correct:** `callInputs` map is per-round (declared in `consumeOneRound`, not leaked); multiple calls pair by callId (not index — `byId` test guards cross-pairing); real SDK emits tool_call before tool_result.
- **`call?.input ?? event.input ?? {}` fallback** is load-bearing for backward-compat: real tool_call input wins; the `event.input` fallback preserves legacy/test `tool_result`-with-inline-input shapes (without it, the no_progress tests broke). Prior behavior was `event.input ?? {}`.
- **no_progress:** existing tests green (fallback preserves their signatures); on the real path signatures become MORE specific (real command) — the safer direction (fewer false collisions). No regression.
- **Backward compat:** only 2 `DelegationResult` constructors (both in run-reflective-loop, both updated); delegate/run delegate to the loop; new token fields optional; `tokens` total preserved.
- **Helpers (pushToolResult/applyDone/accumulateEvent):** behavior-identical, complexity in budget.
- **Tests non-vacuous** (5/5, byref/byId assertions).

### MEDIUM M1 (logged as the next framework fix — NOT a V4-N defect)
- **Finding:** the split-usage plumbing is correct, but the SDK adapter (`event-translator.ts` FINISHED→done, `sdk-adapter.ts` fallback done) emits `usage: {0,0,0}` hardcoded, so `tokensInput`/`tokensOutput` (and `tokens`) are 0 on the real SDK path. NOT a V4-N regression (the prior summed `tokens` was 0 too); the tool-call id+input half DOES flow on the real path.
- **Disposition:** documented in the changeset; this is the immediate next framework fix — the adapter must emit real per-turn token counts (from `run.wait().usage`) on the `done` event — needed for theocode's usage analytics to flow after the adoption. Tracked as the next slice (V4-N.1 / adapter real-usage).

### LOW
- **L1 (FIXED):** the `consumeOneRound` JSDoc was orphaned above `RoundSignals` after the helper extraction — moved to immediately precede `consumeOneRound`.
- **L2 (accepted):** out-of-order `tool_result` (before its `tool_call`) would degrade input to `{}`; not reachable on the real SDK (tool_call precedes tool_result); documented assumption.

## Cross-validation — READY_TO_MERGE

- **Coverage Matrix 6/6** addressed (G1-G6), each with code+test evidence.
- **Goal metric** test asserts every clause (id+input+output; split usage; total preserved).
- **ADRs D1/D2** match the implementation.
- **Edge cases EC-1 (multiple by id), EC-2 (unmatched → {})** each have a passing test.
- **All plan tests present** (5 in the new file).
- **"No new dependency / no manifest change"** verified.
- **Backward compat** + the earlier-iteration breakage (5 tests) restored by the `?? event.input` fallback; full suite green.
- **Deviations disclosed** (the `event.input` fallback + helper extraction — both documented inline + in the commit).

## Validation state

- `npx vitest run` (packages/agents): 392 passed, 3 skipped.
- `npx tsc --noEmit -p packages/agents/tsconfig.test.json`: exit 0.
- Lint on changed files: exit 0.

## Decision

No BLOCKER/HIGH; the one MEDIUM (M1) is a pre-existing adapter limitation V4-N merely exposes, documented + logged as the immediate next framework fix (adapter real-usage emission). V4-N's own scope (the loop preserving id+input+split-usage plumbing) is correct, tested, and backward-compatible. **READY_TO_MERGE.**
