# Edge Case Review — theokit-agent-dogfood-gaps

Date: 2026-06-10
Tasks analyzed: 7
Edge cases found: 5 (MUST FIX: 1, SHOULD TEST: 3, DOCUMENT: 1)

## MUST FIX

### EC-1: Streaming SSE chunk may contain partial JSON — parser crash
- **Affected task:** T1.1 (Token-by-token streaming)
- **Family:** Format / Input
- **Scenario:** OpenRouter streaming returns chunks that may split a JSON object across two `data:` lines. The runner does `JSON.parse(line.slice(6))` on each line. If a chunk boundary splits `{"choices"` across two reads, `JSON.parse` throws and kills the stream.
- **Impact:** Agent stream crashes mid-response. User sees partial text then error.
- **Suggested fix:** Buffer incomplete lines. Only parse when a complete `data: {...}\n\n` boundary is detected. Use `buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop()` pattern.

## SHOULD TEST

### EC-2: Session Map grows unbounded
- **Affected task:** T1.2 (Multi-turn conversation)
- **Suggested test:** Verify that sessions older than 1 hour are evicted. Add `setTimeout` cleanup or max-sessions cap. Without it, a long-running demo leaks memory per session.

### EC-3: Budget enforcement with streaming — cost not in every chunk
- **Affected task:** T3.1 (Budget enforcement)
- **Suggested test:** OpenRouter streaming only returns `usage` in the LAST chunk (after `[DONE]`). Verify budget check happens after the stream completes, not mid-stream. The cost from the last chunk must be accumulated correctly.

### EC-4: AbortController — fetch abort races with stream end
- **Affected task:** T3.2 (Abort cancel)
- **Suggested test:** User clicks cancel at the exact moment the stream finishes naturally. Verify no `AbortError` thrown after successful completion. Use `signal.aborted` check before yielding the done event.

## DOCUMENT

### EC-5: OpenRouter model name format differs from Anthropic SDK format
- **Accepted risk:** `@Agent({ model: 'claude-sonnet-4-5-20250929' })` is Anthropic SDK format. OpenRouter requires `anthropic/claude-sonnet-4-5-20250929` (with provider prefix). The runner should prepend `anthropic/` if no slash is present. Document: "Models without provider prefix default to anthropic/."

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 1 (EC-1) | 0 | 0 |
| T1.2 | 1 | 0 | 1 (EC-2) | 0 |
| T2.1 | 1 | 0 | 0 | 1 (EC-5) |
| T2.2 | 0 | 0 | 0 | 0 |
| T2.3 | 0 | 0 | 0 | 0 |
| T3.1 | 1 | 0 | 1 (EC-3) | 0 |
| T3.2 | 1 | 0 | 1 (EC-4) | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 1 MUST FIX (streaming JSON parse safety) needs absorption.
