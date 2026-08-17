# Edge Case Review — V4-N.1 adapter real usage
Date: 2026-06-25 · Tasks: 2 · Edge cases: 3 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX
(none — additive done payload + a documented SDK `run.wait()` read; error path + absent-usage are handled defensively.)

## SHOULD TEST
### EC-1: an error round does NOT re-emit a done after run.wait()
- Affected: T1.1 · Family: State
- Scenario: when the stream yields an `error`, the terminal is the error; the adapter must NOT also call run.wait()+emit a done (exactly-one-terminal).
- Suggested test: `test_error_round_does_not_emit_done` — a mock stream yielding an error → exactly one error, no done.

### EC-2: run.wait() throwing surfaces as an error (fail-loud), not a silent 0-done
- Affected: T1.1 · Family: Resource
- Scenario: run.wait() rejecting must be caught by the surrounding try/catch and surfaced as an `error` event, not swallowed.
- Suggested test: `test_wait_rejection_surfaces_error` — mock run.wait rejects → an `error` event is emitted.

## DOCUMENT
### EC-3: absent run.wait().usage → 0s
- Accepted risk: defensive `?? 0` (mirrors prior behavior); a run with no usage reports 0/0, consistent with today.

**Verdict:** PLAN OK (EC-1/EC-2 fold into T2.1's scope; EC-3 documented).
