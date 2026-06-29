# Edge Case Review — agents-think-tag-middleware

Date: 2026-06-28
Tasks analyzed: 3 (T1.1 extractor, T2.1 stream transform, T3.1 config+wiring)
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 1)

The boundary that matters is the **incremental string splitter** (T1.1): all real risk lives in how a `<think>`/`</think>` delimiter is recognized across chunk boundaries and how a *prefix that turns out not to be a tag* is recovered.

## MUST FIX

### EC-1: A buffered delimiter-prefix that then mismatches must be flushed as text
- **Affected task:** T1.1
- **Family:** Format / Boundary
- **Scenario:** In text mode the extractor buffers a tail that is a prefix of `<think>` (e.g. it has seen `<think` waiting for `>`). The next char is not `>` — e.g. the model wrote `<thinkers>` or `<thing>`. `<think` is a valid *prefix* of `<think>` but the continuation breaks the match.
- **Impact:** If the algorithm only ever waits for `>` after `<think`, a `<thinkers>` either hangs in the buffer (lost text) or is wrongly treated as an open tag → the rest of the answer is swallowed into a thinking segment. Data corruption / dropped text.
- **Suggested fix:** when the buffered prefix can no longer extend to the full delimiter (next char diverges), emit the longest non-matching portion as text and re-scan the remainder from the earliest still-possible `<`. Add `test_extractor_partial_tag_prefix_then_mismatch` — `write('a<thinkers>b')` → `[{text,'a<thinkers>b'}]`; and split form `write('a<thin')`,`write('kers>b')` → text `a<thinkers>b`.

## SHOULD TEST

### EC-2: Thinking mode persists across an interleaved non-text event
- **Affected task:** T2.1
- **Suggested test:** `test_think_stream_thinking_persists_across_tool_event` — input `[text_delta '<think>r1', tool_call X, text_delta 'r2</think>done']` → `[thinking 'r1', tool_call X, thinking 'r2', text_delta 'done']`. Locks the decision that the per-stream extractor keeps its mode across non-`text_delta` events (it is only fed text content), so a reasoning block split by a tool event is not corrupted.

### EC-3: A `text_delta` with non-string / empty `content` passes through safely
- **Affected task:** T2.1
- **Suggested test:** `test_think_stream_handles_nonstring_content` — a `{type:'text_delta'}` with `content` undefined (or empty `''`) yields no thinking segment and does not throw; the extractor guards `typeof content === 'string'` before `write`. Prevents a malformed delta from crashing the stream.

## DOCUMENT

### EC-4: Buffer is bounded; in-tag whitespace preserved verbatim
- **Accepted risk:** the partial-delimiter buffer can hold at most `len('</think>')` = 8 chars (it is flushed the moment it cannot extend to a delimiter, per EC-1), so there is no unbounded-growth risk even on adversarial input. Whitespace/newlines inside `<think>…</think>` are preserved verbatim (the renderer/consumer decides trimming) — not the extractor's concern. No code change.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 2 | 1 | 0 | 1 |
| T2.1 | 2 | 0 | 2 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT (absorb EC-1 into T1.1 as a MUST-FIX test + algorithm note; add EC-2/EC-3 SHOULD-TEST cases to T2.1; record EC-4 as a note). After absorption → re-run `/plan-confidence`.
