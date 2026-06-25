# Implementation Summary — V4-L.2 runner run-options

**Slug:** v4l2-runner-run-options
**Date:** 2026-06-25
**Branch:** develop
**Plan:** `knowledge-base/plans/v4l2-runner-run-options-plan.md` (v1.1, plan-confidence SHIPPABLE_WITH_CAVEATS, weighted_avg 100)

## Result

`AgentRunnerRunOptions` gains `model` / `cwd` / `maxIterations`, each merge-over-compiled (Axis-A SWAP), parallel to V4-J `tools`. `cwd` flows into `Agent.create({ local: { cwd } })` → `SystemPromptContext.cwd` (feeds V4-L.1 resolvers). `maxIterations` re-resolves the loop strategy per call (zod fail-loud). Backward-compatible; no new dependency.

## Tasks (TDD)

| Task | RED proof | Status |
|---|---|---|
| T1.1 — fields + threading (agent-runner.ts, sdk-adapter.ts) | `tsc -p tsconfig.test.json` failed (model/cwd/maxIterations not on AgentRunnerRunOptions) before the change | done |
| T2.1 — integration: model/cwd→Agent.create, maxIterations ceiling (step_limit), compose, simple-chat no-op, backward compat | 6 integration tests | done |
| T2.2 — unit: invalid maxIterations throws (zod) | 2 unit tests (0 and -3) | done |

## Validation gate

| Check | Command | Result |
|---|---|---|
| Tests (full agents suite) | `npx vitest run` (packages/agents) | 374 passed, 3 skipped (was 366; +8) |
| Typecheck | `npx tsc --noEmit -p packages/agents/tsconfig.test.json` | exit 0 |
| Lint (changed files) | `npx eslint <4 changed files> --max-warnings=0` | exit 0 |
| File size (G6) | `wc -l` | agent-runner.ts 223, sdk-adapter.ts 177 — ≤ 500 |

## Files changed (5)

- `packages/agents/src/loop/agent-runner.ts` — `AgentRunnerRunOptions` + `model`/`cwd`/`maxIterations` + `stream()` threading (merge-over-compiled; per-call `resolveLoopStrategy`).
- `packages/agents/src/bridge/sdk-adapter.ts` — `createSdkAgentStream` `cwd?` param; merge into `Agent.create.local`; `M8CreateOptions.local` widened.
- `packages/agents/tests/integration/runtime-overrides.test.ts` (NEW) — 6 tests (SDK-native mock; model/cwd/ceiling/compose/no-op/BC).
- `packages/agents/tests/unit/runner-maxiterations-override.test.ts` (NEW) — 2 tests (fail-loud).
- `.changeset/v4l2-runner-run-options.md` (NEW) — minor bump.

## Key implementation notes

- The integration mock yields SDK-NATIVE messages (`assistant`/`tool_call status:completed`/`status:FINISHED`) so they pass through `translateSdkEvent`; a unique assistant text per round keeps round signatures distinct so the `no_progress` detector does not mask the `maxIterations` ceiling (`step_limit`).
- `maxIterations` override re-resolves via `resolveLoopStrategy(this.loopStrategy.name, opts.maxIterations)` (reuses the existing zod `min(1)` guard); the build-time `this.loopStrategy` is never mutated (concurrent-call safe).

## Pre-existing issues (NOT introduced — for PR description)

- Folder-wide eslint debt in other agents tests; bare-`tsc` TS6059 rootDir quirk; transitive `valibot` HIGH via `@theokit/ui` in fixtures (see deps-audit). All pre-existing, out of scope.

## Deviations from plan

None. All 7 coverage-matrix gaps closed; the 2 edge-case SHOULD-TEST items (EC-1 compose, EC-2 simple-chat no-op) absorbed into T2.1 and pass.
