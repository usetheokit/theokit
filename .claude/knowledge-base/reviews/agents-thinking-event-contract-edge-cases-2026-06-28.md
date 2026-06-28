# Edge Case Review — agents-thinking-event-contract

Date: 2026-06-28
Tasks analyzed: 2 (T1.1 contract variant + exports; T1.2 additivity runtime tests)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 3)

## Boundary map

This plan adds ONE additive variant to a discriminated-union TYPE contract + two re-exports. The only boundaries are: (a) TypeScript exhaustiveness over `AgentEvent` (compile-time), (b) the SSE parse boundary (`parseSSEChunk`), (c) the SSE encode boundary (`encodeSSE`). No runtime I/O, no concurrency, no state.

## MUST FIX

(none) — The single MUST-FIX candidate for adding a union variant is a broken exhaustive `switch (event.type)` with `default: assertNever`. **Audited and confirmed absent** in `packages/theo/src`:
- `grep "case 'tool_result'"` → no match (no switch over the union).
- `grep -E "assertNever|: never|satisfies never"` over the event consumers → only unrelated generic-type `never`s (`theo-fetch.ts`, `plugin-types.ts`, `theo-cloud-adapter-stub.ts`) and the comment `stream-agent-run.ts:263` (about SDK `status`, not `AgentEvent`).
- `encodeSSE` (`define-agent-endpoint.ts:90`) = `JSON.stringify(event)` — generic over any `AgentEvent`. Additive-safe.
- `agent-tool-cards.ts` = `if (type==='tool_call') … else if (type==='tool_result')` — non-exhaustive, thinking ignored. Additive-safe.
- `deriveLiveText`/`deriveError` = filter by specific type. Additive-safe.

The change is therefore non-breaking with no required code change beyond the additive variant + exports.

## SHOULD TEST

### EC-1: A derivation could silently start concatenating thinking into assistant text
- **Affected task:** T1.2
- **Family:** State / Format
- **Scenario:** A future edit to `deriveLiveText` (or a new fold) treats unknown variants as text, leaking the model's raw reasoning into the visible assistant message.
- **Suggested test:** `test_deriveLiveText_ignores_thinking` — assert `deriveLiveText([message 'Hi', thinking 'reason'])` === `'Hi'` (already in T1.2; this review confirms it is the right locking test). Also keep `test_agent_tool_cards_ignore_thinking`.

## DOCUMENT

### EC-2: `parseSSEChunk` does not runtime-validate the thinking payload
- **Accepted risk:** `parseSSEChunk` (`agent-stream-core.ts:50`) is `JSON.parse(raw) as AgentEvent` — it casts without runtime validation for ALL variants today (pre-existing). A malformed `{type:'thinking'}` with no `content` would parse to `content: undefined` (a type-lie). This is consistent with how the 4 existing variants are parsed; the producer (theocode/`@theokit/agents`) owns the shape. Adding runtime validation is out of scope (would change behavior for all variants) and is a separate decision.

### EC-3: Large thinking content vs SSE line length
- **Accepted risk:** Reasoning text can be long; `encodeSSE` emits one `data:` line per event. SSE has no hard line cap in practice and the existing `message` variant already streams large text the same way. Chunking (delta-streaming thinking) is the producer's concern (`@theokit/agents` already emits incremental `thinking` at the stream layer; theocode aggregates in Cycle 2). The contract variant carries a complete `content: string`, same as `AgentMessageEvent`.

### EC-4: `id?` dedup-key collision between a thinking event and a message event
- **Accepted risk:** Both `AgentMessageEvent` and `AgentThinkingEvent` carry optional `id?` used by clients for dedup/animation keys. A producer that assigns the SAME id to a message and a thinking event could confuse a client keyed only by `id`. This is a producer/consumer concern (theocode keys by `(type,id)` in Cycle 2); the contract simply offers the optional field consistently with the other variants. No contract-level fix needed.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 0 | 1 (EC-2 parse cast) |
| T1.2 | 3 | 0 | 1 (EC-1) | 2 (EC-3, EC-4) |

**Verdict:** PLAN OK — no MUST-FIX. The single union-variant exhaustiveness risk is confirmed absent by audit; the SHOULD-TEST (EC-1 ignore-thinking) is already covered by T1.2; the three DOCUMENT items are pre-existing or producer-side concerns out of this contract's scope. Plan remains v1.0; this report is the audit trail for `/plan-confidence`.
