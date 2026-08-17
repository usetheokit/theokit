# Edge Case Review — v4-mainloop-reflective-runtime

Date: 2026-06-23
Tasks analyzed: 6 (T1.1, T1.2, T1.3, T2.1, T2.2, T3.1, T4.1)
Edge cases found: 5 (MUST FIX: 1, SHOULD TEST: 3, DOCUMENT: 1)

Already covered (NOT re-flagged): model error mid-round → typed `DelegationError` (Failure scenarios row 1); never-converges → `maxIterations` forced terminal (row 2); SDK-not-installed (row 3); caller-cancel/abort mid-loop (row 4 + concurrency tests); budget clamp preserved (Baseline `agent-orchestrator.ts:35`).

## MUST FIX

### EC-1: Degenerate/empty round breaks `finishReason` derivation → loop can spin or misbehave
- **Affected task:** T2.1 (`runReflectiveLoop` / `LoopOutcome.finishReason` derivation)
- **Family:** State / Format
- **Scenario:** The plan derives `finishReason` from stream events with exactly 3 rules (Domain glossary `:71`): `tool_result` without `done` ⇒ `'tool-calls'`; `done` ⇒ `'stop'`; `error` ⇒ `'error'`. But a round can yield **none of these** — an empty stream (zero events), or only a `message`/text event with no `done` and no `tool_result`. None of the 3 rules match → `finishReason` is undefined. If the default falls through to `'tool-calls'`, `shouldContinue` returns true and the loop re-enters with no progress (burns to `maxIterations`); if undefined, `shouldContinue` may throw.
- **Impact:** Wasted rounds (cost) or a crash on a degenerate model response — a real LLM can return an empty/text-only turn.
- **Suggested fix:** In the `finishReason` derivation, the **default/fallback is `'stop'`** (terminal) — only `tool_result`-without-`done` yields `'tool-calls'`. Add it as the explicit last branch: a round with no tool calls and no error terminates the loop. (≤3 lines.)

## SHOULD TEST

### EC-2: `simple-chat` backward-compatibility regression
- **Affected task:** T2.2 (branch `delegate()` on resolved `LoopStrategy`)
- **Suggested test:** `test_simple_chat_strategy_preserves_single_shot` — assert a `@MainLoop({strategy:'simple-chat'})` agent invokes `createSdkAgentStream` **exactly once** (one round, no re-entry) and returns the identical accumulator shape as today's `delegate()` — i.e. the new branching introduces zero behavior change for the existing default strategy.

### EC-3: `maxIterations` boundary values (undefined / 1 / 0)
- **Affected task:** T1.1 (`resolveLoopStrategy(strategy, maxIterations)`)
- **Suggested test:** `test_resolve_loop_strategy_maxiterations_boundaries` — `undefined` ⇒ a sane finite default (not `Infinity`); `1` ⇒ exactly one round (effectively single-shot); `0` ⇒ clamped to ≥1 (never zero rounds, which would return an empty response). Asserts the multi-round driver can never run unbounded nor zero times.

### EC-4: Budget accumulated across rounds (not reset per round)
- **Affected task:** T2.1 / T2.2 (budget clamp across the multi-round loop)
- **Suggested test:** `test_loop_budget_enforced_across_rounds` — with a per-round cost and a total budget smaller than `rounds × cost`, assert the loop terminates mid-loop with `BudgetExceededError` once the **cumulative** cost crosses the budget (the existing single-shot clamp checks one turn; the loop must accumulate, not reset each round).

## DOCUMENT

### EC-5: Reflection feedback is unbounded text
- **Accepted risk:** `ReflectionStrategy.reflect()` returns `{ feedback? }` prepended to the next round's prompt. A pathological strategy could return huge feedback and grow context. Accepted because (a) the shipped `'ladder'` default emits bounded, templated feedback, and (b) context growth is the SDK's job (`@theokit/sdk` compaction / `@ContextWindow`), not the loop's — adding a feedback-size guard here would duplicate the SDK's responsibility (KISS / sdk-runtime.md). Custom strategies own their feedback size.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 1 (EC-3) | 0 |
| T2.1 | 2 | 1 (EC-1) | 1 (EC-4) | 0 |
| T2.2 | 1 | 0 | 1 (EC-2) | 0 |
| T1.2 | 1 | 0 | 0 | 1 (EC-5) |

**Verdict:** PLAN NEEDS ADJUSTMENT (1 MUST FIX — `finishReason` default-to-`'stop'` for degenerate rounds; small fix)
