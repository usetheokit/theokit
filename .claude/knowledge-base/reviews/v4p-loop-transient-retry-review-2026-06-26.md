# Review — V4-P per-round transient retry

**Date:** 2026-06-26 · **Slug:** v4p-loop-transient-retry
**Commits:** 208ea7f (feat) + b9c21ec (abort-cleanup self-review fix) + failed-retry-leak fix
**Reviewers:** 2 independent (adversarial + cross-validation). **Verdict: READY_TO_MERGE**

## Severity matrix (after remediation)
| BLOCKER | HIGH | MEDIUM | LOW | INFO |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 (all fixed) | 1 |

## Adversarial — READY_TO_MERGE
- No-double-edit HOLDS: `startRound` wraps only `factory()` + first `it.next()`; the mid-stream loop calls `it.next()` directly (never via `withRetry`); a mid-stream throw propagates → `DelegationError`.
- Backward-compat + for-await→manual parity HOLDS: `if (!retry) return open()` (single attempt, identical order: abort-check before yield); the cleanup gap was caught in self-review and locked.
- SDK-optional HOLDS: `import type RetryOptions` (erased) + dynamic `import('@theokit/sdk/retry')` only when `retry` set.
- exactly-one-terminal + abort (signal → withRetry; `it.return?.()` on abort) HOLD; tests confirm.
- G6 HOLDS (complexity ≤15; params ≤5 — `RoundInputs` bundle keeps `consumeRoundOrThrow` at 2).
- Edge: empty first event → `stop`; `it.return?.()` undefined-safe.

## Cross-validation — READY_TO_MERGE
- Coverage Matrix 6/6 with code + test evidence; ADR D1 (reuse SDK withRetry, no reimplemented backoff, no static value import) + D2 (opt-in) CONFIRMED against the real SDK contract (no fabrication).
- Goal metric passes; all promised edit sites present; both failure scenarios tested; suite green.
- Positive: praised the self-review abort-cleanup catch.

## LOW findings — RESOLVED
- **LOW-1 (abort mid-round leak):** the for-await→manual refactor dropped `it.return()` on break → fixed (commit b9c21ec) + `test_abort_mid_round_releases_iterator_finally`.
- **LOW-2 (failed-retry attempt leak):** a retried attempt whose first event threw abandoned its iterator → fixed (`open()` try/catch `it.return?.()` before rethrow) + `test_failed_retry_attempt_releases_its_iterator` (asserts BOTH attempts' finally run).
- **LOW-3 (mid-stream-propagate not directly tested):** added `test_mid_stream_throw_propagates_without_retry` (asserts the stream opens exactly once → no re-applied edit).

## Advisory (not fixed — in-scope-by-design / negligible)
- `delegate()` (decorator path) does not expose `retry` — plan D2 explicitly scopes retry to `AgentRunner.stream()`; theocode adopts that path. Clean future additive extension (YAGNI).
- abort-during-backoff-sleep not directly tested — wiring verified + SDK sleep provably abortable.
- INFO: `retry.signal ?? signal` precedence — no current caller passes both.

## Decision
No BLOCKER/HIGH/MEDIUM; all three LOWs remediated with locking tests. Suite 406 passed / 3 skipped; lint + tsc clean. **READY_TO_MERGE.** Final framework prerequisite for the theocode loop adoption (zero regression) — the rest of the adoption is app-side.
