# Edge Case Review — V4-N loop outcome fidelity
Date: 2026-06-25 · Tasks: 3 · Edge cases: 3 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX
(none — additive type change + a localized event correlation; the real SDK emits matching call_id, and a mismatch degrades to today's behavior.)

## SHOULD TEST
### EC-1: multiple tool calls in one round are correlated independently
- Affected: T2.1/T3.1 · Family: State
- Scenario: a round with 2 tool_call + 2 tool_result events must produce 2 faithful entries (each input paired to its own output by callId), not cross-paired.
- Suggested test: `test_multiple_tool_calls_correlated_by_id` — 2 calls (c1 'pytest', c2 'ls') → toolCalls[0].input.command==='pytest', toolCalls[1].input.command==='ls'.

### EC-2: a tool_result with no matching tool_call → input {} (graceful)
- Affected: T2.1 · Family: Boundary
- Scenario: id mismatch (SDK omitted call_id) must not throw; input degrades to {} (no worse than today).
- Suggested test: `test_unmatched_tool_result_degrades_to_empty_input` — tool_result with an unseen callId → entry with input {} (+ id, name, output).

## DOCUMENT
### EC-3: DoneEvent.usage absent → split tokens default 0
- Accepted risk: defensive `?? 0` reads (mirrors the existing totalTokens read); no usage ⇒ 0/0, consistent with today.

**Verdict:** PLAN OK (EC-1/EC-2 fold into T2.1/T3.1; EC-3 documented).
