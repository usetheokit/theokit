# Re-Review — v4-mainloop-reflective-runtime (fix-absorption pass)

**Date:** 2026-06-23 · **Slug:** v4-mainloop-reflective-runtime
**Commits reviewed:** `90ad43e..0ee110b` — fix commits `b6a7f05` (agents) + `0ee110b` (http test) on `develop`
**Reviewers:** 3 independent fresh-eyes agents (loop-correctness/B1 · architecture-boundaries/M1-D4-parity · test-quality/H1-L4)
**Prior review:** `v4-mainloop-reflective-runtime-review-2026-06-23.md` (NEEDS_FIXES — 1 BLOCKER, 1 HIGH, 2 MEDIUM, 6 LOW)
**Verdict:** **READY_TO_MERGE** (slice findings all resolved; 0 BLOCKER, 0 HIGH in-scope) — **with one HIGH-value PRE-EXISTING out-of-scope finding flagged for a follow-up slice.**

## Resolution of prior findings

| ID | Sev | Status | Evidence |
|----|-----|--------|----------|
| **B1** | BLOCKER | ✅ RESOLVED | `deriveFinishReason` reordered: `error → done.finishReason==='tool-calls' → sawToolResult → stop` (run-reflective-loop.ts:88-91). Verified against the REAL adapter source: `sdk-adapter.ts:147-153` appends an unconditional terminal `done` with NO `finishReason`; `event-translator.ts` dispatches a real `tool_call`(status `completed`) → `tool_result`. So a tool-using turn now continues end-to-end; a pure-text turn stops; empty round ⇒ stop (EC-1). Order-independent (flag-based). Bounded by `maxIterations` (Zod min(1), default 8). RED test `test_mainloop_real_sdk_shape_loops` confirmed FAILS pre-fix. |
| **H1** | HIGH | ✅ RESOLVED (1 residual LOW) | Production-shape integration test `test_plan_act_reflect_real_adapter_shape_loops_twice` (round1 `[tool_result, done]`, `done` with no `finishReason`) across both on-ramps. Residual: the test mocks `createSdkAgentStream` wholesale → does not span the real `translateSdkEvent`→loop boundary (see new finding NF-1). |
| **M1** | MEDIUM | ✅ RESOLVED | `delegate()` always routes through the shared `runReflectiveLoop`; `runSingleShot`/`processStreamEvent`/`StreamAccumulator`/`asString`/`asNumber` deleted (zero remaining refs). Both on-ramps resolve reflection identically (plan-act-reflect→ladder else noop) and pass an identical config → true D4 parity. Cost: old assignment vs new accumulation are arithmetically identical for simple-chat's single round. |
| **M2** | MEDIUM | ✅ RESOLVED | `try/catch` around `consumeOneRound` (run-reflective-loop.ts:169-174) re-throws typed errors, wraps raw exceptions as `DelegationError`. Shared by both on-ramps. |
| **L1** | LOW | ✅ RESOLVED | Abort-exit records `acc.rounds = round - 1` (line 207); pinned by `test_loop_propagates_abort_signal`. |
| **L2** | LOW | ✅ RESOLVED | `[reflection]` block appended only when feedback non-empty (line 165). |
| **L3** | LOW | ✅ RESOLVED | Dead post-loop budget re-check removed with the deleted `runReflective` helper. |
| **L4** | LOW | ✅ RESOLVED | +8 non-tautological tests (noop, text_delta, budget ==/0, mid-stream abort, missing-apiKey, parent-budget clamp). Each would fail if the production code were wrong. |
| **L5** | LOW | ⚪ Accepted | `streamEnabled` documented-no-op — acceptable per G10 (YAGNI). |
| **L6** | LOW | ⚪ Follow-up | dependency-cruiser scope — pre-existing, out of scope. |
| http scaffold | (pre-existing fail) | ✅ RESOLVED | `scaffold.test.ts` aligned to ADR 0030 (theokit NOT a peer/dep of `@theokit/http`); correct test-alignment, not weakened-to-pass. |

## Structural gates

- **G1 (cycles):** madge `No circular dependency found!` (57 files). `delegation-types.ts` breaks the orchestrator↔loop cycle.
- **G6 (size):** `agent-orchestrator.ts` 103 LoC (was ~252).
- **G7 (dead code):** zero refs to deleted symbols; backward-compat re-exports intact.
- **G2 (no LLM fetch):** clean.
- **Suites:** `@theokit/agents` 304 passed / 3 skipped; `@theokit/http` 395 passed; `create-theokit` 77 passed. Lint `--max-warnings=0` clean; typecheck clean; build success.

## NEW finding (PRE-EXISTING) — ✅ RESOLVED in commit `af4cd4e`

> **Resolution (2026-06-23):** the user opted to fix NF-1 immediately via a TDD micro-cycle rather than defer it. The `Run.stream()` contract was confirmed at the SDK source (`types/run.ts:279` — `AsyncGenerator<SDKMessage, void>`, raw union fed straight to the translator). RED-first: `event-translator.test.ts` (10 real-shape cases, 8 failed pre-fix) → fix `event-translator.ts` to read the real fields + map the UPPERCASE status enum (`FINISHED`/`CANCELLED`→done, `ERROR`/`EXPIRED`→error) → made the adapter fallback `done` conditional (no double-terminal) → added `sdk-adapter-translation.test.ts` (4 end-to-end cases spanning `createSdkAgentStream` → real `translateSdkEvent`, which ALSO closes the H1 residual gap). Full suite 318 passed; lint/typecheck/build/G1/G2 clean. The `@theokit/agents` → live-SDK path now surfaces answer text and fails loud on ERROR.

### NF-1 — `event-translator.ts` was mis-shaped against the real `@theokit/sdk` `SDKMessage` union (HIGH for the broader product) — now FIXED

Found independently by 2 of 3 reviewers. Verified at the SDK source (`theokit-sdk/packages/sdk/src/types/messages.ts`). `run.stream()` yields raw `SDKMessage` straight into `translateSdkEvent` (sdk-adapter.ts:139-140), so these field mismatches are live:

1. **Assistant answer text never surfaces.** `SDKAssistantMessage` puts content at `msg.message.content` (messages.ts:62-64); `translateAssistantEvent` reads `msg.content` (event-translator.ts:35) → `content` is `undefined` → returns `[]`. Against a live SDK, `text_delta` is never emitted → `DelegationResult.response` is **empty**.
2. **Cloud-run errors silently swallowed.** Real `SDKStatusMessage.status` is `"…|ERROR|…"` (uppercase, messages.ts:110); `translateStatusEvent` matches lowercase `'error'`/`'done'`/`'completed'` (event-translator.ts:85-96) → a real `ERROR` status is treated as a no-op, and the adapter then appends a normal `done`. Violates fail-loud (Unbreakable Rule 8).
3. **Tool-card correlation wrong.** `translateToolCallEvent` reads `msg.id` for callId; real field is `call_id` (messages.ts:93) → falls back to `tc-${timestamp}`.

**Impact on THIS slice:** none on the loop driver. B1 continuation holds end-to-end because the real `tool_call`(status `completed`) message type IS dispatched to `translateToolCallEvent` and emits `tool_result` (status enum matches; only callId is wrong), and the adapter appends the unconditional `done`. So `@MainLoop` runtime is genuinely correct.

**Impact on the V4 Goal's real-world validity:** the end-to-end path (decorator agent → live SDK → usable output) returns an **empty response** and **swallows ERROR**. The loop runtime is proven; the adapter↔SDK translation seam is not. The original `/review` examined sdk-runtime/type-safety and marked it CLEAN — this re-review's fresh eyes caught a deeper, pre-existing seam defect that no scripted-mock test could surface.

**Recommended follow-up slice:** `align-event-translator-to-sdk-message-union` — read `msg.message.content`, map the real `SDKStatusMessage` status enum (`FINISHED`→done, `ERROR`/`CANCELLED`/`EXPIRED`→error), use `call_id`, and add a translator-level contract test driving real `SDKMessage` shapes (the mock-based tests cannot catch this class of drift).

## Conclusion

The v4-mainloop-reflective-runtime slice is **READY_TO_MERGE**: every prior finding (B1/H1/M1/M2/L1-L4 + the pre-existing http test) is resolved, with 0 BLOCKER and 0 HIGH introduced, zero cycles, no dead code, full non-tautological test coverage, and the loop runtime is correct against the real adapter shapes.

The re-review surfaced **NF-1**, a HIGH-value PRE-EXISTING translator-seam defect that means `@theokit/agents` returns empty responses + swallows errors against a live SDK. It is out of this slice's scope (the translator was untouched by this diff and was not in the original review's findings), but it is material to whether V4 works end-to-end. Per honesty discipline it is flagged here and recommended as a dedicated next slice **before** claiming V4 is functional against a live SDK. It does not block merging this slice.
