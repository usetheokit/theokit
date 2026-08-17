---
slug: v4l3-runner-runtime-surface
milestone_id: V4-L
created_at: 2026-06-25
goal: Forward the remaining per-request Agent.create options (plugins/providers/agents/budgetTracker) through AgentRunnerRunOptions via a RuntimeOverrides object.
---

# Plan: V4-L.3 — finish the per-request `Agent.create` surface (plugins / providers / agents / budgetTracker)

> **Version 1.1** (absorbed `/edge-case-plan` test items EC-1 budget/budgetTracker coexist + EC-2 empty-array forwarded into T2.1; EC-3/EC-4 documented) — Add the four remaining per-request `Agent.create` options to `AgentRunnerRunOptions` (`plugins`, `providers`, `agents`, `budgetTracker`), each forwarded into the SDK call, completing the per-request surface so theocode can adopt `AgentRunner.stream()` without hand-rolling `Agent.create`. To avoid a 9-positional-parameter explosion, collapse the per-request bits of `createSdkAgentStream` into a single `RuntimeOverrides` object (subsuming the V4-L.1/V4-L.2 `envModel`/`cwd` positionals). All four are Axis-A (SWAP) flat run-options, consistent with the shipped `tools`/`model`/`cwd`/`maxIterations` — NOT new decorators (per-request values do not belong at build time). Backward-compatible; no new dependency.

## Goal

> "Enable `AgentRunner` callers to pass `runner.stream(msg, { apiKey, plugins, providers, agents, budgetTracker })` so that each reaches the SDK `Agent.create`, measured by `npx vitest run packages/agents/tests/integration/runtime-overrides.test.ts` passing (each of the four options is observed on the captured `Agent.create` call)."

## Context

V4-L.1 (`@theokit/agents@0.10.0`) and V4-L.2 (`@0.11.0`) gave `@Agent`/`AgentRunner` per-request `systemPrompt`/`model`/`cwd`/`maxIterations` (+ V4-J `tools`). An empirical discover of theocode's actual `Agent.create` call (`agent-stream.ts:317-365`) found the blueprint's "5 gaps" list undercounted: theocode also passes `plugins` (permission gate selected by request `mode`), `providers` (OpenRouter routing), `agents` (custom sub-agents loaded from `.theocode/agents/*.md` per request), and `budgetTracker` (`createCounterBudgetTracker({maxIterations})` — an SDK INNER tool-loop cap, a different layer from V4-L.2's OUTER reflective-loop `maxIterations`). None are forwarded by `createSdkAgentStream` today (it spreads only `model`, `tools`, `cwd`, and the M8 fields). Until they are, theocode cannot replace its hand-rolled `agent-stream.ts` with `AgentRunner.stream()`. The discover (`knowledge-base/discoveries/blueprints/agent-dynamic-config-blueprint.md` + this slice's investigation) classified all four as Axis-A SWAP values the app holds at call time — the same category as the shipped `tools`.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/loop/agent-runner.ts` | 223 | `b1c6a71` (2026-06-25) | `AgentRunner` + builder; `AgentRunnerRunOptions` per-request seam (model/cwd/maxIterations/tools) | `stream()` MUST keep working with only `{ apiKey }`; existing field semantics unchanged |
| `packages/agents/src/bridge/sdk-adapter.ts` | 177 | `b1c6a71` (2026-06-25) | `createSdkAgentStream` projects compiled + per-request options into `Agent.create` | `model = override ?? compiled.model ?? default` precedence preserved; M8 fields still projected; SDK remains the only runtime (G2) |
| `packages/agents/src/bridge/agent-orchestrator.ts` | (caller) | `b1c6a71` (2026-06-25) | `delegate()` path calls `createSdkAgentStream(..., walk.agentConfig.model)` | delegate behavior unchanged — only the call shape updates to the `RuntimeOverrides` object |
| `packages/agents/tests/smoke/sdk-real-llm.test.ts` | (caller) | (real-LLM smoke, skipped w/o key) | calls `createSdkAgentStream(compiled, [], apiKey, model)` directly | tests still compile + behave identically — calls updated to `{ model }` |
| `packages/agents/tests/integration/runtime-overrides.test.ts` | 133 | (V4-L.2) | per-request override wiring proofs (mocks `@theokit/sdk`, captures `Agent.create`) | existing V4-L.2 tests stay green; V4-L.3 tests reuse the same capture mock (DRY) |

`packages/agents/tests/integration/systemprompt-resolver-stream.test.ts:46` calls `createSdkAgentStream(compiled, [], 'test-key')` (3 args) — UNAFFECTED (the new 4th param `overrides` defaults to `{}`).

### Current callers / dependents

- **Symbol:** `AgentRunnerRunOptions` (`agent-runner.ts:37`) — callers: `AgentRunner.stream`/`run` (prod); `runtime-overrides`/`runtime-tools`/`reflection-context`/`reflective-loop-stream` tests. External: published; adding optional fields is backward-compatible.
- **Symbol:** `createSdkAgentStream(compiled, compiledTools, apiKey, envModel?, cwd?)` (`sdk-adapter.ts:65`) — callers: `agent-runner.ts:145` (stream), `agent-orchestrator.ts:89` (delegate), `sdk-real-llm.test.ts` (×3, 4-arg with `model`), `systemprompt-resolver-stream.test.ts:46` (3-arg). The signature change to `(compiled, tools, apiKey, overrides?)` updates the 4-arg/5-arg callers; the 3-arg call is unaffected.
- **Symbol:** SDK `Agent.create` options (`@theokit/sdk` `cron-Bhp8rP8i.d.ts`) — accepts `agents?: Record<string, AgentDefinition>` (1146), `providers?: ProviderRoutingSettings` (1151), `plugins?: PluginsSettings` (1153), `budgetTracker?: BudgetTracker` (1332). All four exported from the `@theokit/sdk` barrel.

### Domain glossary

- **Axis-A (SWAP)** — a value the app holds at call time, forwarded per-request (flat run-option), vs Axis-B (computed, resolver). All four V4-L.3 fields are Axis-A.
- **RuntimeOverrides** — the new options object bundling the per-request bits passed to `createSdkAgentStream` (`model`, `cwd`, `plugins`, `providers`, `agents`, `budgetTracker`) — replaces the `envModel`/`cwd` positionals to avoid parameter explosion.
- **budgetTracker vs budget** — `budgetTracker` (SDK `BudgetTracker`) caps the SDK INNER tool-loop within one `send`; `AgentRunnerRunOptions.budget` (number) is the OUTER reflective-loop cumulative-USD ceiling (`run-reflective-loop.ts:293`). Different layers; both coexist.
- **compiled.agents (D3)** — `@SubAgents` compiles to `CompiledSubAgent` (`{model?, systemPrompt?}`), NOT spread into `Agent.create` (V4-L.1 ADR D3). Distinct from the SDK's `AgentDefinition` (requires `description`+`prompt`); the per-request `agents` override is independent.

### Architecture boundaries affected

- `@theokit/agents` → `@theokit/sdk`: four more SDK option types (`PluginsSettings`/`ProviderRoutingSettings`/`AgentDefinition`/`BudgetTracker`) imported (type-only) and forwarded into the existing `Agent.create` call. The SDK still owns execution (G2). No new import direction; no dependency graph change (G1).

## Prior Art & Related Work

- **Internal blueprint** — `knowledge-base/discoveries/blueprints/agent-dynamic-config-blueprint.md` §"The dominant pattern" (Axis-A → flat per-request options-object) + §"Mapping to the 5 theocode gaps".
- **Internal discover (this slice)** — the key-by-key delta between theocode's `Agent.create` (`theocode/server/lib/agent-stream.ts:317-365`) and `createSdkAgentStream`, classifying plugins/providers/agents/budgetTracker as Axis-A gaps; refuting new `@Plugins`/`@Providers` decorators (per-request values belong as run-options, not build-time).
- **In-repo precedent** — V4-J `tools` (`agent-runner.ts`) + V4-L.2 `model`/`cwd`/`maxIterations`: the exact "flat per-request field on `AgentRunnerRunOptions`" shape extended here for four more fields.
- **External literature** — Spring AI `ChatClient` per-request `.options(...)` over `defaultOptions` (https://docs.spring.io/spring-ai/reference/api/chatclient.html): per-request value-override pattern.

## Objective

- [ ] `runner.stream(msg, { apiKey, plugins })` → `Agent.create` receives `plugins`.
- [ ] `runner.stream(msg, { apiKey, providers })` → `Agent.create` receives `providers`.
- [ ] `runner.stream(msg, { apiKey, agents })` → `Agent.create` receives `agents`.
- [ ] `runner.stream(msg, { apiKey, budgetTracker })` → `Agent.create` receives `budgetTracker`.
- [ ] `createSdkAgentStream` takes a single `RuntimeOverrides` object (no 9-positional explosion); existing callers updated; the 3-arg call still compiles.
- [ ] Backward compatibility: `{ apiKey }`-only and all V4-J/V4-L.2 fields (`tools`/`model`/`cwd`/`maxIterations`/`budget`) behave exactly as before.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | `>=2.9.0` (installed) | npm | Owns `Agent.create` + the four option types (`PluginsSettings`/`ProviderRoutingSettings`/`AgentDefinition`/`BudgetTracker`). Forwarding existing fields into an existing call. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | | | | No dependency added — all four types are already in the installed `@theokit/sdk`; the changes are type-only imports + an existing call. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## ADRs

### D1 — Four per-request fields on `AgentRunnerRunOptions` (flat, NOT new decorators)

- **Decision:** Add `plugins?: PluginsSettings`, `providers?: ProviderRoutingSettings`, `agents?: Record<string, AgentDefinition>`, `budgetTracker?: BudgetTracker` to `AgentRunnerRunOptions`, each forwarded to `Agent.create` when present.
- **Rationale:** theocode constructs all four at call time (plugins by request `mode`, agents loaded per request, providers/budgetTracker held by the app) — the Axis-A SWAP category. The flat-run-option mechanism is the established pattern (V4-J `tools`, V4-L.2 `model`/`cwd`/`maxIterations`); reusing it keeps one coherent surface.
- **Alternatives considered:** (a) New `@Plugins`/`@Providers` decorators (the discover's Option B) — REJECTED: decorators are build-time/static; these values vary per request, so a decorator is the wrong axis AND adds surface (G11 YAGNI). (b) A `withRequestContext(resolver)` builder method (the blueprint's sketch) — REJECTED: a resolver for a value the app already holds at call time is ceremony with no payoff (the two-axis design's explicit anti-pattern); it would also create a second `cwd` path alongside V4-L.2's `opts.cwd`.
- **Consequences:** theocode's full per-request surface becomes expressible through `AgentRunner`; the interface grows by four optional fields (additive, backward-compatible).

### D2 — Collapse `createSdkAgentStream` per-request params into a `RuntimeOverrides` object

- **Decision:** Change `createSdkAgentStream(compiled, tools, apiKey, envModel?, cwd?)` to `createSdkAgentStream(compiled, tools, apiKey, overrides: RuntimeOverrides = {})` where `RuntimeOverrides = { model?, cwd?, plugins?, providers?, agents?, budgetTracker? }`. `model` resolves as `overrides.model ?? compiled.model ?? default`.
- **Rationale:** Adding four more positional params (on top of `envModel`/`cwd`) would make a 9-parameter function — a readability/maintainability smell. One options object is clean, self-documenting, and extensible. It also removes the V4-L.2 review's L1 nit (the double `?? compiled.model` fallback) by making the adapter the single model-resolution site.
- **Alternatives considered:** (a) Keep `envModel`/`cwd` positional, add a 6th `extras` object for the new four — REJECTED: splits per-request config across positionals AND an object (inconsistent). (b) Keep adding positionals — REJECTED: 9 positional params is the smell this ADR removes.
- **Consequences:** Five call sites update to the object form (`agent-orchestrator.ts`, 3 smoke-test calls, `agent-runner.ts`); the 3-arg call (`systemprompt-resolver-stream.test.ts`) is unaffected (`overrides` defaults to `{}`). All changes are typecheck-guarded.

### D3 — Per-request `agents` is opts-only; `compiled.agents` (@SubAgents) stays deferred

- **Decision:** The `agents` override forwards `opts.agents` (SDK `Record<string, AgentDefinition>`) directly to `Agent.create`; it does NOT merge with or newly spread `compiled.agents` (the V4-L.1 ADR D3 deferral stays).
- **Rationale:** theocode supplies `agents` per request (loaded from `.theocode/agents/*.md`); it does not use `@SubAgents`. `CompiledSubAgent` (`{model?, systemPrompt?}`) is structurally NOT an `AgentDefinition` (which requires `description`+`prompt`), so merging is not type-sound and has no consumer (YAGNI / G11). Spreading `compiled.agents` remains future work with a real `@SubAgents`+AgentRunner consumer.
- **Alternatives considered:** (a) Spread `opts.agents ?? compiled.agents` — REJECTED: type mismatch + a behavior change to `@SubAgents` with no requesting consumer. (b) Reconcile `CompiledSubAgent`→`AgentDefinition` now — REJECTED: speculative, out of scope.
- **Consequences:** theocode's per-request agents work; `@SubAgents` via the AgentRunner path stays a documented deferral.

### D4 — `budgetTracker` is a distinct layer from `budget`, both coexist

- **Decision:** `budgetTracker` (SDK `BudgetTracker`) is forwarded to `Agent.create` and bounds the SDK INNER tool-loop per `send`; the existing `AgentRunnerRunOptions.budget` (number) continues to bound the OUTER reflective-loop cumulative USD. Both fields are independent.
- **Rationale:** The discover confirmed (via `run-reflective-loop.ts`) the two operate at different layers — `budget` is checked between rounds (`run-reflective-loop.ts:293`), `budgetTracker` inside one SDK send. theocode needs the inner cap (`createCounterBudgetTracker({maxIterations})`); V4-L.2's loop `maxIterations` (rounds) does not replace it.
- **Alternatives considered:** (a) Reuse `budget` for both — REJECTED: different units (USD vs iterations) and layers. (b) Drop `budgetTracker`, rely on loop `maxIterations` — REJECTED: leaves theocode without its SDK-level tool-iteration cap (a regression).
- **Consequences:** Two budget-shaped fields coexist; their JSDoc states the layer each governs.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `createSdkAgentStream` signature change touches 5 call sites (incl. the delegate path + smoke tests) | Medium | All updates are mechanical (`model` → `{ model }`) and typecheck-guarded; delegate/smoke behavior unchanged; covered by the existing suite + the new wiring tests | maintainer |
| SDK types `plugins` as `PluginsSettings` (`{enabled}`) while the runtime accepts `Plugin[]` — theocode casts | Low | Type the run-option as the SDK's `PluginsSettings` (matches `Agent.create`); the app's existing cast carries over; document the SDK wart (not ours to fix here) | maintainer |
| Two budget-shaped fields (`budget` vs `budgetTracker`) risk confusion | Low | JSDoc on each states the layer it governs (ADR D4) | maintainer |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (RuntimeOverrides refactor + 4 fields + threading + Agent.create spread + caller updates) ──▶ Phase 2 (wiring proofs)
                                                                                                          │
                                                                                                          ▼
                                                                                                 Final Phase: Integration Validation
```

Sequential: Phase 2 exercises the threading added in Phase 1.

---

## Phase 1: RuntimeOverrides refactor + four per-request fields

**Objective:** `AgentRunnerRunOptions` carries `plugins`/`providers`/`agents`/`budgetTracker`; `createSdkAgentStream` takes a `RuntimeOverrides` object and forwards all per-request options to `Agent.create`; existing callers updated.

### T1.1 — Introduce `RuntimeOverrides`, add the four fields, thread + spread, update callers

#### Objective
`createSdkAgentStream(compiled, tools, apiKey, overrides = {})` forwards `model`/`cwd`/`plugins`/`providers`/`agents`/`budgetTracker` to `Agent.create`; `stream()` builds `overrides` from `opts`; `agent-orchestrator.ts` + smoke-test calls updated to the object form.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — defines `RuntimeOverrides`; widens `AgentRunnerRunOptions` with the four fields; rewrites `createSdkAgentStream`'s 4th/5th params into one `overrides` object; conditionally spreads each present field into `Agent.create`; updates the delegate + smoke call sites.
2. **Why it is necessary now** — it is the whole feature (ADR D1/D2/D3/D4). The RuntimeOverrides refactor (D2) is required to add four fields without a 9-parameter explosion, so it lands in the same task as the fields it carries.

#### Evidence
`agent-runner.ts:37-69` (`AgentRunnerRunOptions`), `:145` (`createSdkAgentStream(...)` call); `sdk-adapter.ts:65-73` (signature + `model` resolution), `:117-134` (`assembleM8CreateOptions` + `Agent.create`); `agent-orchestrator.ts:89` (delegate caller); `sdk-real-llm.test.ts:124,147,181` (smoke callers); SDK option types (`cron-Bhp8rP8i.d.ts:1146,1151,1153,1332`).

#### Files to edit
```
packages/agents/src/bridge/sdk-adapter.ts — add RuntimeOverrides; createSdkAgentStream(overrides); spread plugins/providers/agents/budgetTracker + local.cwd into Agent.create
packages/agents/src/loop/agent-runner.ts — add 4 fields to AgentRunnerRunOptions; stream() builds RuntimeOverrides
packages/agents/src/bridge/agent-orchestrator.ts — update delegate call to the overrides object
packages/agents/tests/smoke/sdk-real-llm.test.ts — update 3 calls to the overrides object
packages/agents/tests/integration/runtime-overrides.test.ts — RED tests added first (TDD) for the 4 new fields
```

#### Deep file dependency analysis
- `sdk-adapter.ts` (Baseline: projects to `Agent.create`) — add `RuntimeOverrides`; `model = overrides.model ?? compiled.model ?? default`; merge `overrides.cwd` into `local`; conditionally add `plugins`/`providers`/`agents`/`budgetTracker`. Downstream: all callers pass an object.
- `agent-runner.ts` (Baseline: runner) — widen `AgentRunnerRunOptions`; `stream()` builds `{ model: opts.model, cwd: opts.cwd, plugins: opts.plugins, providers: opts.providers, agents: opts.agents, budgetTracker: opts.budgetTracker }`. `maxIterations`/`budget`/`tools` paths unchanged.
- `agent-orchestrator.ts` (Baseline: delegate) — `createSdkAgentStream(compiled, allTools, apiKey, { model: walk.agentConfig.model })`.
- `sdk-real-llm.test.ts` (smoke) — `createSdkAgentStream(compiled, [...], apiKey, { model })`.

#### Deep Dives
- **Invariant:** a `{ apiKey }`-only call → `overrides = { model: undefined, ... }` → `model` falls to `compiled.model ?? default`, no `plugins`/`providers`/`agents`/`budgetTracker`/`local.cwd` keys added (Baseline invariant).
- **Conditional spread:** each field added only when defined, e.g. `if (overrides.plugins !== undefined) createOpts.plugins = overrides.plugins`; absent ⇒ no key (the SDK default applies).
- **agents (D3):** `overrides.agents` only — `compiled.agents` stays unspread.
- **plugins typing:** `PluginsSettings` (matches the SDK param); the app casts `Plugin[]` per the SDK wart (documented).

#### Pseudo-code / Signatures
```ts
// sdk-adapter.ts
export interface RuntimeOverrides {
  model?: string
  cwd?: string
  plugins?: PluginsSettings
  providers?: ProviderRoutingSettings
  agents?: Record<string, AgentDefinition>
  budgetTracker?: BudgetTracker
}
export function createSdkAgentStream(compiled, compiledTools, apiKey, overrides: RuntimeOverrides = {}) {
  const model = overrides.model ?? compiled.model ?? 'openai/gpt-4o-mini'
  // ...assembleM8CreateOptions(compiled) → m8...
  if (overrides.cwd !== undefined) m8.local = { ...m8.local, cwd: overrides.cwd }
  const extra: Record<string, unknown> = {}
  if (overrides.plugins !== undefined) extra.plugins = overrides.plugins
  if (overrides.providers !== undefined) extra.providers = overrides.providers
  if (overrides.agents !== undefined) extra.agents = overrides.agents
  if (overrides.budgetTracker !== undefined) extra.budgetTracker = overrides.budgetTracker
  await Agent.create({ apiKey, model: { id: model }, tools: sdkTools, ...m8, ...extra })
}
// agent-runner.ts stream():
const streamFactory = createSdkAgentStream(this.compiled, tools, opts.apiKey, {
  model: opts.model, cwd: opts.cwd, plugins: opts.plugins,
  providers: opts.providers, agents: opts.agents, budgetTracker: opts.budgetTracker,
})
```

#### Tasks
1. Add `RuntimeOverrides` + the four type-only SDK imports to `sdk-adapter.ts`; rewrite `createSdkAgentStream` to the object param; conditional-spread the four + cwd.
2. Add the four fields to `AgentRunnerRunOptions`; build `RuntimeOverrides` in `stream()`.
3. Update `agent-orchestrator.ts` + the 3 smoke calls to the object form.
4. Run typecheck.

#### Concurrency tests

(none — single-threaded)

`overrides` is a per-call local object — no shared mutation.

#### Acceptance Criteria
- [ ] Types compile with the four fields + object signature: `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Pass: complexity — `npx eslint packages/agents/src/bridge/sdk-adapter.ts packages/agents/src/loop/agent-runner.ts packages/agents/src/bridge/agent-orchestrator.ts --max-warnings=0` (complexity rule clean)
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/runtime-overrides.test.ts` ≥ 90% on changed files
- [ ] Pass: lint — `npx eslint packages/agents/src/bridge/sdk-adapter.ts packages/agents/src/loop/agent-runner.ts packages/agents/src/bridge/agent-orchestrator.ts --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/src/bridge/sdk-adapter.ts)" -le 500 && test "$(wc -l < packages/agents/src/loop/agent-runner.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

---

## Phase 2: Wiring proofs

**Objective:** prove each of the four fields reaches `Agent.create`, they compose with the V4-L.2 fields, and absent overrides preserve prior behavior.

### T2.1 — Integration: plugins/providers/agents/budgetTracker reach `Agent.create`; compose; backward compat

#### Objective
With `@theokit/sdk` mocked (capturing `Agent.create`), assert each of the four overrides is observed on the captured call; one call sets all four plus the V4-L.2 fields; a no-override call omits all four.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — extends `runtime-overrides.test.ts` (reusing its `Agent.create`-capturing mock) with a V4-L.3 describe block: one test per field asserting it reaches `Agent.create`, a compose test, and a no-override omission test.
2. **Why it is necessary now** — the Goal's metric is "each of the four options is observed on the captured `Agent.create` call". The test is the wiring proof (pillar b) that the threading fires, not just compiles.

#### Evidence
`sdk-adapter.ts` Agent.create spread (the conditional-spread added in T1.1); the existing capture mock at `runtime-overrides.test.ts:14-50`.

#### Files to edit
```
packages/agents/tests/integration/runtime-overrides.test.ts — add a V4-L.3 describe block (4 reach-create tests + compose + omission)
```

#### Deep file dependency analysis
- Extends the V4-L.2 integration test (DRY — reuses the `@theokit/sdk` capture mock). No production change in this task.

#### Deep Dives
- **Per-field reach:** `run('hi', { apiKey, plugins: P })` → `captured.plugins === P` (and the analogous providers/agents/budgetTracker, each with a sentinel value).
- **Compose:** one call with all four + `model`/`cwd`/`maxIterations`/`tools` → every value observed on `captured` and the loop ceiling honored.
- **Omission:** `run('hi', { apiKey })` → `captured.plugins`/`providers`/`agents`/`budgetTracker` all `undefined` (no key added).

#### Pseudo-code / Signatures
```ts
const PLUGINS = [{ name: 'perm' }] as unknown as PluginsSettings
await runner.run('hi', { apiKey: 'k', plugins: PLUGINS })
expect(h.captured?.plugins).toBe(PLUGINS)
// providers/agents/budgetTracker analogous; compose asserts all four + omission asserts undefined
```

#### Tasks
1. Add per-field reach tests (plugins/providers/agents/budgetTracker).
2. Add the compose test (all four + V4-L.2 fields) and the no-override omission test.
3. Add `test_budget_and_budgetTracker_coexist` (EC-1) and `test_empty_plugins_array_is_forwarded` (EC-2).
4. Run the test.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Each of the four reaches `Agent.create`: `npx vitest run packages/agents/tests/integration/runtime-overrides.test.ts`
- [ ] Compose (four + V4-L.2 fields) + no-override omission pass (same command)
- [ ] EC-1 budget+budgetTracker coexist + EC-2 empty-array forwarded pass: `npx vitest run packages/agents/tests/integration/runtime-overrides.test.ts`
- [ ] Pass: complexity — `npx eslint packages/agents/tests/integration/runtime-overrides.test.ts --max-warnings=0` (complexity rule clean)
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/runtime-overrides.test.ts` exercises the four conditional spreads in `sdk-adapter.ts`
- [ ] Pass: lint — `npx eslint packages/agents/tests/integration/runtime-overrides.test.ts --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/tests/integration/runtime-overrides.test.ts)" -le 500`

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
| G1 | `plugins` not forwarded per-request | T1.1, T2.1 | `AgentRunnerRunOptions.plugins` → conditional spread to `Agent.create`; test asserts reach (ADR D1) |
| G2 | `providers` not forwarded per-request | T1.1, T2.1 | `AgentRunnerRunOptions.providers` → spread; test asserts reach (ADR D1) |
| G3 | `agents` not forwarded per-request | T1.1, T2.1 | `AgentRunnerRunOptions.agents` (opts-only) → spread; test asserts reach (ADR D1/D3) |
| G4 | `budgetTracker` not forwarded (distinct from loop budget) | T1.1, T2.1 | `AgentRunnerRunOptions.budgetTracker` → spread; test asserts reach (ADR D4) |
| G5 | Adding 4 positionals would explode `createSdkAgentStream` | T1.1 | `RuntimeOverrides` object subsumes envModel/cwd + the four (ADR D2); callers updated |
| G6 | Backward compatibility (existing fields + 3-arg call) | T1.1, T2.1 | additive fields; `overrides` defaults `{}`; no-override omission test; full suite stays green |
| G7 | No proof the four reach `Agent.create` | T2.1 | integration captures `Agent.create` and asserts each field |

**Coverage: 7/7 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `rules/architecture.md` / G6)
- [ ] CHANGELOG.md updated — add a changeset under `.changeset/` (minor bump `@theokit/agents`)
- [ ] Backward compatibility preserved across public API (V4-J/V4-L.2 fields + the 3-arg `createSdkAgentStream` call unchanged)
- [ ] Plan-specific: `npx vitest run packages/agents/tests/integration/runtime-overrides.test.ts` passes (the Goal metric)
- [ ] **Runtime-metric proof** — n/a (no new counter)
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR is merged, move this plan to `knowledge-base/plans/completed/`

## Failure scenarios (when I/O external)

```
(none — no external I/O touched)
```

The four fields are forwarded into the SDK's `Agent.create`; this plan adds no external I/O call of its own (the SDK owns the model call, mocked in tests).

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 1-2. The plan is NOT done until this chain passes.

**Objective:** the whole `@theokit/agents` suite is green with the per-request surface complete.

### Execution
```
npx vitest run packages/agents                                   # unit + integration
npx vitest run --coverage packages/agents                        # coverage (≥ 90% on changed files)
npx tsc --noEmit -p packages/agents/tsconfig.test.json           # zero type errors
npx eslint packages/agents/src/bridge/sdk-adapter.ts packages/agents/src/loop/agent-runner.ts packages/agents/src/bridge/agent-orchestrator.ts --max-warnings=0
```

### Acceptance Criteria
- [ ] All test suites green — `npx vitest run packages/agents`
- [ ] Coverage ≥ 90% on changed files — `npx vitest run --coverage packages/agents`
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings (changed files) — `npx eslint packages/agents/src/bridge/sdk-adapter.ts packages/agents/src/loop/agent-runner.ts packages/agents/src/bridge/agent-orchestrator.ts --max-warnings=0`
- [ ] Runtime-metric proof — n/a this slice
- [ ] Failure scenarios green — n/a (`(none — no external I/O touched)`)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
