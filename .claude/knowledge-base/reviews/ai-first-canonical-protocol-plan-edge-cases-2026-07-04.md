# Edge Case Review — ai-first-canonical-protocol (implementation plan)

Date: 2026-07-04
Plan analyzed: .claude/knowledge-base/plans/ai-first-canonical-protocol-plan.md
Tasks analyzed: T1.1, T1.2, T2.1, T2.2
Edge cases found: 3 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 0)

## MUST FIX

### EC-1: theokit tools are runtime tools → the parsed part is `dynamic-tool`, not `tool-<name>`
- **Affected task:** T2.1
- **Family:** Interpretation
- **Scenario:** The blueprint's ToolUIPart state machine has TWO shapes: `ToolUIPart` (`type: 'tool-<NAME>'`, static/typed tools) and `DynamicToolUIPart` (`type: 'dynamic-tool'`, runtime tools with a `toolName` field). theokit tools are discovered at runtime, so a `tool-input-available` with a `toolName` materializes a **`dynamic-tool`** part. The E2E pseudo-code's `p.type === 'tool-<name>'` assumption would fail to find the part.
- **Impact:** the E2E assertion (Goal metric) can't locate the tool part → false red or a wrong assert.
- **Suggested fix:** T2.1 asserts the tool part by `toolCallId` (stable) and checks `state` + `input` + `output`; do NOT assert on `type === 'tool-<name>'`. Also verify whether emitting `tool-input-available` WITHOUT the `dynamic: true` flag produces a `dynamic-tool` or a static `tool-*` part in `ai@7` — and if the consumer needs `dynamic: true` on the chunk for runtime tools, add it. Resolve by reading `to-ui-message-chunk.ts` / `process-ui-message-stream.ts` during T1.2 before finalizing the E2E.

## SHOULD TEST

### EC-2: synthesized `tool-input-available` for an orphan result needs a `toolName`
- **Affected task:** T1.2
- **Suggested checkpoint:** The EC-1 synthesis uses `ev.toolName` from the `ToolResultEvent` (confirmed present: `tool_result{callId, toolName, output, isError}`). Assert the synthesized input part carries the real `toolName` (not empty), so the card labels correctly.

### EC-3: `finish` without `finishReason` is valid but a tool run should arguably report `tool-calls`
- **Affected task:** T1.1
- **Suggested checkpoint:** `finish{}` (no finishReason) passes the schema (finishReason optional). M1 emits bare `finish` (KISS). A test asserts the finish chunk validates; enriching `finishReason` is deferred (YAGNI) unless the consumer needs it to render — confirm it does not.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST |
|------|-------|----------|-------------|
| T1.1 | 1 | 0 | 1 (EC-3) |
| T1.2 | 1 | 0 | 1 (EC-2) |
| T2.1 | 1 | 1 (EC-1) | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT (1 MUST FIX absorbed into plan v1.1)
