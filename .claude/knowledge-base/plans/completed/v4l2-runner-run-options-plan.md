---
slug: v4l2-runner-run-options
milestone_id: V4-L
created_at: 2026-06-25
goal: Add per-request model/cwd/maxIterations overrides to AgentRunnerRunOptions with merge-over-compiled semantics.
---

# Plan: V4-L.2 — per-request `model` / `cwd` / `maxIterations` on `AgentRunnerRunOptions`

> **Version 1.1** (absorbed `/edge-case-plan` test items EC-1 compose + EC-2 simple-chat no-op into T2.1; EC-3/EC-4 documented) — Add three Axis-A (SWAP) per-request overrides to `AgentRunner.stream()/run()`: `model` (overrides the compiled model for this call), `cwd` (threaded into `Agent.create({ local: { cwd } })` so the SDK populates `SystemPromptContext.cwd` — feeding the V4-L.1 resolver + `@ProjectContext`), and `maxIterations` (overrides the loop ceiling by re-resolving the loop strategy per call). All three use merge-over-compiled semantics (`opts.X ?? compiled`), exactly parallel to the already-shipped V4-J `tools` override. Backward-compatible; no new dependency; the SDK still owns the runtime.

## Goal

> "Enable `AgentRunner` callers to pass `runner.stream(msg, { apiKey, model, cwd, maxIterations })` so that each value overrides its build-time default for that call only, measured by `npx vitest run packages/agents/tests/integration/runtime-overrides.test.ts` passing (model reaches `Agent.create`, cwd reaches `Agent.create.local`, and the loop stops at the overridden ceiling)."

## Context

V4-L.1 (`@theokit/agents@0.10.0`) gave `@Agent` a per-request `systemPrompt` resolver (Axis-B / COMPUTE). V4-L.2 is the Axis-A (SWAP) companion: the values an app already holds at call time and wants to swap per request. theocode's `runCodeAgent` (`agent-stream.ts:297-365`) passes a dynamic `model`, a per-request `local.cwd` (the project root), and an iteration budget to `Agent.create` on every request — none expressible today through `AgentRunner`, which resolves model/cwd/ceiling at build time. The prior-art research (`knowledge-base/discoveries/blueprints/agent-dynamic-config-blueprint.md` §"Mapping to the 5 theocode gaps") classified these three as Axis-A swaps that join the run-options object alongside the V4-J `tools` field. The `cwd` swap is also what makes V4-L.1's resolver useful: `compile-project-context.ts:46` already reads `promptCtx.cwd`, but nothing supplies it per request until now.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/loop/agent-runner.ts` | 204 | `079f725` (2026-06-25) | `AgentRunner` + builder; `stream()` drives `runReflectiveLoopStream`; `AgentRunnerRunOptions` is the per-request seam (already carries V4-J `tools`) | `stream()` MUST keep working with only `{ apiKey }`; the build-time `this.loopStrategy` / `this.compiled.model` remain the defaults; V4-J `tools` behavior unchanged |
| `packages/agents/src/bridge/sdk-adapter.ts` | 173 | `af4cd4e` (2026-06-23) | `createSdkAgentStream` projects compiled options into `Agent.create`; resolves `model = envModel ?? compiled.model ?? default` | model-resolution precedence preserved; M8 fields (skills/context/systemPrompt) still projected; SDK remains the only runtime (G2) |
| `packages/agents/tests/integration/runtime-overrides.test.ts` (NEW) | 0 | — | (file to be created) | — |
| `packages/agents/tests/unit/runner-maxiterations-override.test.ts` (NEW) | 0 | — | (file to be created) | — |

### Current callers / dependents

- **Symbol:** `AgentRunnerRunOptions` in `packages/agents/src/loop/agent-runner.ts:37`
  - **Callers (production):** `AgentRunner.stream` (`agent-runner.ts:115`), `AgentRunner.run` (`agent-runner.ts:138`); both forward to `createSdkAgentStream` + `runReflectiveLoopStream`.
  - **Callers (tests):** `packages/agents/tests/integration/runtime-tools.test.ts`, `packages/agents/tests/unit/reflection-context.test.ts`, `packages/agents/tests/integration/reflective-loop-stream.test.ts`.
  - **External:** `@theokit/agents` is published; adding optional fields to the options interface is backward-compatible.
- **Symbol:** `createSdkAgentStream(compiled, compiledTools, apiKey, envModel?)` in `packages/agents/src/bridge/sdk-adapter.ts:65`
  - **Callers (production):** `AgentRunner.stream` (`agent-runner.ts:121`).
  - **Callers (tests):** `packages/agents/tests/integration/systemprompt-resolver-stream.test.ts` (V4-L.1), plus tests that mock it.
  - **External:** exported via the bridge barrel; adding an optional trailing `cwd?` param is backward-compatible.
- **Symbol:** `resolveLoopStrategy(strategy, maxIterations?)` in `packages/agents/src/loop/loop-strategy.ts:70`
  - **Callers (production):** `AgentRunnerBuilder.build` (`agent-runner.ts:183`), `delegate()` path.
  - Re-used by `stream()` for the per-call ceiling override (zod-validated).

### Domain glossary

- **Axis-A (SWAP)** — a config value held at call time, overridden via a per-request options object that merges over the build-time default (`opts.X ?? compiled`). The taxonomy from the dynamic-`@Agent` blueprint.
- **merge-over-compiled** — `effective = opts.X ?? compiledDefault`; `undefined` opts leave the build-time value intact (the V4-J `tools` semantics).
- **LoopStrategy ceiling** — `loop.maxIterations`, the hard round bound checked by `shouldContinue` (`loop-strategy.ts:84`); `step_limit` is the terminal when the ceiling stops a would-continue round (`run-reflective-loop.ts:110`).
- **`SystemPromptContext.cwd`** — the SDK-populated field a `SystemPromptResolver` reads; sourced from `Agent.create({ local: { cwd } })` (`LocalOptions.cwd`).

### Architecture boundaries affected

- `@theokit/agents` → `@theokit/sdk` runtime: `cwd` is forwarded into the SDK's `Agent.create({ local })` — the SDK owns execution and `SystemPromptContext` population (G2 intact; agents only passes the value, never reads `process.cwd()` itself per G8). No new import direction; `createSdkAgentStream` already calls `Agent.create`.
- No change to the `agents` package's dependency graph (G1).

## Prior Art & Related Work

- **Internal blueprint** — `knowledge-base/discoveries/blueprints/agent-dynamic-config-blueprint.md` §"The dominant pattern" (Axis-A → per-request options-object merge) + §"Mapping to the 5 theocode gaps" (the model / cwd / maxIterations rows). V4-L.2 implements those three rows.
- **In-repo precedent** — V4-J `tools` override (`agent-runner.ts:51`, `:120`): the exact "per-request field on `AgentRunnerRunOptions`, merge-over-compiled" shape this plan follows for three more fields.
- **External literature** — Spring AI `ChatClient` per-request `.options(ChatOptions)` merging over `defaultOptions` (https://docs.spring.io/spring-ai/reference/api/chatclient.html) and Pydantic AI `agent.run(model=..., model_settings=...)` (https://ai.pydantic.dev/agent/): the values-override pattern this plan adopts for `model` / `maxIterations`.

## Objective

- [ ] `runner.stream(msg, { apiKey, model })` makes `Agent.create` receive `model.id === opts.model` (merge: `opts.model ?? compiled.model ?? default`).
- [ ] `runner.stream(msg, { apiKey, cwd })` makes `Agent.create` receive `local.cwd === opts.cwd` (so a resolver/`@ProjectContext` sees `ctx.cwd`).
- [ ] `runner.stream(msg, { apiKey, maxIterations: N })` caps the reflective loop at N rounds for that call (terminal `step_limit`), without mutating the build-time strategy.
- [ ] Invalid `maxIterations` (< 1) fails loudly via the existing zod schema (no silent infinite loop).
- [ ] Backward compatibility: a call with only `{ apiKey }` (or with V4-J `tools`) behaves exactly as before.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | `>=2.9.0` (already installed) | npm | Owns `Agent.create({ local: { cwd } })` + `LocalOptions` + `SystemPromptContext` population; the runtime that honors the resolved model. No new usage beyond an existing call. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | | | | No dependency added — `LocalOptions.cwd` / `Agent.create` are already used by `sdk-adapter.ts`; `resolveLoopStrategy` is in-package. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## ADRs

### D1 — Three SWAP fields on `AgentRunnerRunOptions` (flat, parallel to V4-J `tools`)

- **Decision:** Add `model?: string`, `cwd?: string`, `maxIterations?: number` to `AgentRunnerRunOptions`, each merge-over-compiled (`opts.X ?? compiledDefault`).
- **Rationale:** These are values the caller holds at call time (the SWAP axis); the per-request options object is the prior-art-validated mechanism (Spring AI `ChatOptions`, Pydantic `run(...)`), and V4-J already established this exact shape with `tools`. Flat fields keep one coherent category.
- **Alternatives considered:** (a) Builder methods (`.model()`, `.cwd()`) — REJECTED: builder state is per-BUILD, not per-REQUEST; these vary per call. (b) A nested `overrides: { model, cwd, maxIterations }` object — REJECTED: inconsistent with the flat V4-J `tools` field already on the same interface.
- **Consequences:** Enables theocode's per-request model/cwd/budget through `AgentRunner`; the interface grows by three optional fields (additive, backward-compatible).

### D2 — `maxIterations` override re-resolves the loop strategy per call (reuse zod fail-loud)

- **Decision:** In `stream()`, when `opts.maxIterations != null`, compute `const loop = resolveLoopStrategy(this.loopStrategy.name, opts.maxIterations)` and pass it as the `config.loop` for that call; otherwise use `this.loopStrategy`.
- **Rationale:** `resolveLoopStrategy` is the single source of truth for the ceiling AND validates `maxIterations >= 1` via zod (fail-loud, never a silent infinite loop). Re-resolving preserves the strategy NAME and reuses that guarantee with zero new validation code (DRY).
- **Alternatives considered:** (a) Pass a raw `maxIterations` into `runReflectiveLoopStream` and override `loop.maxIterations` there — REJECTED: bypasses the zod guard and splits the ceiling's SSoT across two modules. (b) Mutate `this.loopStrategy.maxIterations` for the call — REJECTED: shared mutable state breaks concurrent `stream()` calls on the same runner.
- **Consequences:** One small `LoopStrategy` object allocated per overridden call; invalid `maxIterations` throws at `stream()` invocation (fail-loud).

### D3 — `cwd` threaded into `Agent.create({ local: { cwd } })`

- **Decision:** Add a trailing `cwd?: string` param to `createSdkAgentStream`; when present, merge it into the M8 `local` options (`local: { ...existing, cwd }`) passed to `Agent.create`. `stream()` forwards `opts.cwd`.
- **Rationale:** `LocalOptions.cwd` is the documented SDK seam; the SDK populates `SystemPromptContext.cwd` from it, which is exactly what a V4-L.1 resolver / `@ProjectContext` reads. agents must NOT read `process.cwd()` itself (G8 — no direct Node access in `agents/src`); the cwd comes from the app.
- **Alternatives considered:** (a) A separate `promptCtx`/`cwd` channel into the loop — REJECTED: the SDK owns `SystemPromptContext`; `local.cwd` is the canonical input. (b) Default cwd to `process.cwd()` inside agents — REJECTED: violates G8 and guesses state the app owns.
- **Consequences:** `cwd` now flows end-to-end (run-options → adapter → `Agent.create.local` → SDK → resolver). The SDK's `cwd: string | string[]` is exposed as `string` only (the common case; array is YAGNI).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Model precedence is now 3-level (`opts.model ?? compiled.model ?? default`) — a reader must know the order | Low | Documented in the field JSDoc + ADR D1; mirrors the existing `envModel ?? compiled.model ?? default` in `sdk-adapter.ts:71` | maintainer |
| `maxIterations` override allocates a fresh `LoopStrategy` per overridden call | Low | Object is tiny; only allocated when the override is present (absent ⇒ reuse `this.loopStrategy`) | maintainer |
| SDK `LocalOptions.cwd` accepts `string \| string[]` but the run-option exposes `string` only | Low | The single-root case is the documented need; widening to array is a future change if a real multi-root case appears (YAGNI) | maintainer |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (run-options + stream threading; sdk-adapter cwd param) ──▶ Phase 2 (wiring proofs: integration + unit)
                                                                          │
                                                                          ▼
                                                                 Final Phase: Integration Validation
```

Sequential: Phase 2's tests exercise the threading added in Phase 1.

---

## Phase 1: Thread the three SWAP overrides

**Objective:** `AgentRunnerRunOptions` carries `model`/`cwd`/`maxIterations`; `stream()` applies each merge-over-compiled; `createSdkAgentStream` forwards `cwd` to `Agent.create.local`.

### T1.1 — Add the three fields + apply them in `stream()` and `createSdkAgentStream`

#### Objective
`stream()` resolves `model = opts.model ?? this.compiled.model`, `loop = opts.maxIterations != null ? resolveLoopStrategy(name, opts.maxIterations) : this.loopStrategy`, and forwards `opts.cwd` to `createSdkAgentStream`, which sets `Agent.create.local.cwd`.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — adds `model?`/`cwd?`/`maxIterations?` to `AgentRunnerRunOptions`; in `stream()` threads model (as `envModel`), cwd (new param), and a per-call loop strategy; adds a trailing `cwd?` param to `createSdkAgentStream` and merges it into the M8 `local` options.
2. **Why it is necessary now** — it is the whole feature surface (ADR D1/D2/D3); Phase 2 proves it. Doing the threading in one task keeps the three SWAP fields cohesive (one category, like V4-J `tools`).

#### Evidence
`agent-runner.ts:37-52` (`AgentRunnerRunOptions` with V4-J `tools`), `:115-135` (`stream()` builds the factory + loop config), `:121-124` (`createSdkAgentStream(this.compiled, tools, opts.apiKey, this.compiled.model)`); `sdk-adapter.ts:65-71` (signature + `model = envModel ?? compiled.model ?? default`), `:44,:129-134` (`local` assembly + `Agent.create`); `loop-strategy.ts:70-74` (zod-validated `resolveLoopStrategy`); SDK `LocalOptions.cwd` (`cron-Bhp8rP8i.d.ts:861`).

#### Files to edit
```
packages/agents/src/loop/agent-runner.ts — add model/cwd/maxIterations to AgentRunnerRunOptions; thread in stream()
packages/agents/src/bridge/sdk-adapter.ts — createSdkAgentStream gains cwd? param; merge into m8.local; widen M8CreateOptions.local
packages/agents/tests/integration/runtime-overrides.test.ts — RED tests added first (TDD)
packages/agents/tests/unit/runner-maxiterations-override.test.ts — RED test added first (TDD)
```

#### Deep file dependency analysis
- `agent-runner.ts` (Baseline: runner + builder) — extend `AgentRunnerRunOptions`; in `stream()` compute `model`/`loop`/forward `cwd`. Downstream: `run()` calls `stream()` (inherits the overrides); `createSdkAgentStream` + `runReflectiveLoopStream` consume them.
- `sdk-adapter.ts` (Baseline: projects to `Agent.create`) — add `cwd?` param, widen `M8CreateOptions.local` to `{ settingSources?: string[]; cwd?: string }`, merge `cwd` into `local`. Downstream: callers pass cwd from `stream()`; the SDK reads `local.cwd`.

#### Deep Dives
- **Invariant:** a `{ apiKey }`-only call is unchanged — `model` falls to `compiled.model ?? default`, `loop` stays `this.loopStrategy`, no `local.cwd` key is added (Baseline invariants).
- **Merge semantics:** `model = opts.model ?? this.compiled.model` (passed as `envModel`; the adapter's `envModel ?? compiled.model ?? default` keeps the default tail). `loop = opts.maxIterations != null ? resolveLoopStrategy(this.loopStrategy.name, opts.maxIterations) : this.loopStrategy`. `cwd = opts.cwd` (undefined ⇒ no `local.cwd`).
- **Edge case (invalid maxIterations):** `resolveLoopStrategy(name, 0)` throws (zod `min(1)`) synchronously at `stream()` invocation — fail-loud, never a silent infinite loop.
- **Edge case (cwd without resolver):** `local.cwd` set but unused by a static-string agent — harmless.

#### Pseudo-code / Signatures
```ts
// agent-runner.ts
export interface AgentRunnerRunOptions {
  readonly apiKey: string
  readonly sessionId?: string
  readonly budget?: number
  readonly signal?: AbortSignal
  readonly tools?: readonly CompiledTool[]   // V4-J
  readonly model?: string                    // V4-L.2 — overrides compiled.model for this call
  readonly cwd?: string                      // V4-L.2 — into Agent.create.local.cwd → SystemPromptContext.cwd
  readonly maxIterations?: number            // V4-L.2 — overrides the loop ceiling for this call
}
// stream():
const tools = opts.tools ? [...opts.tools] : this.compiled.tools
const model = opts.model ?? this.compiled.model
const loop = opts.maxIterations != null
  ? resolveLoopStrategy(this.loopStrategy.name, opts.maxIterations)
  : this.loopStrategy
const streamFactory = createSdkAgentStream(this.compiled, tools, opts.apiKey, model, opts.cwd)
return runReflectiveLoopStream(streamFactory, message, sessionId, { loop, reflection: this.reflectionStrategy, budget: opts.budget, agentName: this.agentName, signal: opts.signal })

// sdk-adapter.ts
export function createSdkAgentStream(compiled, compiledTools, apiKey, envModel?, cwd?) {
  ...
  const { options: m8, applied } = assembleM8CreateOptions(compiled)
  if (cwd !== undefined) m8.local = { ...(m8.local ?? {}), cwd }
  const agent = await Agent.create({ apiKey, model: { id: model }, tools: sdkTools, ...m8 })
}
```

#### Tasks
1. Add `model`/`cwd`/`maxIterations` to `AgentRunnerRunOptions` with JSDoc.
2. In `stream()`, compute `model`, `loop`, and forward `cwd`; pass `loop` as `config.loop`.
3. Add `cwd?` param to `createSdkAgentStream`; widen `M8CreateOptions.local`; merge cwd into `local`.
4. Run typecheck.

#### TDD
```
RED:     test_stream_threads_model_and_cwd_to_createSdkAgentStream() — (unit-ish) opts.model/opts.cwd reach the adapter (asserted via the integration test below)
GREEN:   add fields + thread in stream() + adapter cwd merge
REFACTOR: None expected
VERIFY:  npx tsc --noEmit -p packages/agents/tsconfig.test.json
```
(The behavioral RED tests live in Phase 2 — T1.1 is the type+threading change they exercise; the typecheck failure of the new test files before T1.1 is the RED proof.)

#### Concurrency tests

(none — single-threaded)

Per-call `loop`/`model` are locals — no shared mutation, by design of D2's per-call re-resolve.

#### Acceptance Criteria
- [ ] `AgentRunnerRunOptions` exposes `model`/`cwd`/`maxIterations`: `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Pass: complexity — `npx eslint packages/agents/src/loop/agent-runner.ts packages/agents/src/bridge/sdk-adapter.ts --max-warnings=0` (complexity rule clean)
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/runtime-overrides.test.ts` ≥ 90% on changed files
- [ ] Pass: lint — `npx eslint packages/agents/src/loop/agent-runner.ts packages/agents/src/bridge/sdk-adapter.ts --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/src/loop/agent-runner.ts)" -le 500 && test "$(wc -l < packages/agents/src/bridge/sdk-adapter.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

---

## Phase 2: Wiring proofs

**Objective:** prove model/cwd reach `Agent.create`, the loop honors the overridden ceiling, invalid maxIterations fails loudly, and absent overrides preserve build-time behavior.

### T2.1 — Integration: model/cwd reach `Agent.create`; maxIterations caps the loop; backward compat

#### Objective
With the SDK mocked, assert `Agent.create` receives `model.id === opts.model` and `local.cwd === opts.cwd`; with a perpetual tool-calls stream, assert the loop stops at `opts.maxIterations` rounds (`step_limit`); with no overrides, assert compiled defaults are used.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — adds an integration test mocking `@theokit/sdk` (capturing `Agent.create` options) for model/cwd, and a test driving a mocked perpetual-tool-calls round stream through `runner.run(..., { maxIterations })` to assert the ceiling and `step_limit` terminal.
2. **Why it is necessary now** — the Goal's metric is "model reaches Agent.create, cwd reaches Agent.create.local, loop stops at the overridden ceiling". The test is the wiring proof (pillar b) that the threading fires end-to-end, not just compiles.

#### Evidence
`sdk-adapter.ts:129-134` (`Agent.create({ ..., ...m8 })`), `:44` (`local`); `run-reflective-loop.ts:110` (`step_limit` terminal at the ceiling), `:313-320` (terminal decision); mock pattern in `runtime-tools.test.ts:14-31` and `systemprompt-resolver-stream.test.ts`.

#### Files to edit
```
packages/agents/tests/integration/runtime-overrides.test.ts (NEW) — model/cwd to Agent.create; maxIterations ceiling; backward compat
```

#### Deep file dependency analysis
- New integration test only — mocks `@theokit/sdk` to capture `Agent.create` options (model/cwd) and mocks the round stream (perpetual `tool_result`) to exercise the `maxIterations` ceiling via `runner.run`. No production change in this task.

#### Deep Dives
- **Model/cwd capture:** `vi.mock('@theokit/sdk')` with `Agent.create` capturing opts; build a runner with a simple-chat agent (one round) so create runs; assert `captured.model.id` and `captured.local.cwd`.
- **maxIterations ceiling:** mock `createSdkAgentStream` (or the SDK round) to ALWAYS yield a `tool_result` + `done` (a perpetual would-continue round under a `react`/`plan-act-reflect` agent), call `runner.run('go', { apiKey, maxIterations: 3 })`, assert `result.rounds === 3` and `result.finishReason === 'step_limit'`.
- **Backward compat:** a call with no overrides → `captured.model.id === compiled default`, `captured.local?.cwd === undefined`, and `result.rounds` equals the build-time ceiling when maxIterations is omitted.

#### Pseudo-code / Signatures
```ts
// model+cwd: simple-chat agent, mock @theokit/sdk Agent.create capturing opts
await runner.run('hi', { apiKey: 'k', model: 'anthropic/claude-x', cwd: '/proj' })
expect(captured.model.id).toBe('anthropic/claude-x')
expect(captured.local.cwd).toBe('/proj')
// maxIterations: react agent, perpetual tool_result stream
const result = await runner.run('go', { apiKey: 'k', maxIterations: 3 })
expect(result.rounds).toBe(3); expect(result.finishReason).toBe('step_limit')
```

#### Tasks
1. Create the integration test: model+cwd capture (mock `@theokit/sdk`).
2. Add the maxIterations-ceiling case (perpetual tool-calls round) + the no-override backward-compat case.
3. Add `test_v4j_tools_and_v4l2_overrides_compose` (EC-1) and `test_maxIterations_override_noop_on_simple_chat` (EC-2).
4. Run the test.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] model+cwd reach `Agent.create`: `npx vitest run packages/agents/tests/integration/runtime-overrides.test.ts`
- [ ] maxIterations override caps the loop at N rounds with `step_limit` (same command)
- [ ] Backward compat: no-override call uses compiled defaults (same command)
- [ ] EC-1 compose + EC-2 simple-chat no-op pass: `npx vitest run packages/agents/tests/integration/runtime-overrides.test.ts`
- [ ] Pass: complexity — `npx eslint packages/agents/tests/integration/runtime-overrides.test.ts --max-warnings=0` (complexity rule clean)
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/runtime-overrides.test.ts` exercises the model/cwd/loop threading in `agent-runner.ts` + `sdk-adapter.ts`
- [ ] Pass: lint — `npx eslint packages/agents/tests/integration/runtime-overrides.test.ts --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/tests/integration/runtime-overrides.test.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

### T2.2 — Unit: invalid `maxIterations` fails loudly

#### Objective
`runner.run('x', { apiKey, maxIterations: 0 })` throws (zod via `resolveLoopStrategy`) — no silent infinite loop.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — a unit test asserting that an out-of-range `maxIterations` throws at `stream()`/`run()` invocation.
2. **Why it is necessary now** — ADR D2 relies on the existing zod guard; the test locks the fail-loud contract so a future refactor cannot silently drop the validation and reintroduce an unbounded loop.

#### Evidence
`loop-strategy.ts:57` (`maxIterations: z.number().int().min(1)`), `:74` (`.parse(...)` throws); the re-resolve site added in T1.1.

#### Files to edit
```
packages/agents/tests/unit/runner-maxiterations-override.test.ts (NEW) — invalid maxIterations throws
```

#### Deep file dependency analysis
- New unit test only — builds a runner and asserts `runner.run('x', { apiKey, maxIterations: 0 })` rejects/throws. No production change.

#### Deep Dives
- **Invariant:** the throw originates from `resolveLoopStrategy`'s zod parse (fail-loud at call time). `stream()` runs its body eagerly, so the throw surfaces when `run()` awaits the generator's first step (or synchronously at `stream()` — assert via `expect(() => runner.stream(...)).toThrow()` or `await expect(runner.run(...)).rejects`).
- **Edge case:** `maxIterations: 1` is valid (single round) — not in scope to assert here but the boundary is `>= 1`.

#### Pseudo-code / Signatures
```ts
const runner = AgentRunner.builder(SomeAgent).build()
expect(() => runner.stream('x', { apiKey: 'k', maxIterations: 0 })).toThrow()
```

#### Tasks
1. Create the unit test asserting the throw on `maxIterations: 0`.
2. Run the test.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Invalid maxIterations throws: `npx vitest run packages/agents/tests/unit/runner-maxiterations-override.test.ts`
- [ ] Pass: complexity — `npx eslint packages/agents/tests/unit/runner-maxiterations-override.test.ts --max-warnings=0` (complexity rule clean)
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/unit/runner-maxiterations-override.test.ts` exercises the re-resolve throw path
- [ ] Pass: lint — `npx eslint packages/agents/tests/unit/runner-maxiterations-override.test.ts --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/tests/unit/runner-maxiterations-override.test.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| G1 | `model` not overridable per-request | T1.1, T2.1 | `opts.model ?? compiled.model` threaded as `envModel`; integration asserts `Agent.create.model.id` (ADR D1) |
| G2 | `cwd` not reachable per-request (blocks V4-L.1 resolver) | T1.1, T2.1 | `cwd` param → `Agent.create.local.cwd`; integration asserts it (ADR D3) |
| G3 | `maxIterations` not overridable per-request | T1.1, T2.1 | per-call `resolveLoopStrategy(name, opts.maxIterations)` → `config.loop`; integration asserts ceiling + `step_limit` (ADR D2) |
| G4 | No proof model/cwd reach `Agent.create` | T2.1 | integration test asserts captured `Agent.create` options |
| G5 | No proof the overridden ceiling stops the loop | T2.1 | perpetual tool-calls stream → `rounds === N`, `finishReason === 'step_limit'` |
| G6 | Invalid `maxIterations` risks a silent unbounded loop | T2.2 | zod `min(1)` via `resolveLoopStrategy` throws fail-loud |
| G7 | Backward compatibility (no overrides = unchanged) | T2.1 | no-override call uses compiled model, no `local.cwd`, build-time ceiling |

**Coverage: 7/7 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `rules/architecture.md` / G6)
- [ ] CHANGELOG.md updated — add a changeset under `.changeset/` (minor bump `@theokit/agents`); `packages/agents/CHANGELOG.md` is changeset-generated
- [ ] Backward compatibility preserved across public API (V4-J `tools` + `{ apiKey }`-only calls unchanged)
- [ ] Plan-specific: `npx vitest run packages/agents/tests/integration/runtime-overrides.test.ts` passes (the Goal metric)
- [ ] **Runtime-metric proof** — n/a (no new counter; the existing `[THEO_AGENT_MAINLOOP_RUNTIME_APPLIED]` terminal log already surfaces `step_limit`)
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR is merged, move this plan to `knowledge-base/plans/completed/`

## Failure scenarios (when I/O external)

```
(none — no external I/O touched)
```

`cwd` is forwarded into the SDK's `Agent.create({ local })`; this plan adds no external I/O call of its own (the SDK owns the model call, mocked in tests).

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 1-2. The plan is NOT done until this chain passes.

**Objective:** the whole `@theokit/agents` suite is green with the three overrides threaded and proven end-to-end.

### Execution
```
npx vitest run packages/agents                                   # unit + integration (incl. the new files)
npx vitest run --coverage packages/agents                        # coverage (≥ 90% on changed files)
npx tsc --noEmit -p packages/agents/tsconfig.test.json           # zero type errors
npx eslint packages/agents --max-warnings=0                      # zero lint warnings (on changed files)
```

### Acceptance Criteria
- [ ] All test suites green — `npx vitest run packages/agents`
- [ ] Coverage ≥ 90% on changed files — `npx vitest run --coverage packages/agents` (`agent-runner.ts`, `sdk-adapter.ts`)
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings (changed files) — `npx eslint packages/agents/src/loop/agent-runner.ts packages/agents/src/bridge/sdk-adapter.ts --max-warnings=0`
- [ ] Runtime-metric proof — n/a this slice (documented above)
- [ ] Failure scenarios green — n/a (`(none — no external I/O touched)` declared)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description (do not block on them).
