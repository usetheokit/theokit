# Edge Case Review — agents-stream-chronological-order

Date: 2026-06-28
Tasks analyzed: 2 (T1.1, T2.1)
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: Per-category tool dedup can DROP a tool error result reported only via run.stream()
- **Affected task:** T2.1 (ADR D3)
- **Family:** State / Timing
- **Scenario:** `onDelta` fires `tool-call-started` for callId `X` (sets `sawToolDelta = true`), but the tool then **fails**. If the SDK reports that failure only via the `run.stream()` `tool_call` message with `status: 'error'` (and does NOT fire a `tool-call-completed` `onDelta` for the failed call), the blanket `sawToolDelta` flag suppresses the `run.stream()` `tool_result(isError:true)` for `X`.
- **Impact:** The error `tool_result` is lost → the UI's tool card stays "running" forever; the agent's failure is invisible (silent error — violates Error Handling "fail loud").
- **Suggested fix:** Refine D3 — dedup `tool_call`/`tool_result` **by callId** (two `Set<string>` of callIds emitted via `onDelta`), not by the blanket `sawToolDelta` flag. Skip a `run.stream()` `tool_call`/`tool_result` only when its `callId` was already emitted by `onDelta`. Keep `text_delta`/`thinking` on the category flag (they have no id). ~4 lines (two Sets + `.has(callId)` checks).

## SHOULD TEST

### EC-2: send() rejects after partial deltas already streamed
- **Affected task:** T2.1
- **Suggested test:** `test_send_rejection_after_partial_deltas_emits_content_then_error()` — fake Agent fires a few `onDelta` text/tool events, THEN `send()` rejects; assert the partial content events are yielded in order BEFORE the terminal `error` event, and `dispose()` runs. (Guards against the rejection swallowing already-queued content.)

### EC-3: tool error reproduced via run.stream() when onDelta sent only tool-call-started
- **Affected task:** T2.1 (validates EC-1 fix)
- **Suggested test:** `test_tool_error_from_run_stream_not_suppressed_when_onDelta_only_started()` — `onDelta` emits `tool-call-started` for callId `X` only; `run.stream()` yields a `tool_call` message `status:'error'` for `X`; assert the `tool_result(isError:true)` for `X` IS emitted (callId-based dedup, not category-blanket).

## DOCUMENT

### EC-4: onDelta cannot fire after queue.close() (SDK lifecycle contract)
- **Accepted risk:** `createAsyncQueue.push` does not guard against push-after-close (a late push would silently append-but-never-yield). This cannot happen here: `onDelta` fires only DURING `agent.send()` (before it resolves), and the queue is closed only by the pump's `finally` AFTER `run.stream()` completes — which is AFTER `send()` resolves. So no `onDelta` can arrive post-close. Documented as a relied-upon SDK lifecycle invariant; no guard added (KISS — adding a closed-check would be defending against an impossible state). If the SDK ever fires `onDelta` post-resolution, the concurrency test (`test_concurrent_onDelta_and_pump_no_event_lost`) would surface lost events.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 4 | 1 | 2 | 1 |

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 (callId-based tool dedup) into D3 + add EC-2/EC-3 tests; EC-4 documented. T1.1 (pure translator) is clean.
