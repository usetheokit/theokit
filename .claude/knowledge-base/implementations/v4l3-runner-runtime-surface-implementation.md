# Implementation Summary — V4-L.3 runner runtime surface

**Slug:** v4l3-runner-runtime-surface
**Date:** 2026-06-25
**Branch:** develop
**Plan:** `knowledge-base/plans/v4l3-runner-runtime-surface-plan.md` (v1.1, plan-confidence SHIPPABLE_WITH_CAVEATS, weighted_avg 100)

## Result

`AgentRunnerRunOptions` gains `plugins`/`providers`/`agents`/`budgetTracker` (Axis-A SWAP), each forwarded to `Agent.create` when present. `createSdkAgentStream`'s per-request params collapsed into a `RuntimeOverrides` object (no parameter explosion; single model-resolution site). Completes the per-request `Agent.create` surface theocode needs. Backward-compatible; no new dependency.

## Tasks (TDD)

| Task | RED proof | Status |
|---|---|---|
| T1.1 — RuntimeOverrides refactor + 4 fields + threading + spread + caller updates | `tsc -p tsconfig.test.json` failed (4 fields not on AgentRunnerRunOptions) before the change | done |
| T2.1 — integration: 4 reach Agent.create, compose, omission, EC-1 budget+budgetTracker coexist, EC-2 empty-array forwarded | 8 integration tests | done |

## Validation gate

| Check | Command | Result |
|---|---|---|
| Tests (full agents suite) | `npx vitest run` (packages/agents) | 383 passed, 3 skipped (was 375; +8) |
| Typecheck | `npx tsc --noEmit -p packages/agents/tsconfig.test.json` | exit 0 |
| Lint (changed files) | `npx eslint <7 changed files> --max-warnings=0` | exit 0 |
| File size (G6) | `wc -l` | sdk-adapter.ts 210, agent-runner.ts 248 — ≤ 500 |

## Files changed (8)

- `packages/agents/src/bridge/sdk-adapter.ts` — `RuntimeOverrides` interface + 4 type imports; `createSdkAgentStream(compiled, tools, apiKey, overrides={})`; conditional spread of plugins/providers/agents/budgetTracker + cwd into `Agent.create`.
- `packages/agents/src/loop/agent-runner.ts` — 4 fields on `AgentRunnerRunOptions`; `stream()` builds the `RuntimeOverrides`.
- `packages/agents/src/bridge/agent-orchestrator.ts` — delegate call updated to the object form.
- `packages/agents/tests/smoke/sdk-real-llm.test.ts` — 3 calls updated to `{ model }`.
- `packages/agents/tests/integration/{sdk-adapter-translation,m8-adapter-wiring}.test.ts` — 2 calls updated to `{ model: ... }`.
- `packages/agents/tests/integration/runtime-overrides.test.ts` — +8 V4-L.3 tests (reuse the V4-L.2 capture mock).
- `.changeset/v4l3-runner-runtime-surface.md` (NEW) — minor bump.

## Key notes

- **RuntimeOverrides refactor (ADR D2):** collapsing `envModel`/`cwd` positionals + the 4 new fields into one object avoided a 9-positional signature and removed the V4-L.2 review L1 nit (model now resolves only in the adapter). Blast radius: 6 call sites (delegate + 5 test calls), all mechanical + typecheck-guarded.
- **agents (ADR D3):** opts-only; `compiled.agents` (@SubAgents) stays deferred — `CompiledSubAgent` is not an `AgentDefinition` and has no consumer.
- **budgetTracker (ADR D4):** distinct layer from `budget` (inner SDK tool-loop vs outer reflective USD) — both coexist (EC-1 test).

## Pre-existing issues (NOT introduced — for PR description)

- Folder-wide eslint debt in other agents tests; bare-`tsc` TS6059 rootDir quirk; transitive `valibot` HIGH via `@theokit/ui` in fixtures. All pre-existing, out of scope.

## Deviations from plan

None. All 7 coverage-matrix gaps closed; the 2 edge-case SHOULD-TEST items (EC-1, EC-2) absorbed into T2.1 and pass. Two additional call sites (`sdk-adapter-translation`, `m8-adapter-wiring`) beyond the plan's listed 5 were updated for the signature change (caught by typecheck) — a complete-the-refactor necessity, not a scope change.
