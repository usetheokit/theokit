# Implementation Summary — V4-M loop session history

**Slug:** v4m-loop-session-history
**Date:** 2026-06-25
**Branch:** develop
**Plan:** `knowledge-base/plans/v4m-loop-session-history-plan.md` (v1.1, plan-confidence SHIPPABLE_WITH_CAVEATS, weighted_avg 100)

## Result

`AgentRunner.stream()` rounds share a persisted SDK session: each round `Agent.getOrCreate(sessionId, { conversationStorage })` with ONE shared store (default `InMemoryConversationStorage`); rounds 2+ send the continuation/reflection, not the original message. Closes the blocking gap for theocode's loop adoption. Reuses SDK primitives; no new dependency.

## Empirical de-risk (spike)

Before implementing, a throwaway spike against the REAL `@theokit/sdk@2.9.0` confirmed the D1 lifecycle assumption: `Agent.getOrCreate(id, { conversationStorage })` accepts a shared `InMemoryConversationStorage` (no LLM/cwd needed), and the store survives `dispose` + a second `getOrCreate`. Spike passed → mechanism sound → implemented (then deleted the spike).

## Tasks (TDD)

| Task | RED proof | Status |
|---|---|---|
| T1.1 — shared store + getOrCreate (sdk-adapter) | new test referenced `conversationStorage` / getOrCreate wiring absent before the change | done |
| T1.2 — continuation prompt (run-reflective-loop) | `loop-session-history` round-2 assertion before the buildPrompt change | done |
| T2.1 — wiring proof + mock updates | 4 session tests; updated 5 SDK-mock test files create→getOrCreate | done |

## Validation gate

| Check | Command | Result |
|---|---|---|
| Tests (full agents suite) | `npx vitest run` (packages/agents) | 387 passed, 3 skipped (was 383; +4 new, others updated) |
| Typecheck | `npx tsc --noEmit -p packages/agents/tsconfig.test.json` | exit 0 |
| Lint (changed files) | `npx eslint <9 changed files> --max-warnings=0` | exit 0 |
| File size (G6) | `wc -l` | sdk-adapter 239, run-reflective-loop 363, agent-runner 256 — ≤ 500 |

## Files changed (9)

- `packages/agents/src/bridge/sdk-adapter.ts` — `RuntimeOverrides.conversationStorage`; one shared store per run; `Agent.getOrCreate(sessionId, …)` (was `Agent.create`); `buildExtraCreateOptions` helper (complexity budget).
- `packages/agents/src/loop/run-reflective-loop.ts` — `CONTINUE_PROMPT`; `buildPrompt` rounds-2+ continuation (no message re-send).
- `packages/agents/src/loop/agent-runner.ts` — `AgentRunnerRunOptions.conversationStorage` + threading.
- `packages/agents/tests/integration/loop-session-history.test.ts` (NEW) — 4 wiring tests (same session + shared store across rounds; round-1 original vs round-2 continuation; default store created once; override honored).
- `packages/agents/tests/integration/{runtime-overrides,systemprompt-resolver-stream,m8-adapter-wiring,sdk-adapter-translation}.test.ts` — SDK mocks updated create→getOrCreate + `InMemoryConversationStorage` stub.
- `packages/agents/tests/unit/main-loop-runtime.test.ts` — round-2 assertion updated to the V4-M contract (no original re-send).
- `.changeset/v4m-loop-session-history.md` (NEW) — minor bump, documents the rounds-now-stateful fix.

## Behavior change (ADR D3, documented)

Rounds are now stateful by default (was memoryless). This is a fix for a latent defect; framework test mocks updated; communicated in the changeset.

## Pre-existing issues (NOT introduced — for PR description)

- Bare-`tsc` TS6059 rootDir quirk; transitive `valibot` HIGH via `@theokit/ui` in fixtures. Pre-existing, out of scope.

## Deviations from plan

The plan listed 2 mock files to update; the signature/runtime change (create→getOrCreate + InMemoryConversationStorage default) actually required updating 4 SDK-mock files + 1 behavior-assertion test (`main-loop-runtime`) — caught by the failing suite, all mechanical/typecheck+runtime-forced, not scope creep. Disclosed here.
