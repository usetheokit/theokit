# Edge Case Review — tool-dialect-tag-stripper

Date: 2026-06-30
Tasks analyzed: 3 (T1.1 stripper core, T2.1 type/compile surface, T2.2 wiring)
Cases found: 6 (EDGE: 3, NEGATIVE: 3 | MUST FIX: 0, SHOULD TEST: 4, DOCUMENT: 2)

> The plan already carries a strong TDD (8 unit + 4 integration tests), a lossless `end()` flush
> (Q2/Rule 8), compose-order analysis, and 4 risk rows. This review hunts only for boundaries the
> existing TDD does NOT assert — grounded in the `think-tag-extractor.ts` precedent the plan mirrors.

## MUST FIX

(none — no case causes crash, data loss, or security hole that the plan's lossless-flush + default-off design doesn't already prevent.)

## SHOULD TEST

### EC-1: non-string `text_delta.content` must pass through untouched
- **Affected task:** T2.2 (`stripToolDialectStream`)
- **Kind:** NEGATIVE (wrong type)
- **Suggested test:** `test_strip_passes_non_string_text_delta_untouched()` — feed a `text_delta` event whose `content` is not a string (e.g. `undefined`/object); assert it is yielded unchanged, NOT coerced into the buffer. The precedent guards exactly this: `think-tag-extractor.ts:121` (`event.type === 'text_delta' && typeof event.content === 'string'`). Without the `typeof === 'string'` guard, `buffer += chunk` coerces a non-string to `"[object Object]"` and corrupts the stream. The plan says "mirrors think-tag" — make the guard explicit + tested.

### EC-2: buffered text must be flushed on source error (try/finally), never silently dropped
- **Affected task:** T2.2 (`stripToolDialectStream`)
- **Kind:** NEGATIVE (mid-stream failure)
- **Suggested test:** `test_strip_flushes_buffer_when_source_errors_midstream()` — a source that yields a partial `<function=…` then throws; assert the buffered tail is flushed (as text) before the error re-propagates. The precedent wraps the loop in `try { … } finally { for (seg of extractor.end()) yield … }` (`think-tag-extractor.ts:119-129`, "the flushed segments are delivered before the error re-propagates — never silently dropped, Rule 8"). The plan's lossless `end()` (T1.1) only fires on normal completion; the transform-level `finally` is what covers the error path. Make the `try/finally` explicit in T2.2.

### EC-3: adjacent leaks with no separating text
- **Affected task:** T1.1 (`createToolDialectStripper`)
- **Kind:** EDGE (extreme of valid — two leaks back-to-back)
- **Suggested test:** `test_stripper_adjacent_leaks()` — `'<function=1></tool_call><function=2></tool_call>tail'` → only `'tail'` surfaces (both leaks stripped, no empty-text segment, no leftover delimiter). The existing `test_stripper_multiple_leaks` has text `'b'` between the two leaks; the zero-separator case exercises the loop's mode-reset back to `'text'` with an immediate second `OPEN` at index 0 (mirrors `think-tag-extractor.ts` `test_extractor_adjacent_blocks:83`).

### EC-4: leak straddling two separate `text_delta` EVENTS (not just two chunks of one event)
- **Affected task:** T2.2 (wiring)
- **Kind:** EDGE (boundary — cross-event stripper state)
- **Suggested test:** `test_stream_strips_leak_spanning_two_text_deltas()` — drive `onDelta` twice: first `text_delta` content `'ans <function=w>'`, second `'</tool_call> more'`; assert visible text joins to `'ans  more'` (leak stripped across the event boundary). This proves the transform uses ONE stripper instance across the whole stream (cross-event state persists), the analog of the unit-level chunk-straddle test but at the StreamEvent layer. The unit test covers within-one-write straddle; this covers across-events.

## DOCUMENT

### EC-5: a tool-argument value containing a literal `</tool_call>` causes an early close (content collision)
- **Kind:** EDGE (content collides with the delimiter)
- **Accepted risk:** If a leaked `<function=…>` block's parameter value contains the literal substring `</tool_call>`, the scanner closes at the inner occurrence and resumes text mode, leaving the real `</function></tool_call>` tail to render as text. This is the same class as the think-tag scanner being "fooled" by content shaped like its delimiter (`think-tag-extractor.ts` handles `<thinkers>` as the documented limit). Probability is very low (a tool arg embedding the literal close-tag string), the flag is per-model opt-in, and the damage is a small leftover rather than corruption. Best-effort strip is the accepted contract — add a one-line note to T1.1 Deep Dives. Distinct from Risk-row-4 (which is a far-downstream *legit* close); this is a *within-leak* embedded close.

### EC-6: `<function=` nested inside a `<think>` block when both flags are ON
- **Kind:** EDGE (transform composition)
- **Accepted risk:** Already covered in T2.2 Deep Dives ("a `<function=` leak inside a `<think>` block would be routed to `thinking` and strip would not see it — acceptable, documented"). Listed here for completeness; no plan change needed — the compose-after-think order (strip applied to post-think `text_delta`) is the deliberate, documented choice.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 2 (EC-3, EC-5) | 0 | 0 | 1 (EC-3) | 1 (EC-5) |
| T2.1 | 0 | 0 | 0 | 0 | 0 |
| T2.2 | 1 (EC-4, EC-6) | 2 (EC-1, EC-2) | 0 | 3 (EC-1, EC-2, EC-4) | 1 (EC-6) |

**Coverage check:** every input-boundary task (T1.1 splitter, T2.2 stream transform) now has both EDGE (chunk/event straddle, adjacent, collision) and NEGATIVE (non-string content, mid-stream error) cases considered. T2.1 is a pure additive-type task — no runtime input boundary (the EDGE/NEGATIVE lenses do not apply; the compile-flag test in the plan suffices).

**Verdict:** PLAN OK

> 0 MUST FIX. The 4 SHOULD TEST items are additive test cases (non-string guard, error-flush, adjacent leaks, cross-event straddle) — all mirror existing `think-tag-extractor.ts` behavior the plan already commits to reuse, so they harden the mirror rather than expand scope. The 2 DOCUMENT items are accepted best-effort-scanner limits. Recommend bumping the plan to v1.1 absorbing EC-1..EC-4 into the T1.1/T2.2 TDD blocks + EC-5 as a Deep-Dives note, then `/deps-audit` → `/plan-confidence`.
