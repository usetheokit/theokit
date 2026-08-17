# Review — agent-conversation-in-core (M46)

**Date:** 2026-07-14
**Slug:** agent-conversation-in-core · **milestone:** M46
**Scope:** commits `c79b195` (core store T1.1+T2.1) + `c8ceb5e` (surface templates T3.1), base `613e21e`.
**Verdict:** **READY_TO_MERGE** (after fixes applied — see below)

## Method

Two independent specialist agents reviewed the M46 change with fresh eyes:

1. **State-machine reviewer** (adversarial trace of the streaming/accumulation store): commit-once across
   all paths, stale-drive/abort guard, id fabrication, `useSyncExternalStore` reference stability,
   `messages` back-compat, surface-collapse visible-behavior regression.
2. **Test-coverage auditor** (`.claude/rules/testing.md` § 4.1 — edge AND negative cases).

## Adjudication of the disagreement

The test-coverage auditor escalated a "mixed chunk ids within a turn → duplicate assistant message" to
CRITICAL/BLOCKER. The state-machine reviewer showed this is **NOT an M46 regression**: the id-stamping only
substitutes a fabricated uuid for an *empty* id; a stream that mixes real + empty ids within one turn would
already have produced two entries pre-M46 (keyed `''` vs the real id). `ai`'s `readUIMessageStream` produces
a consistent id per assistant message for TheoKit's streams, so the scenario is hypothetical and pre-existing.
**Adjudicated DOWN to a regression-guard test** (added), not a blocker.

## Consolidated findings + resolution

| # | Sev | Finding | Resolution |
|---|-----|---------|------------|
| 1 | MEDIUM | `reconnect()` before first `send()` (or after `reset()`) left `#currentAssistantId=''`, stamping replayed assistants with an empty, non-unique id in `thread` (violates the non-empty-id invariant). | **FIXED** — `reconnect()` fabricates `#currentAssistantId` if empty. Test `test_reconnect_before_send_fabricates_nonempty_ids_and_keeps_thread_valid`. |
| 2 | MEDIUM | `reconnect()` did not clear a stale `#error` before setting `status='streaming'` — a retry showed a fresh streaming status beside an old error. | **FIXED** — `reconnect()` clears `#error`. Test `test_reconnect_after_error_clears_error_and_resumes`. |
| 3 | MEDIUM | `test_stale_aborted_drive_does_not_append_to_thread` never released `gates[1]` — a gated stream dangled past the test (flakiness). | **FIXED** — release `gates[1]`, assert clean settle to turn 2 only. |
| 4 | MEDIUM | No regression guard for "send while streaming drops the aborted turn" (documented `status !== 'done'` commit gate). | **FIXED** — test `test_send_while_streaming_drops_the_aborted_turn_from_thread`. |
| 5 | HIGH→guard | SDK-provided message id honored (not overwritten by the fabricated id) was untested. | **FIXED** — test `test_sdk_provided_message_id_is_honored_not_replaced`. |
| 6 | LOW | Hook `reset` test only asserted delegation, not that the transcript returns to the greeting. | **FIXED** — default template + showcase hook tests assert `thread` back to `[greeting]`. |
| 7 | INFO | `desktop/App.tsx.tmpl` opening comment says "M47" (pre-existing Tauri-surface label, not the thread milestone). | Left as-is (pre-existing, no functional impact; not an M46 concern). |

## Sound-by-review (no action)

- Commit-once correct across idle/done/streaming/error/reset/reconnect paths (state-machine trace).
- Stale-drive abort guard holds — a superseded drive cannot append to `messages`/`thread` or clobber status.
- `getSnapshot()` reference-stable between emits (`useSyncExternalStore` contract satisfied).
- `messages` byte-for-byte back-compat; `thread` purely additive.
- Surface collapse introduces no visible-behavior regression (user message visible on first emit; no greeting
  duplication; `onlyGreeting` timing preserved).
- G2 respected — the store is a client boundary, no runtime/LLM/storage reimplementation.

## Gates

- BLOCKER: 0 · HIGH: 0 (after adjudication) · all MEDIUM findings fixed with regression tests.
- Full root suite green (baseline + M46 + 5 new regression tests); `tsc` clean; `eslint --max-warnings=0` clean.

**→ READY_TO_MERGE.**
