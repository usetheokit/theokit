# Review — agents-think-tag-middleware (M2)

**Date:** 2026-06-28
**Slug:** agents-think-tag-middleware
**Milestone:** M2 (`<think>`-tag reasoning middleware)
**Plan:** `.claude/knowledge-base/plans/agents-think-tag-middleware-plan.md` (v1.1)
**Commits reviewed:** `a4f668f` (feat+tests), `23ead13` (ADR 0035), `a7784ac` (review-fix)
**Code-quality:** FAIL_SOFT (70) — every soft cap dismissed by ADR 0035 (pre-existing D2-TS baseline, byte-identical to ADR 0033/0034; M2's new module imports only the local `StreamEvent` type → zero new findings). `/review` may proceed per `cycle-review.md` pre-conditions.

**Verdict:** READY_TO_MERGE

No BLOCKER, no HIGH. Three LOW findings surfaced by the panel were fixed in `a7784ac` before this verdict; remaining INFOs are accepted.

## Method

Three independent specialist reviewers ran in parallel against the M2 diff + plan (read-only): architecture+cross-validation, test-auditor+wiring, code-correctness+error-handling. The correctness reviewer adversarially traced the streaming splitter (`<th`, `<think` no-`>`, `<thinkX`, mid-buffer `<`, `</think` partial, `<<think>`, `<think><think>`) and could not produce dropped chars, an infinite loop, unbounded buffer, or text↔thinking misclassification.

## Findings & resolutions

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | LOW | `extractThinkTagStream`: on a mid-stream source error the post-loop `end()` flush was skipped → a buffered unclosed `<think>` was dropped, diverging from the plan's T3.1 Failure-scenarios claim ("run ends/errors → buffered reasoning flushed"). | **Fixed** `a7784ac` — `end()` flush moved into a `finally`; flushed segments are delivered before the error re-propagates (yield-in-finally). +`test_think_stream_flushes_buffer_when_source_errors`. |
| 2 | LOW | Held-OPEN-prefix-at-EOF (`hi<thi` then end) flushed-as-text path had no regression guard (only the held-CLOSE path was tested). | **Fixed** `a7784ac` — +`test_extractor_unclosed_open_prefix_flushed_as_text`. |
| 3 | LOW | Close-without-open in text mode (`answer</think>more` stays text) untested. | **Fixed** `a7784ac` — +`test_extractor_close_without_open_stays_text`. |
| 4 | INFO | Raw `wc -l` of `sdk-adapter.ts` is 510 (>500); only the G6 code-LoC metric (344) is in budget. | **Accepted** — G6 literally excludes blanks+comments (`system-design-guardrails.md:82`); 344 ≤ 500. Plan AC reconciled to the G6 metric. All three reviewers independently confirmed the reconciliation is legitimate, not a goalpost move. |
| 5 | INFO | Truncated close tag flushes its literal partial (`</thi`) into the thinking content. | **Accepted** — intended ("never silently drop reasoning"); tested. |
| 6 | INFO | Plan T1.1 AC said "10 tests"; file had 11 (then 13 after review fixes). | **Fixed** — counts updated in the plan. |

## Per-dimension verdicts

- **Plan cross-validation — PASS.** T1.1/T2.1/T3.1 + ADRs D1 (pure incremental extractor), D2 (StreamEvent transform touching only `text_delta`), D3 (opt-in default OFF), D4 (wrap inside `createSdkAgentStream`; `streamFactory` bypasses) all implemented as described. Coverage Matrix 9/9 verified against code.
- **Architecture — PASS.** New module `think-tag-extractor.ts` imports only the local `StreamEvent` type (no `@theokit/sdk` runtime, no core) — no G1 violation, no cycle. `parseThinkTags` threaded byte-for-byte like M1's `reasoningEffort` (types → compiler → runner → adapter; resolve `overrides ?? compiled ?? false`). G7 barrel exports consumed. G10 honest: the flag actually wraps the stream (proven by integration test).
- **Tests / wiring — PASS.** All plan RED tests present with exact names + correct assertions; EC-1/EC-2/EC-3 covered; chunk-straddle (both directions), prefix-mismatch corruption, non-string crash, unclosed-at-end, and now error-path-flush + held-open-EOF + close-without-open all guarded. Wiring triad: caller threaded end-to-end to the real `createSdkAgentStream`→`mergeDeltaStream`→`extractThinkTagStream` path, proven by the integration test driving `AgentRunner.stream()` (only `@theokit/sdk` mocked). Suite **480 passed | 3 skipped** (skips pre-existing real-LLM smoke). Deterministic, AAA, `beforeEach` resets the hoisted mock state.
- **Correctness / error-handling / type-safety — PASS.** `heldPrefixLength` + `write()` loop correct (held chars never discarded; `for(;;)` strictly decreasing → terminates; buffer bounded ≤ 7 chars); `end()` flush correct; `??` precedence correct (honors explicit `false`); terminal `done`/`error` preserved outside the wrap; per-round fresh extractor (no state bleed). No `any`/`as`/`@ts-ignore`; explicit return types. `tsc -p packages/agents/tsconfig.test.json` → exit 0.

## Hard gates (cycle-review)

- Tests green on `develop` ✓ (480 passed)
- No secrets committed ✓
- No direct commit to `main` (work on `develop`) ✓
- No Co-Authored-By trailer ✓
- CHANGELOG `[Unreleased]` updated ✓ + changeset `agents-think-tag-middleware.md` (minor) present ✓

## Outcome

READY_TO_MERGE. Release (changeset version bump + `develop→main` PR + manual npm publish per the known OIDC-E404 fallback) is the separate `cycle-release` step, human-gated per Unbreakable Rule 4 — not performed here (the `/goal` stops at READY_TO_MERGE).
