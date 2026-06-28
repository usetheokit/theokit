# Review — agents-stream-dx-fixes (#40/#41/#42)

**Date:** 2026-06-28 · **Commit:** `2c6e03f` (develop) · **Package:** `@theokit/agents@0.21.0`
**Reviewer:** independent verification (gates + adversarial probe + diff audit). **Verdict: READY_TO_MERGE**

## Gates (re-run independently, not trusting the implementer's report)
- `pnpm --filter @theokit/agents test`: **423 passed | 3 skipped (54 files)** — was 420|3 at baseline; +3 tests (the 3 skips are pre-existing real-LLM smoke tests needing an API key; only the #42 bug-test was rewritten, none removed).
- `npx tsc --noEmit -p packages/agents/tsconfig.test.json`: **0**.
- ESLint on the 4 touched files: **0** (also enforced by the pre-commit `lint-staged eslint --max-warnings=0`, which passed).
- **Pre-existing lint debt (honest):** `eslint packages/agents` reports **30 errors** — ALL in test files this change never touched (`agent-decorator.test.ts`, `composition.test.ts`, etc.). Proven: total = 30, touched files = 0 → 0 introduced. The plan's `eslint packages/agents → 0` gate is unachievable on this repo independent of this work; out of scope for #40/#41/#42 (separate lint-debt cleanup).
- Changeset added (`patch @theokit/agents`) — release pipeline wired.

## What shipped (bridge-only — `sdk-runtime.md`/G2; no SDK change, no runtime re-impl)
- **#41** `event-translator.ts`: `serializeToolOutput(value, fallback)` — string passthrough, `null`→fallback, else `JSON.stringify` with a BigInt-safe catch (`value.toString()`). Used in both `completed`/`error` branches. `ToolResultEvent.output` stays `string` (wire contract preserved).
- **#42** `event-translator.ts`: the `running` status emits `{ type:'tool_call', callId, toolName, input: msg.input ?? msg.arguments ?? {} }`; the bug-encoding test `test_tool_call_running_emits_nothing` was inverted to assert the emission.
- **#40** `sdk-adapter.ts`: `createSdkAgentStream` passes `SendOptions.onDelta` to `agent.send`; an async queue + `mergeDeltaStream` (27 LoC) interleave the incremental `text_delta` tokens with `run.stream()`; `sawDelta` dedups the complete-assistant `text_delta`; `translateAssistantEvent` is the fallback when `onDelta` never fires. `SDK_NOT_INSTALLED` / `sawError` short-circuit / `finally dispose` preserved.

## Adversarial verification
- **Dedup is non-vacuous (the central #40 risk — text duplication):** I neutered the `if (out.type === 'text_delta' && state.sawDelta) continue` guard and re-ran — `test_streams_incremental_deltas` FAILED (`expected ['Hel','lo','Hello'] … deduped`); the `no_delta_fallback` test stayed green (independent of dedup). Restored → both pass. The dedup genuinely bites.
- **No-delta fallback proven:** `test_no_delta_fallback_emits_full_text` — a fake Agent that never calls `onDelta` → exactly one `text_delta 'Hello'` (no text loss for non-streaming providers).
- **#41 serialize proven:** object result `{ ok, files }` → `output === '{"ok":true,"files":["a"]}'`; the existing string-result test (`result:'ok'` → `'ok'`) stays green (passthrough — no regression).
- **#42 running proven:** running status → a `tool_call` with callId/toolName/input; completed still emits `tool_result` (unchanged except #41 serialization).
- **Type-safety (G3):** the two implementer-fixed defects are sound — `onDelta` is typed with the real SDK `InteractionUpdate` union and narrows on the `'text-delta'` discriminant before reading `.text` (no `any`, no `as`, only a type-only import); `String(value)` replaced with a BigInt-safe branch (no-base-to-string). Verified by `tsc` 0 + the pre-commit eslint.
- **Bridge-only diff:** `git status` = `event-translator.ts` + `sdk-adapter.ts` + the two test files + changeset + root CHANGELOG + plan. No SDK package change; no LLM/loop re-implementation (G2/sdk-runtime honored).
- **No regression:** full suite green at the same baseline count + 3 new; `realUsageDone` terminal + dispose path untouched.

## Findings
- **INFO:** 30 pre-existing eslint errors in untouched agents test files — pre-existing repo debt, not introduced here; recommend a separate lint-debt cleanup task.
- **INFO:** the `[Symbol.asyncIterator]` generator is ~104 LoC (G6 soft budget 50) — but it was ~102 at baseline HEAD (dynamic-import + create + stream IIFE); this change EXTRACTED the new merge logic into the 27-LoC `mergeDeltaStream` helper rather than inflating it. Pre-existing shape, not worsened.
- No BLOCKER/HIGH/MEDIUM. The three issues are fixed, type-safe, tested (dedup probe-verified), and bridge-scoped.

## Decision
All three fixes land in the bridge with the SDK unchanged; the full suite is green, tsc + touched-file lint are 0, the dedup is proven non-vacuous via a probe, and the no-delta fallback preserves correctness. The remaining lint debt is pre-existing and out of scope. **READY_TO_MERGE.** The fix is on `develop` with a `patch` changeset; it ships to `@theokit/agents` via the changesets release PR (human-gated). Closes usetheodev/theokit#40, #41, #42 on publish.
