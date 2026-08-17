# Review — v4-mainloop-reflective-runtime

**Date:** 2026-06-23 · **Slug:** v4-mainloop-reflective-runtime
**Commits reviewed:** `44fe692..90ad43e` (T1.1–T4.1) on `develop` (no PR — local slice)
**Reviewers:** 5 independent agents (architecture/boundaries · loop correctness · test quality · plan↔impl cross-validation · sdk-runtime/type-safety/conventions)
**Verdict:** **NEEDS_FIXES** (1 BLOCKER, 1 HIGH, 2 MEDIUM, 6 LOW) — `/release` MUST NOT run.

## Overview
Gives runtime to `@MainLoop({ strategy })` (V4-A metadata-only gap): `LoopStrategy`/`ReflectionStrategy` (Zod) + `runReflectiveLoop` multi-round driver + `delegate()` strategy-branch + `AgentRunner.builder()` imperative twin. ~535 LoC prod + ~535 LoC tests; 295/3-skip suite green; build OK; G2 clean.

## BLOCKER

### B1 — The multi-round loop is DEAD against the real SDK (Goal NOT met at runtime)
- **Found independently by 2 reviewers (sdk-runtime + test-quality).** Verified by hand.
- `bridge/sdk-adapter.ts:147-153` ALWAYS appends a synthetic `done` event after `run.stream()` ends — with **no `finishReason`**. `bridge/event-translator.ts:86-89` also emits the translated `done` with **no `finishReason`**.
- `loop/run-reflective-loop.ts:69-79` `deriveFinishReason` checks `sawDone` BEFORE `sawToolResult`: with `sawDone=true, doneFinishReason=''` it returns `'stop'`. So in production EVERY round ends `'stop'` → `loop.shouldContinue` is false AND `ladderReflectionStrategy.reflect({stop})` is `{continue:false}` → **the loop terminates at round 1 for `plan-act-reflect` AND `react`.**
- **Consequence:** `@MainLoop({strategy:'plan-act-reflect'})` still effectively runs ONE round against the real SDK. The V4 Goal metric ("zero `@MainLoop` strategies remain metadata-only") does NOT hold at runtime — only in tests.
- **Root design issue:** the continuation signal was keyed on the AI-SDK *inner-loop* signal `finishReason==='tool-calls'` (Mastra `stopWhen` is a within-one-stream step signal). But `@theokit/sdk`'s `Run.stream()` runs the FULL inner tool loop itself and always completes a turn with `done`. The OUTER reflective loop (re-prompt between complete turns) therefore cannot gate on `finishReason` — it must gate on the **ReflectionStrategy's decision** (reflect-and-refine until done/ceiling), bounded by `maxIterations`.
- **Fix (next cycle — design rework, not a patch):** rework the continuation so the OUTER loop re-prompts based on reflection, not `finishReason==='tool-calls'`; OR propagate a real terminal signal from `event-translator`/`sdk-adapter` if the SDK can express "more work pending". THEN pin it with a production-shape integration test (see H1).

## HIGH

### H1 — Every multi-round test uses event shapes the real adapter never emits (masks B1)
- `tests/**`: continuing rounds are scripted as `[[toolResult],[done]]` (round 1 has NO `done`) or `{type:'done',finishReason:'tool-calls'}`. The real `createSdkAgentStream` emits neither (it always appends a `done` with no `finishReason`). The green suite gives false confidence.
- **Fix:** add an integration test that drives the REAL `createSdkAgentStream`→`translateSdkEvent` path with a fake SDK `run.stream()` emitting realistic messages + a terminal `done` with NO `finishReason`, and assert round count. It must currently FAIL — it pins B1.

## MEDIUM

### M1 — simple-chat parity break between the two on-ramps (breaks D4 "same runtime")
- `delegate(simple-chat)` → `runSingleShot` (no metric, `DelegationResult` WITHOUT `rounds`, cost-overwrite). `AgentRunner(simple-chat)` → `runReflectiveLoop` (emits `THEO_AGENT_MAINLOOP_RUNTIME_APPLIED {strategy:'simple-chat'}`, returns `rounds:1`, cost-accumulate). Output count identical (1 round) so the regression test passes, but the result SHAPE + emitted metric diverge — contradicting ADR D4 "builder + decorator → the same runtime". EC-2 test covers only the delegate path. (`agent-orchestrator.ts:209` vs `agent-runner.ts:71-78`.)
- **Fix:** collapse `delegate(simple-chat)` onto `runReflectiveLoop` too (DRY — `shouldContinue:()=>false` already guarantees 1 round), or add `rounds:1` to the single-shot accumulator + branch AgentRunner. Eliminates the divergence class.

### M2 — Raw stream-iterator exception is untyped on the loop path
- `runSingleShot` wraps unknown stream errors as typed `DelegationError` (`agent-orchestrator.ts:154-157`); `runReflectiveLoop` has NO try/catch around `consumeOneRound`, so a raw iterator/SDK-import exception propagates untyped. `AgentRunner` simple-chat thus surfaces a different error type than `delegate()` simple-chat for the same SDK failure.
- **Fix:** wrap the `for await` in `consumeOneRound` in try/catch mirroring `runSingleShot:154-157`.

## LOW
- **L1** `run-reflective-loop.ts:145,182` — on abort-exit `acc.rounds` stays `0` (metric lost on cancellation); normal path sets it. Set `acc.rounds = round` before the abort return.
- **L2** `run-reflective-loop.ts:150` + `reflection-strategy.ts:74` — `react` (noop) round-2+ prompt carries an empty `[reflection] ` marker. Append the block only when `feedback` is non-empty.
- **L3** `agent-orchestrator.ts:141-143` — post-loop budget re-check is unreachable (loop already throws per-round). Harmless dead-ish defense; remove if a dead-code audit flags it.
- **L4** test gaps (incremental): `length` finishReason never derived (dead enum member); `text_delta` accumulation branch uncovered; budget boundary `==`/negative/zero untested; `noopReflectionStrategy` not directly unit-tested; missing-apiKey path untested; parent-budget-clamp (D4) untested; mid-stream abort (vs between-rounds) uncovered.
- **L5** `agent-runner.ts:50-56` — `streamEnabled` is a documented-no-op (acceptable per G10; optional: emit `THEO_AGENT_STREAM_FLAG_NO_OP` or drop the param until non-streaming exists — YAGNI).
- **L6** (pre-existing, not this diff) — `dependency-cruiser` direction rules are scoped to `packages/theo` only; they don't police the intra-`packages/agents` DAG or the `agents→sdk` edge. Cycles ARE caught globally. Follow-up ticket.

## CLEAN dimensions (no findings)
- **Architecture/boundaries:** `delegation-types.ts` extraction genuinely breaks the orchestrator↔loop cycle (madge: 0 cycles); files/functions within G6; no IoC/second runtime; factory-injection is sound DIP (2 real callers).
- **Type-safety (G3):** no `any`/`@ts-ignore`/unsafe `as` in prod; Zod SSoT; explicit return types. (Note: the loose event boundary type is what let B1 slip past the compiler.)
- **G2/sdk-runtime architecture:** the loop is a LEGITIMATE outer round-loop on top of `Run.stream()`, NOT a forbidden reimplementation of the SDK's inner tool loop. (The defect is that the outer loop never fires — B1 — not that it reimplements the SDK.)
- **G8:** `crypto.randomUUID()`, web standards.

## Conclusion
The implementation is architecturally clean, type-safe, cycle-free, and TDD-disciplined — but it **fails its own Goal at runtime (B1)**: the multi-round reflective loop does not fire against the real `@theokit/sdk` because the continuation signal (`finishReason==='tool-calls'`) is never produced by the real adapter, and the test suite masks this with non-production event shapes (H1). This is a design-level continuation-signal issue, not a quick patch.

**Verdict: NEEDS_FIXES.** Return to `cycle-plan`/`cycle-implement` to (1) rework the outer-loop continuation to be reflection-driven (not `finishReason`-driven) OR propagate a real terminal signal, (2) add a production-event-shape integration test (H1) that fails first, (3) fix the simple-chat parity (M1) + error-typing (M2). `/review` re-runs after. **`/release` MUST NOT run** until B1 is resolved.
