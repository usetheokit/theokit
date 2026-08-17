# Review — V4-N.1 adapter real usage

**Date:** 2026-06-25 · **Slug:** v4n1-adapter-real-usage
**Commits:** e6c7077 (artifacts), a4e1c25 (feat) + LOW-1 finally fix on develop
**Reviewers:** 2 independent (adversarial + cross-validation). **Verdict: READY_TO_MERGE**

## Severity matrix (after LOW-1 remediation)
| BLOCKER | HIGH | MEDIUM | LOW | INFO |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 (L1 fixed) | 2 |

## Adversarial — READY_TO_MERGE
- Exactly-one-terminal proven over the REAL translator (FINISHED→one done; ERROR→one error/no done; no-terminal→fallback done now covered by the unconditional `if (!sawError)`).
- `run.wait()` called once per round, only on the non-error path; stream done suppressed → no double-done.
- wait() rejection → caught → one error, no done (done suppressed); fail-loud.
- Mock sweep complete (6 `@theokit/sdk` mocks have `run.wait()`); real SDK Run has `wait()`.
- Backward compat: done payload shape unchanged (real values now); `Agent = sdk.Agent` (cast removed) typechecks.
- `realUsageDone` helper behavior-identical, complexity ≤ 15; tests non-vacuous.
### LOW-1 (RESOLVED)
- **Finding:** `agent.dispose()` was skipped when `run.wait()` rejects (resource leak; V4-N.1 widened the window with a new throw site before dispose).
- **Remediation:** `agent` declared outside the try; `dispose()` moved to a `finally` (`agent?.dispose()`). New assertion `h.disposeCalls === 1` on the wait-reject path locks it.

## Cross-validation — READY_TO_MERGE
- Coverage Matrix 6/6; Goal metric (done real usage + DelegationResult split) asserted; ADRs D1/D2 match; EC-1/EC-2 tested; 5 mocks + new test present; no manifest change; suite 396 green.
- Faithful close of the V4-N review's M1 (adapter now emits real per-turn usage, completing V4-N's split-usage end-to-end).

## Validation
- `npx vitest run` (packages/agents): 396 passed, 3 skipped. `tsc -p tsconfig.test.json`: 0. Lint (changed): 0.

## Decision
No BLOCKER/HIGH/MEDIUM; the one LOW (dispose-on-reject leak) was fixed (dispose in finally + test). **READY_TO_MERGE.** Completes the framework prerequisites (V4-M + V4-N + V4-N.1) for theocode's loop adoption.
