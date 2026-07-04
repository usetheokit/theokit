# Discover Edge Case Review — ai-first-canonical-protocol (M1)

Date: 2026-07-04
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/ai-first-canonical-protocol-plan.md
Research questions analyzed: 7
Edge cases found: 5 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: Tool part lifecycle — does `tool-input-available` alone create the tool part, or is `tool-input-start` required first?
- **Affected question:** Q1, Q3
- **Family:** Interpretation
- **Scenario:** theokit `ToolCallEvent` carries the COMPLETE input (not streamed), so the natural mapping is a single `tool-input-available` chunk. But `useChat`/assistant-ui may only create/render the tool UIPart when a `tool-input-start` opens it first (the state machine begins at `input-streaming`). Emitting only `tool-input-available` could render nothing.
- **Impact:** the tool-call card (a DoD) silently doesn't render.
- **Suggested fix:** Q1 must determine from `to-ui-message-chunk.ts` + `ui-messages.ts` whether `tool-input-available` alone materializes the part, OR whether the translator must emit `tool-input-start{toolCallId,toolName}` THEN `tool-input-available{...,input}`. The blueprint records the exact minimal sequence proven against the schema/state-machine.

### EC-2: Interleave ordering — an open text block must close before a tool/reasoning chunk
- **Affected question:** Q3
- **Family:** Interpretation / Ordering
- **Scenario:** the M0 translator opens a text block (`text-start`) and streams `text-delta`. If a `ToolCallEvent` or `ThinkingEvent` arrives while text is open, emitting a tool/reasoning chunk without first closing the text (`text-end`) may violate the UIMessage part ordering `useChat` expects (dangling open text part).
- **Impact:** malformed message parts; card/text render out of order or not at all.
- **Suggested fix:** Q3 must define the state rule: before emitting a tool or reasoning chunk, if a text block is open, emit `text-end` first (and likewise close an open reasoning block before text/tool). The blueprint specifies the open/close state machine across text/reasoning/tool.

## SHOULD TEST

### EC-3: Reasoning `id` grouping — consecutive `ThinkingEvent`s = one reasoning block or many?
- **Affected question:** Q3
- **Suggested checkpoint:** theokit `ThinkingEvent{content}` has no id. Q3 must decide: consecutive thinking deltas share ONE `reasoning-start{id}` (one crypto.randomUUID per block, `reasoning-delta*`, `reasoning-end`), analogous to the M0 text block. A test asserts N consecutive ThinkingEvents → 1 reasoning block, not N.

### EC-4: `tool-output-error` vs `tool-output-available` from `ToolResultEvent.isError`
- **Affected question:** Q3
- **Suggested checkpoint:** theokit `ToolResultEvent` has `isError: boolean`. Q3/Q5 must map `isError===true` → `tool-output-error{toolCallId,errorText}` and `false` → `tool-output-available{toolCallId,output}`. A negative-case test covers the error branch (testing.md §4.1).

## DOCUMENT

### EC-5: The ADR (Q7) DECIDES the protocol — it does NOT build an AG-UI adapter
- **Affected question:** Q7
- **Accepted risk:** Q7 gathers AG-UI facts only to justify keeping `UIMessageStream` (already shipped in M0). Building an `@ag-ui/*` surface is explicitly out-of-scope (already in the plan). The blueprint's ADR records the decision + a re-eval trigger (e.g. "a shipped TheoKit app needs a non-ai-sdk UI"), not an implementation.

## Summary

| Question | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------|----------|-------------|----------|
| Q1 | 1 | 1 (EC-1) | 0 | 0 |
| Q3 | 3 | 1 (EC-2) | 2 (EC-3, EC-4) | 0 |
| Q7 | 1 | 0 | 0 | 1 (EC-5) |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (2 MUST FIX absorbed into plan v1.1)
