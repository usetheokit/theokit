---
slug: v4r-runner-stream-factory
milestone_id: V4-R
created_at: 2026-06-26
goal: Let AgentRunner accept an injectable RoundStreamFactory so a consumer can drive the loop with its own per-round stream.
---

# Plan: V4-R — `AgentRunner` accepts an injectable `RoundStreamFactory`

> **Version 1.0** — `AgentRunner.stream()` builds its per-round stream INTERNALLY (`createSdkAgentStream(...)`) with no injection point, so a consumer cannot drive the reflective loop with its own stream (for tests, or a custom transport). theocode's ~30 test files inject a mock stream at its `runCodeAgent` boundary; adopting `AgentRunner.stream()` without an injection seam would force a 30-file test-mock rewrite. V4-R adds `streamFactory?: RoundStreamFactory` to the per-run options: when provided, the loop uses it INSTEAD of `createSdkAgentStream`; absent ⇒ the SDK adapter (unchanged). `RoundStreamFactory` is exported from the package barrel so consumers can type their factory. Additive + backward-compatible; no new dependency.

## Goal

> "Enable `AgentRunner.stream()` to drive the reflective loop with a caller-provided `RoundStreamFactory`, measured by `npx vitest run packages/agents/tests/integration/runner-stream-factory.test.ts` passing (the injected factory's events flow through the loop; `createSdkAgentStream` is not called)."

## Context

theocode's loop-adoption discover proved the loop + tools capabilities are complete (V4-M/N/N.1/O/P/Q) but testability is not: theocode's suite injects a mock stream (`LlmStreamFn`) at `runCodeAgent`; `AgentRunner.stream()` has no equivalent seam (it calls `createSdkAgentStream` directly, then `runReflectiveLoopStream(factory, ...)`). The loop already takes a `RoundStreamFactory` — V4-R exposes that injection one level up (the runner) + on the barrel.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/loop/agent-runner.ts` | ~285 | `883500a` (2026-06-26) | `AgentRunner.stream` builds `createSdkAgentStream(...)` then `runReflectiveLoopStream` | default path unchanged when `streamFactory` absent; same signatures |
| `packages/agents/src/index.ts` | — | (barrel) | the package public barrel | additive export only |
| `packages/agents/tests/integration/runner-stream-factory.test.ts` (NEW) | 0 | — | (file to be created) | — |

### Current callers / dependents

- **`AgentRunner.stream`** (`agent-runner.ts:186-198`) — builds `streamFactory = createSdkAgentStream(this.compiled, tools, opts.apiKey, {...})` then `runReflectiveLoopStream(streamFactory, message, sessionId, {...})`. V4-R: `const streamFactory = opts.streamFactory ?? createSdkAgentStream(...)`.
- **`RoundStreamFactory`** (`run-reflective-loop.ts:28`, `(message, sessionId) => AsyncIterable<StreamEvent>`) — already the loop's factory type; not yet on the barrel.
- **Consumer** — theocode's `runCodeAgent` will inject a factory wrapping its mock `LlmStreamFn` (reverse-translating AgentEvent→StreamEvent) so its existing test mocks stay unchanged.

### Domain glossary

- **`RoundStreamFactory`** — `(message, sessionId) => AsyncIterable<StreamEvent>`: produces one round's event stream; the loop consumes it per round.
- **injectable factory** — a per-run `streamFactory` that REPLACES `createSdkAgentStream` for that call (tests / custom transport); absent ⇒ the SDK adapter.

### Architecture boundaries affected

- None new. `RoundStreamFactory` + `StreamEvent` are existing loop types; V4-R exposes the factory on the barrel and as a run-option. SDK stays the only DEFAULT runtime (G2); an injected factory is the consumer's responsibility.

## Prior Art & Related Work

- **In-repo precedent** — `runReflectiveLoopStream` already takes a `RoundStreamFactory` (the loop is factory-driven); `delegate()` + `AgentRunner` both construct it via `createSdkAgentStream`. V4-R lifts the injection to the runner's run-options (V4-L precedent for per-run fields).
- **Consumer pattern** — theocode injects a mock stream for tests (its `runCodeAgent` `opts.stream`); V4-R gives `AgentRunner` the same seam.

## Objective

- [ ] `AgentRunnerRunOptions` gains `streamFactory?: RoundStreamFactory`.
- [ ] `AgentRunner.stream` uses `opts.streamFactory ?? createSdkAgentStream(...)`.
- [ ] `RoundStreamFactory` is exported from the package barrel.
- [ ] Backward compatibility: absent ⇒ identical behavior (SDK adapter path).
- [ ] A test proves the injected factory drives the loop and `createSdkAgentStream` is not invoked.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none new) | | | V4-R is internal — exposes an existing loop type as a run-option + barrel export. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | | | | No dependency added. |

### Removed

| Package | Last version | Why removed |
|---|---|---|

## ADRs

### D1 — Inject the factory via a per-run option (default `createSdkAgentStream`)

- **Decision:** `AgentRunnerRunOptions.streamFactory?: RoundStreamFactory`; `AgentRunner.stream` does `const streamFactory = opts.streamFactory ?? createSdkAgentStream(...)`.
- **Rationale:** the loop is already factory-driven; exposing the injection at the runner gives consumers (tests, custom transports) a seam without touching the loop or the SDK default. Per-run is the right axis (a test injects per call).
- **Alternatives considered:** (a) Export `runReflectiveLoopStream` so consumers call the loop directly — REJECTED: leaks the internal driver + duplicates the runner's compile/resolve wiring. (b) A builder `.streamFactory()` — REJECTED: the factory is per-run (test-specific), not build-time.
- **Consequences:** when absent the SDK adapter path is byte-identical; an injected factory bypasses the compiled tools / SDK create (the consumer owns the stream).

### D2 — Export `RoundStreamFactory` from the barrel

- **Decision:** add `RoundStreamFactory` to the package's public exports.
- **Rationale:** a consumer typing its injected factory needs the type; it is the documented run-option's contract.
- **Alternatives considered:** (a) Keep it internal + let consumers inline the structural type — REJECTED: drift risk; the run-option references the type, so it must be public.
- **Consequences:** one additive type export.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| An injected factory bypasses compiled tools / SDK create | Low | Documented: when `streamFactory` is set, the consumer owns the stream (tools/model/etc. are the consumer's responsibility) | maintainer |
| `streamFactory` + other run-options (tools/model) silently ignored | Low | JSDoc states the injected factory supersedes the SDK-create options for that call | maintainer |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (run-option + barrel export + stream wiring) ──▶ Phase 2 (TDD proof: injected factory drives the loop; absent ⇒ SDK adapter)
                                                            │
                                                            ▼
                                                   Final Phase: Integration Validation
```

## Phase 1: Inject the factory

**Objective:** `AgentRunner.stream` honors `opts.streamFactory`; `RoundStreamFactory` is exported.

### T1.1 — Run-option + wiring + barrel export

#### Objective
Add `streamFactory?: RoundStreamFactory` to `AgentRunnerRunOptions`; `AgentRunner.stream` uses `opts.streamFactory ?? createSdkAgentStream(...)`; export `RoundStreamFactory` from the barrel.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — imports `RoundStreamFactory` type into `agent-runner.ts`; adds the optional run-option; replaces the unconditional `createSdkAgentStream(...)` with the `??` fallback; re-exports `RoundStreamFactory` from `index.ts`.
2. **Why it is necessary now** — it is the fix (ADR D1); without the seam an adopting app must rewrite its stream-injection tests.

#### Evidence
`agent-runner.ts:186` (`const streamFactory = createSdkAgentStream(...)`) + `:197` (`runReflectiveLoopStream(streamFactory, ...)`); `run-reflective-loop.ts:28` (`export type RoundStreamFactory`); `index.ts` barrel.

#### Files to edit
```
packages/agents/src/loop/agent-runner.ts — AgentRunnerRunOptions.streamFactory; opts.streamFactory ?? createSdkAgentStream
packages/agents/src/index.ts — export type RoundStreamFactory
```

#### Deep file dependency analysis
- `agent-runner.ts` — `import type { RoundStreamFactory } from './run-reflective-loop.js'`; option + `??`. The rest of `stream()` (loop config) unchanged.
- `index.ts` — add `RoundStreamFactory` to the run-reflective-loop / loop type re-exports.

#### Deep Dives
- **Invariant:** absent `streamFactory` → `createSdkAgentStream(...)` exactly as today.
- **Edge case:** `streamFactory` set → the SDK-create options (tools/model/cwd/...) are not used for that call (consumer owns the stream); documented in JSDoc.

#### Pseudo-code / Signatures
```ts
// AgentRunnerRunOptions.streamFactory?: RoundStreamFactory
const streamFactory = opts.streamFactory ?? createSdkAgentStream(this.compiled, tools, opts.apiKey, { ...overrides })
return runReflectiveLoopStream(streamFactory, message, sessionId, { loop, reflection, budget, agentName, signal, retry })
```

#### Tasks
1. Add the run-option + the `??` fallback in `stream()`.
2. Export `RoundStreamFactory` from the barrel.
3. Run typecheck + lint.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Types compile: `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Pass: complexity — `npx eslint packages/agents/src/loop/agent-runner.ts --max-warnings=0`
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/runner-stream-factory.test.ts` ≥ 90% on changed files
- [ ] Pass: lint — `npx eslint packages/agents/src --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/src/loop/agent-runner.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

## Phase 2: TDD proof

**Objective:** prove the injected factory drives the loop; absent ⇒ SDK adapter.

### T2.1 — Injected-factory test

#### Objective
A test passes `streamFactory` that yields a known event sequence + terminal `done`; asserts the loop's `DelegationResult`/events reflect it (and `@theokit/sdk` is never imported — no SDK mock needed).

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — drives `AgentRunner.run('hi', { apiKey:'k', streamFactory })` where the factory yields `text_delta`+`done`; asserts `result.response` / tokens come from the injected stream; a second case (no factory, mocked SDK) confirms the default path still runs.
2. **Why it is necessary now** — the injection is the Goal's metric + the enabler for theocode's test migration-free adoption.

#### Evidence
`runReflectiveLoopStream` consumes a `RoundStreamFactory`; the V4-P loop tests use fake factories — the template.

#### Files to edit
```
packages/agents/tests/integration/runner-stream-factory.test.ts (NEW) — injected factory drives the loop
```

#### Deep file dependency analysis
- New test builds a `RoundStreamFactory` returning an async-iterable of `StreamEvent`; drives `AgentRunner.builder(A).build().run('hi', { apiKey:'k', streamFactory })`; asserts the response/tokens. No `@theokit/sdk` mock required (the factory bypasses it) — proving the seam.

#### Deep Dives
- **Assertion:** factory yields `{type:'text_delta', content:'hi'}` + `{type:'done', usage:{inputTokens:3,outputTokens:2,totalTokens:5}}` → `result.response === 'hi'`, `result.tokens === 5`.
- **No-SDK proof:** the test does NOT `vi.mock('@theokit/sdk')`; if `stream` fell back to `createSdkAgentStream`, the dynamic import would run — the injected factory prevents it.

#### Pseudo-code / Signatures
```ts
const factory: RoundStreamFactory = () => ({ async *[Symbol.asyncIterator]() {
  yield { type: 'text_delta', content: 'hi' }
  yield { type: 'done', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } }
} })
const r = await AgentRunner.builder(A).build().run('hi', { apiKey: 'k', streamFactory: factory })
expect(r.response).toBe('hi'); expect(r.tokens).toBe(5)
```

#### Tasks
1. Create `runner-stream-factory.test.ts` with the injected-factory case.
2. Run the suite.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Injection proven: `npx vitest run packages/agents/tests/integration/runner-stream-factory.test.ts`
- [ ] Full suite green: `npx vitest run packages/agents`
- [ ] Pass: complexity — `npx eslint packages/agents/tests/integration/runner-stream-factory.test.ts --max-warnings=0`
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/runner-stream-factory.test.ts` exercises the injection branch
- [ ] Pass: lint — `npx eslint packages/agents/tests --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/tests/integration/runner-stream-factory.test.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| G1 | AgentRunner has no stream-injection seam | T1.1, T2.1 | `streamFactory` run-option (ADR D1) |
| G2 | must not change the default SDK path | T1.1, T2.1 | `opts.streamFactory ?? createSdkAgentStream`; absent ⇒ unchanged |
| G3 | consumers cannot type their factory | T1.1 | `RoundStreamFactory` exported from the barrel (ADR D2) |
| G4 | proof the injected factory drives the loop | T2.1 | test asserts response/tokens from the injected stream, no SDK import |
| G5 | backward compat | T1.1, T2.1 | additive optional field; full suite green |

**Coverage: 5/5 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `rules/architecture.md` / G6)
- [ ] CHANGELOG.md updated — add a changeset (minor bump `@theokit/agents`)
- [ ] Backward compatibility preserved (additive optional field; default path unchanged)
- [ ] Plan-specific: `npx vitest run packages/agents/tests/integration/runner-stream-factory.test.ts` passes (the Goal metric)
- [ ] **Runtime-metric proof** — n/a (no new counter)
- [ ] **Plan archived** — after `/review` READY_TO_MERGE AND PR merged

## Failure scenarios (when I/O external)

```
(none — no external I/O touched)
```

The injected factory is in-memory (test) or the consumer's own transport; the SDK default path is unchanged. V4-R adds no external call.

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
- [ ] Failure scenarios green — n/a (`(none — no external I/O touched)`)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
