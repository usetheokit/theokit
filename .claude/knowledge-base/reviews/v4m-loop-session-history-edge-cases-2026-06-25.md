# Edge Case Review — V4-M loop session history

Date: 2026-06-25
Tasks analyzed: 3 (T1.1, T1.2, T2.1)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

(none — the core mechanism was empirically de-risked by a spike against the real SDK: `Agent.getOrCreate(id, {conversationStorage})` accepts a shared `InMemoryConversationStorage`, resumes from it, and the store survives `dispose` + a second `getOrCreate`. D1's lifecycle assumption holds.)

## SHOULD TEST

### EC-1: storage override is honored verbatim (not replaced by the default)
- **Affected task:** T2.1
- **Family:** State
- **Scenario:** When `RuntimeOverrides.conversationStorage` is provided, the factory must use it and NEVER allocate the default `InMemoryConversationStorage`. A `??=` ordering bug could shadow the override.
- **Suggested test:** `test_conversationStorage_override_is_used` — pass a sentinel storage; assert `Agent.getOrCreate` received that exact reference across rounds.

### EC-2: round 1 sends the original message; round 2 sends the continuation (not the original)
- **Affected task:** T1.2, T2.1
- **Family:** Boundary
- **Scenario:** The whole point of D2 — re-sending the original on round 2 would duplicate it in the persisted session. Capture each round's `send` argument and assert round-1 === original, round-2 ≠ original (feedback or CONTINUE_PROMPT).
- **Suggested test:** `test_round2_sends_continuation_not_original` (covered by the Phase 2 wiring test).

## DOCUMENT

### EC-3: default `InMemoryConversationStorage` is per-run ephemeral
- **Accepted risk:** the default store is cleared when the run ends — durable cross-run history requires an app-provided `FileSystemConversationStorage`/custom adapter. This is the intended default (no forced disk I/O); documented in ADR D1 + the changeset.

### EC-4: rounds become stateful (behavior change for existing multi-round callers)
- **Accepted risk:** per ADR D3, this is a fix for a latent defect (memoryless rounds), shipped default-on and documented in the changeset (minor bump). Framework test mocks update from `Agent.create` to `Agent.getOrCreate`.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 2 | 0 | 1 (EC-1) | 1 (EC-3) |
| T1.2 | 1 | 0 | 1 (EC-2) | 0 |
| T2.1 | 1 | 0 | (covers EC-1/EC-2) | 1 (EC-4) |

**Verdict:** PLAN OK (2 SHOULD TEST already in the Phase 2 wiring scope; EC-3/EC-4 documented via ADRs — no plan-blocking changes)
