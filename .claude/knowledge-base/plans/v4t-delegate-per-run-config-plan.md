---
slug: v4t-delegate-per-run-config
milestone_id: V4-T
created_at: 2026-06-26
goal: Give delegate() the same per-run config surface as AgentRunner.stream() so a sub-agent inherits the parent's runtime config.
---

# Plan: V4-T — `delegate()` carries per-run runtime config (parity with `AgentRunner.stream()`)

> **Version 1.0** — `delegate()` (the `@SubAgents`/imperative sub-agent on-ramp) builds its stream via `createSdkAgentStream(compiled, allTools, apiKey, { model })` — forwarding ONLY `model`. The sibling on-ramp `AgentRunner.stream()` forwards the full per-run surface (`cwd`/`plugins`/`providers`/`agents`/`budgetTracker`/`conversationStorage`/`sdkTools` via `RuntimeOverrides`, plus `retry`/custom `reflection` to the loop). So a consumer (theocode) cannot delegate to a sub-agent with its per-run providers (OpenRouter routing), permission plugins (read-only for explore), cwd (the task repo), or pre-built SDK tools — adopting `delegate()` today would REGRESS that config. V4-T adds those optional fields to `DelegateOptions` and forwards them (the adapter's `RuntimeOverrides` + the loop's `RunReflectiveLoopConfig` ALREADY accept every one — this is pure plumbing). Additive + backward-compatible.

## Goal

> "Enable `delegate()` to forward per-run `cwd`/`plugins`/`providers`/`agents`/`budgetTracker`/`conversationStorage`/`sdkTools`/`model`/`retry`/`reflection` so a sub-agent runs with the parent's runtime config, measured by `npx vitest run packages/agents/tests/integration/delegate-per-run-config.test.ts` passing (a mock capture proves each forwarded field reaches `Agent.getOrCreate` / the loop)."

## Context

theocode's loop-adoption deep review (opportunity #3) found `runExplore`/`defaultSummarize` could move to `delegate()`/`@SubAgents`, but `DelegateOptions` only exposes `budget`/`apiKey`/`sessionId`/`signal`/`parentTools` — so delegating would lose the per-run providers/plugins/cwd that `runOptsForMode` sets on the main path. The fix is framework-side: `delegate()` should accept the same per-run surface `AgentRunner.stream()` already does. The plumbing is trivial because `createSdkAgentStream`'s `RuntimeOverrides` (V4-L.2/L.3/M/Q) and `RunReflectiveLoopConfig.retry` (V4-P) already accept every field — `delegate()` just doesn't pass them.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit | Why it exists | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/bridge/agent-orchestrator.ts` | ~145 | (V4-D) | `delegate()` + `DelegateOptions`; builds the stream via `createSdkAgentStream({ model })` only | budget clamp + tool merge + session isolation UNCHANGED; same return type |
| `packages/agents/tests/integration/delegate-per-run-config.test.ts` (NEW) | 0 | — | (file to be created) | — |

### Current callers / dependents

- **`delegate()`** (`agent-orchestrator.ts:70`) — used by `@SubAgents` resolution + any imperative consumer; signature `delegate(SubAgentClass, message, opts?)` preserved (opts gains optional fields).
- **`createSdkAgentStream`** (`sdk-adapter.ts:74` `RuntimeOverrides`) — ALREADY accepts `model`/`cwd`/`plugins`/`providers`/`agents`/`budgetTracker`/`conversationStorage`/`sdkTools`. `delegate()` currently passes only `{ model }`.
- **`runReflectiveLoop`** (`run-reflective-loop.ts` `RunReflectiveLoopConfig`) — ALREADY accepts `retry`. `delegate()` currently passes `loop`/`reflection`/`budget`/`agentName`/`signal`.
- **`AgentRunner.stream()`** (`agent-runner.ts`) — the parity reference: it forwards all of the above. V4-T brings `delegate()` to the same surface.

### Domain glossary

- **per-run config** — the Axis-A SWAP fields a caller holds at call time (`cwd`/`plugins`/`providers`/`agents`/`budgetTracker`/`conversationStorage`/`sdkTools`/`model`/`retry`), distinct from the agent's compiled (decorator) config.
- **on-ramp parity** — `delegate()` and `AgentRunner.stream()` are the two on-ramps to the SAME `runReflectiveLoop` driver; they should expose the SAME per-run surface ("one runtime, two on-ramps", established when `AgentRunner` was introduced).

### Architecture boundaries affected

- None new. `delegate()` already imports `createSdkAgentStream` + `runReflectiveLoop`; V4-T forwards more of their EXISTING option surface. SDK stays the only runtime (G2); no dependency change (G1).

## Prior Art & Related Work

- **In-repo precedent** — V4-L.2/L.3 (`AgentRunnerRunOptions` per-run fields), V4-M (`conversationStorage`), V4-P (`retry`), V4-Q (`sdkTools`), V4-R (`streamFactory`): each added a per-run field to `AgentRunner.stream()`. V4-T brings the same set to `delegate()`.
- **Consumer** — theocode `runExplore`/`defaultSummarize` need the parent's providers/plugins/cwd to delegate (deep-review opportunity #3).

## Objective

- [ ] `DelegateOptions` gains optional `model`/`cwd`/`plugins`/`providers`/`agents`/`budgetTracker`/`conversationStorage`/`sdkTools`/`retry`/`reflection`.
- [ ] `delegate()` forwards the `RuntimeOverrides` fields to `createSdkAgentStream` (merging `model` over `walk.agentConfig.model`) and `retry`/`reflection` to `runReflectiveLoop`.
- [ ] Backward compatibility: absent ⇒ identical behavior (only `model` from the decorator, ladder/noop reflection).
- [ ] A test proves each forwarded field reaches `Agent.getOrCreate` (via mock capture) + the loop (retry/reflection).

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none new) | | | V4-T forwards EXISTING option surfaces (`RuntimeOverrides`, `RunReflectiveLoopConfig`). |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | | No dependency added. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## ADRs

### D1 — Forward the per-run surface from `DelegateOptions` (parity with `AgentRunnerRunOptions`)

- **Decision:** `DelegateOptions` gains the optional per-run fields; `delegate()` passes them into the `createSdkAgentStream` overrides object (`model: opts.model ?? walk.agentConfig.model`, plus `cwd`/`plugins`/`providers`/`agents`/`budgetTracker`/`conversationStorage`/`sdkTools`) and `retry`/`reflection` into the loop config.
- **Rationale:** the two on-ramps share one runtime ("one runtime, two on-ramps"); they should share the per-run surface. The adapter + loop already accept every field — withholding them at `delegate()` is an arbitrary asymmetry that blocks real adoption (theocode #3). Reuse, not reinvention (Rule 9).
- **Alternatives considered:** (a) Leave `delegate()` minimal, tell consumers to express config on the sub-agent decorator — REJECTED: per-run values (cwd=task repo, providers, mode-selected permission plugin) are NOT static decorator config; they vary per call. (b) A separate `delegateWithConfig()` — REJECTED: API bloat; one additive opts surface is simpler (KISS).
- **Consequences:** `delegate()` reaches parity with `AgentRunner.stream()`; absent fields ⇒ byte-identical to today.

### D2 — `reflection` override optional; default stays the strategy-derived ladder/noop

- **Decision:** `DelegateOptions.reflection?: ReflectionStrategy`; when absent, keep the current `plan-act-reflect ? ladder : noop` derivation.
- **Rationale:** a consumer with a custom ladder (theocode's `codeReflectionStrategy`) should be able to delegate with it; absent ⇒ unchanged default.
- **Alternatives considered:** (a) Always derive from strategy — REJECTED: blocks a custom reflection on the delegate path (the same capability `AgentRunner.builder().reflection()` already gives).
- **Consequences:** one optional field; default behavior preserved.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Larger `DelegateOptions` surface | Low | All optional + additive; mirrors `AgentRunnerRunOptions` (familiar shape) | maintainer |
| `model` precedence (opts vs decorator) | Low | `opts.model ?? walk.agentConfig.model` (opts wins, like `AgentRunner`); test asserts both | maintainer |
| Forwarding a field the adapter ignores | Low | Every forwarded field is already in `RuntimeOverrides`/`RunReflectiveLoopConfig` (grep-verified); tsc enforces | maintainer |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (DelegateOptions per-run fields + forwarding in delegate()) ──▶ Phase 2 (TDD proof: each field reaches Agent.getOrCreate / the loop; absent ⇒ default)
                                                                          │
                                                                          ▼
                                                                 Final Phase: Integration Validation
```

## Phase 1: Forward per-run config

**Objective:** `DelegateOptions` carries the per-run surface; `delegate()` forwards it.

### T1.1 — DelegateOptions fields + forwarding

#### Objective
Add the optional fields to `DelegateOptions`; in `delegate()` build the `createSdkAgentStream` overrides from them (model merge) + pass `retry`/`reflection` to `runReflectiveLoop`.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — extends `DelegateOptions` with the per-run fields (types imported from `@theokit/sdk` + `@theokit/sdk/retry` + the loop's `ReflectionStrategy`), and replaces the `{ model: walk.agentConfig.model }` override object + the bare loop config with the forwarded values.
2. **Why it is necessary now** — it is the fix (ADR D1); without it `delegate()` can't carry per-run config, blocking theocode #3.

#### Evidence
`agent-orchestrator.ts:27-39` (`DelegateOptions`), `:89-91` (`createSdkAgentStream({ model })`), `:98-104` (loop config); `sdk-adapter.ts:74-99` (`RuntimeOverrides` accepts all); `run-reflective-loop.ts:60` (`retry`).

#### Files to edit
```
packages/agents/src/bridge/agent-orchestrator.ts — DelegateOptions fields; forward to createSdkAgentStream + runReflectiveLoop
```

#### Deep file dependency analysis
- `agent-orchestrator.ts` — `import type { PluginsSettings, ProviderRoutingSettings, AgentDefinition, BudgetTracker, ConversationStorageAdapter, CustomTool } from '@theokit/sdk'`, `RetryOptions` from `@theokit/sdk/retry`, `ReflectionStrategy` from the loop. Build `overrides` = the per-run fields; `createSdkAgentStream(compiled, allTools, apiKey, { model: opts.model ?? walk.agentConfig.model, cwd: opts.cwd, plugins: opts.plugins, providers: opts.providers, agents: opts.agents, budgetTracker: opts.budgetTracker, conversationStorage: opts.conversationStorage, sdkTools: opts.sdkTools })`. Loop config gains `retry: opts.retry` + `reflection: opts.reflection ?? <derived>`.

#### Deep Dives
- **Invariant:** absent fields ⇒ `{ model: walk.agentConfig.model }` + derived reflection (today's behavior).
- **Edge case:** `opts.model` set ⇒ wins over decorator (parity with `AgentRunner`).
- **Edge case:** `opts.reflection` set ⇒ used; absent ⇒ `plan-act-reflect ? ladder : noop`.

#### Pseudo-code / Signatures
```ts
// DelegateOptions += model?, cwd?, plugins?, providers?, agents?, budgetTracker?,
//                    conversationStorage?, sdkTools?, retry?, reflection?
const streamFactory = createSdkAgentStream(compiled, allTools, apiKey, {
  model: opts.model ?? walk.agentConfig.model,
  cwd: opts.cwd, plugins: opts.plugins, providers: opts.providers,
  agents: opts.agents, budgetTracker: opts.budgetTracker,
  conversationStorage: opts.conversationStorage, sdkTools: opts.sdkTools,
})
return runReflectiveLoop(streamFactory, message, sessionId, {
  loop: loopStrategy,
  reflection: opts.reflection ?? (loopStrategy.name === 'plan-act-reflect' ? ladderReflectionStrategy : noopReflectionStrategy),
  budget, agentName: SubAgentClass.name, signal: opts.signal, retry: opts.retry,
})
```

#### Tasks
1. Add the optional fields to `DelegateOptions` (+ imports).
2. Forward them in the `createSdkAgentStream` overrides + loop config.
3. Run typecheck + lint.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Types compile: `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Pass: complexity — `npx eslint packages/agents/src/bridge/agent-orchestrator.ts --max-warnings=0`
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/delegate-per-run-config.test.ts` ≥ 90% on changed files
- [ ] Pass: lint — `npx eslint packages/agents/src --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/src/bridge/agent-orchestrator.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

## Phase 2: TDD proof

**Objective:** prove each forwarded field reaches the adapter/loop; absent ⇒ default.

### T2.1 — Per-run forwarding test

#### Objective
A test mocks `@theokit/sdk` (`Agent.getOrCreate` captures opts) and drives `delegate(SubAgent, msg, { apiKey, cwd, providers, plugins, sdkTools, model })`; asserts the captured `Agent.getOrCreate` opts contain them; a `retry` case asserts a transient round-start is retried; an absent-opts case asserts the decorator `model` + no extra keys.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — captures `Agent.getOrCreate({ model, local:{cwd}, plugins, providers, agents, tools, ... })` and asserts the forwarded fields; uses a fake retryable factory for the retry case (mirroring V4-P tests).
2. **Why it is necessary now** — the forwarding is the Goal's metric; without the test it's unproven.

#### Evidence
V4-N.1/V4-O/V4-Q adapter mock tests (hoisted `Agent.getOrCreate` capture) + V4-P loop retry tests are the templates.

#### Files to edit
```
packages/agents/tests/integration/delegate-per-run-config.test.ts (NEW) — forwarding + retry + absent-default cases
```

#### Deep file dependency analysis
- New test mocks `@theokit/sdk` (`Agent.getOrCreate` captures; `defineTool`; `InMemoryConversationStorage`), defines a `@Agent @MainLoop` SubAgent, calls `delegate(SubAgent, 'hi', { apiKey:'k', cwd:'/repo', providers:{...}, plugins:{...} as never, sdkTools:[fake], model:'override' })`, asserts `captured.local.cwd === '/repo'`, `captured.model.id === 'override'`, `captured.providers`/`plugins` present, `captured.tools` includes the sdkTool.

#### Deep Dives
- **Assertion (forward):** each per-run field present on the captured `Agent.getOrCreate` opts.
- **Assertion (model precedence):** `opts.model` wins over the decorator `model`.
- **Assertion (absent):** no `local`/`plugins`/etc. keys when not passed (byte-identical to today).
- **Assertion (retry):** a factory whose first round start throws retryable → recovered (via a custom `streamFactory`? — NO: delegate has no streamFactory; instead pass `retry` + a mock `Agent.getOrCreate` whose first `send` throws once then succeeds). Keep it simple: assert `retry` is threaded by checking the loop retries the start (reuse the V4-P pattern through the real adapter mock).

#### Pseudo-code / Signatures
```ts
await delegate(SubAgent, 'hi', { apiKey: 'k', cwd: '/repo', model: 'override', sdkTools: [fakeTool] as never, providers: {...} as never })
expect(h.captured.local?.cwd).toBe('/repo')
expect(h.captured.model?.id).toBe('override')
expect(h.captured.tools).toContain(fakeTool)
```

#### Tasks
1. Create `delegate-per-run-config.test.ts` (forward + model-precedence + absent + retry).
2. Run the suite.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Forwarding proven: `npx vitest run packages/agents/tests/integration/delegate-per-run-config.test.ts`
- [ ] Full suite green: `npx vitest run packages/agents`
- [ ] Pass: complexity — `npx eslint packages/agents/tests/integration/delegate-per-run-config.test.ts --max-warnings=0`
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/delegate-per-run-config.test.ts` exercises the forwarding
- [ ] Pass: lint — `npx eslint packages/agents/tests --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/tests/integration/delegate-per-run-config.test.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| G1 | delegate() forwards only model | T1.1, T2.1 | DelegateOptions per-run fields forwarded to createSdkAgentStream (ADR D1) |
| G2 | loop retry/custom reflection not reachable via delegate | T1.1, T2.1 | retry + reflection forwarded to runReflectiveLoop (ADR D1/D2) |
| G3 | model precedence | T1.1, T2.1 | opts.model ?? walk.agentConfig.model |
| G4 | backward compat (absent ⇒ default) | T1.1, T2.1 | all optional; absent ⇒ today's behavior |
| G5 | proof fields reach the adapter/loop | T2.1 | mock capture + retry assertion |

**Coverage: 5/5 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `rules/architecture.md` / G6)
- [ ] CHANGELOG.md updated — add a changeset (minor bump `@theokit/agents`)
- [ ] Backward compatibility preserved (additive optional fields; absent ⇒ default)
- [ ] Plan-specific: `npx vitest run packages/agents/tests/integration/delegate-per-run-config.test.ts` passes (the Goal metric)
- [ ] **Runtime-metric proof** — n/a (no new counter)
- [ ] **Plan archived** — after `/review` READY_TO_MERGE AND PR merged

## Failure scenarios (when I/O external)

```
(none — no external I/O touched; forwards existing option surfaces)
```

The SDK owns the model call (mocked in tests); V4-T only forwards config into the already-mocked adapter/loop.

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 1-2. The plan is NOT done until this chain passes.

### Execution
```
npx vitest run packages/agents
npx vitest run --coverage packages/agents
npx tsc --noEmit -p packages/agents/tsconfig.test.json
npx eslint packages/agents/src --max-warnings=0
```

### Acceptance Criteria
- [ ] All test suites green — `npx vitest run packages/agents`
- [ ] Coverage ≥ 90% on changed files — `npx vitest run --coverage packages/agents`
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] Runtime-metric proof — n/a this slice
- [ ] Failure scenarios green — n/a

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
