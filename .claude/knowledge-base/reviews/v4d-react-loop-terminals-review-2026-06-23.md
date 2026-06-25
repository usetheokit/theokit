# Review — v4d-react-loop-terminals (V4-D)

**Date:** 2026-06-23 · **Slug:** v4d-react-loop-terminals
**Commits reviewed:** `58e6e30` (feat) + `ded7488` (harden) on `develop`
**Reviewers:** 3 independent fresh-eyes agents (loop-correctness · architecture/boundaries/G-rules · test-quality)
**Verdict:** **READY_TO_MERGE** (3 PASS lenses, 0 BLOCKER, 0 HIGH, 0 MEDIUM; 3 LOW findings absorbed in `ded7488`).

## Overview
Closes the V4-D milestone (ROADMAP-v4) after `@theokit/agents@0.6.0` shipped the react multi-round foundation. Adds two outer-loop terminals to `LoopStrategy`, surfaced on `DelegationResult.finishReason`: **`no_progress`** (terminate a stuck agent — same round signature for K=2 consecutive rounds, before burning `maxIterations`) and **`step_limit`** (report a ceiling-bound stop + graceful final-round summary hint). Pure in-house loop logic — no new dependency, no `@theokit/sdk` change. Derived from the codex/opencode study (blueprint SHIPPABLE 98.5); neither reference implements no-progress, so it is a theokit value-add. ~60 LoC prod + 11 new tests.

## Lens verdicts

### Loop correctness — PASS
Verified against the real code + adversarial traces: EC-1 (no_progress only on `tool-calls` rounds), EC-2 (K=2 ⇒ terminate at round 3), EC-3 (order-independent signature), EC-4 (no_progress before ceiling) all hold. `terminalReason` cannot mislabel a natural `stop` as `step_limit`. Abort path leaves `finishReason` correctly unset. 2 LOW (key-order fragility; `tool-calls`-as-terminal leak) → **both absorbed** in `ded7488` (stableStringify + terminalReason guard).

### Architecture / boundaries / G-rules — PASS
**G1 (critical):** the new `import type { LoopFinishReason }` in `delegation-types.ts` is genuinely type-only (erased — `isolatedModules: true`), `loop-strategy.ts` is a leaf, `madge --circular` clean (57 files) — the orchestrator↔loop cycle-break is preserved. G6 (323 LoC < 500; all functions < 50 / complexity ≤ 15), G7 (no dead code/orphan export), G3 (no `any`/`@ts-ignore`; `tsc` clean), G10/G12 (honest metric + genuine DRY via `finalize`), G11 (K=2 minimal, not over-engineered). `DelegationResult.finishReason` additive/backward-compatible.

### Test quality — PASS
Per-test mutation testing (revert a prod line → observe the specific test go red) confirmed every new test is NON-tautological. `rounds===3` (K=2) is correct, not bent. The two rewritten ceiling tests (identical→progressing streams) are HONEST — forced by correct new behavior (identical stream now trips no_progress first) and STRENGTHENED with a `finishReason` assertion. Both on-ramps (delegate + AgentRunner) covered for parity. 1 LOW (reset-then-reaccumulate coverage gap) → **absorbed** in `ded7488` (`test_loop_no_progress_counter_resets_then_reaccumulates` + `test_loop_signature_key_order_independent`).

## LOW findings — all absorbed (`ded7488`)
1. `roundSignature` key-order fragility → `stableStringify` (sorted-keys canonical JSON).
2. `terminalReason` could leak `'tool-calls'` as a terminal (custom strategy) → guard maps it to `'stop'`.
3. Test coverage gap (reset-then-reaccumulate) → +2 tests (counter reset-to-zero + key-order independence).

## Validation (all green)
`@theokit/agents` **329 passed** / 3 skipped (37 files) · lint `--max-warnings=0` clean · `tsc` clean · build success · `madge --circular` none · G2 (no LLM fetch) clean · `run-reflective-loop.ts` 323 LoC.

## Conclusion
The slice meets its Goal (a react/plan-act-reflect loop now stops on a stuck or ceiling-bound round instead of silently burning `maxIterations`, observable via `DelegationResult.finishReason` + the runtime metric's `terminal` field), is architecturally clean (zero cycles, type-only boundary import), TDD-disciplined, and the review's own LOW findings were absorbed with full re-validation. **Verdict: READY_TO_MERGE.**
