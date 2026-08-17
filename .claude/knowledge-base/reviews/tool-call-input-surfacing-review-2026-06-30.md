# Review — tool-call-input-surfacing (theokit#58)

**Date:** 2026-06-30
**Verdict:** READY_TO_MERGE
**Commits reviewed:** 77672ab (fix + tests) + review-fix (primitive-args test)
**Reviewer:** independent agent (fresh eyes) + operator

## Summary

One-field fix in `packages/agents/src/bridge/event-translator.ts` `translateToolCallEvent` running branch: `input: msg.args ?? msg.input ?? msg.arguments ?? {}`, leading with the real `@theokit/sdk` `SDKToolUseMessage.args` field (`run-D22b53SU.d.ts:486`). Minimal, behavior-preserving except for the bug fix, confined to the bridge translator, covered by 4 unit + 2 integration tests with real deep-equal assertions.

## Findings by severity

- **BLOCKER:** none
- **HIGH:** none
- **MEDIUM:** none
- **LOW:** (1, RESOLVED) primitive `args` passthrough lacked a test vs the plan's Failure-scenarios table → added `test_running_tool_call_nonobject_args_passthrough` (25 unit tests now pass).
- **INFO:** EC-1 SDK version skew (resolved 2.9.0 < peer floor 2.11.2; `args` shape identical, deferred); `??` (nullish) semantics correctly preserve a legitimately-empty `args:{}`.

## Hard gates (cycle-review.md)

| Gate | Status |
|---|---|
| No failing tests on branch | PASS — `@theokit/agents` 514 pass (513 + new), 3 skipped (real-LLM smoke), 0 fail |
| No new secrets | PASS — TS + docs only; integration uses `'test-key'` fixture |
| No direct commit to `main` | PASS — on `develop` |
| No Co-Authored-By trailer | PASS — commit body ends at "Closes #58" |
| CHANGELOG updated | PASS — `[Unreleased] § Fixed` + changeset `@theokit/agents: patch` |
| eslint clean | PASS — `--max-warnings=0` on changed files |
| /code-quality ∉ {FAIL_HARD, INVALID} | PASS — FAIL_SOFT only (`symbol_fab_unverifiable_typescript`, dismissed: tsc-clean is authoritative for TS symbol resolution; D2-TS is package-name-only by design) |

## Plan ↔ implementation ↔ tests consistency

The shipped expression is verbatim the plan's ADR D1. The blueprint's superseded completed-patch hypothesis was correctly NOT implemented (refuted by live TC-DIAG). `completed`/`error`/onDelta branches untouched — no double-emit, no dedup change. Every Coverage-Matrix testable row maps to a passing test (incl. the integration test driving the real `createSdkAgentStream` with only `@theokit/sdk` mocked).

## Decision

READY_TO_MERGE. Proceed to release: publish `@theokit/agents` (patch) → `theokit` bumps the dep → theocode adopts → live UI evidence (tool card shows the command).
