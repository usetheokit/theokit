# Review — V4-T delegate() per-run config

**Date:** 2026-06-26 · **Slug:** v4t-delegate-per-run-config · **Commit:** 45f229a (+ LOW fixes)
**Reviewer:** 1 adversarial. **Verdict: READY_TO_MERGE**

## Gates
- `delegate-per-run-config.test.ts` **6 passed**; suite **420 passed / 3 skipped (53 files)**; `tsc` 0; `eslint` 0.
- plan-confidence **SHIPPABLE 94**.

## What shipped
`DelegateOptions` gains the per-run surface (`model`/`cwd`/`plugins`/`providers`/`agents`/`budgetTracker`/`conversationStorage`/`sdkTools`/`retry`/`reflection`/`maxIterations`); `delegate()` forwards them to `createSdkAgentStream` (model opt wins) + `runReflectiveLoop` (retry + custom reflection + re-resolved ceiling). Pure forwarding of surfaces the adapter/loop already accept.

## Adversarial verification (could not refute correctness)
- Backward-compat HOLDS: all fields optional; absent ⇒ today's behavior (decorator model, strategy-derived reflection, no retry, decorator ceiling).
- model precedence + reflection default + complete forwarding (8 RuntimeOverrides + retry) verified.
- DIP/G1/G2: type-only SDK imports; no orchestrator↔loop cycle reintroduced; no direct LLM call.
- Test real (captures both boundaries' args), not vacuous.

## LOW findings — RESOLVED
- **LOW-1 (parity claim overstated — `maxIterations` not mirrored):** the reviewer noted `AgentRunner.stream()` re-resolves the ceiling with `opts.maxIterations` but `delegate()` didn't. **Fixed (completed parity, not softened claim):** `DelegateOptions.maxIterations` added + `resolveLoopStrategy(strategy, opts.maxIterations ?? walk.mainLoop.maxIterations)` + `test_maxIterations_override_re_resolves_the_loop_ceiling`. (`tools`-replace + `streamFactory` remain intentionally delegate-specific: delegate uses `parentTools` merge and is the SDK collect-mode on-ramp.)
- **LOW-2 (noop branch untested):** added `ReactSubAgent` + `test_reflection_defaults_to_noop_for_react`.

## Decision
No BLOCKER/HIGH/MEDIUM; both LOWs remediated. **READY_TO_MERGE.** Closes deep-review opportunity #3's framework half — `delegate()` now has true per-run parity with `AgentRunner.stream()`, unblocking an app delegating to a sub-agent with its full runtime config.
