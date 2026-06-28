---
slug: agents-reasoning-effort
milestone_id: M1
created_at: 2026-06-28
goal: Add a provider-agnostic reasoningEffort knob to @theokit/agents that maps to the SDK ModelSelection.params so agents can request extended thinking.
---

# Plan: `@theokit/agents` reasoningEffort knob (enable extended thinking)

> **Version 1.1** (edge-case-plan absorbed 2026-06-28: EC-1 forward-compat `(string & {})` union, EC-2 empty-effort test) — M1 of the reasoning-visibility roadmap (`.claude/knowledge-base/ROADMAP-reasoning-visibility.md`, ADR-2 of blueprint `code-assistant-reasoning-ux`). Add a provider-agnostic `reasoningEffort` option to `@theokit/agents` (`@Agent` config + `AgentRunner.run` override) that the SDK adapter maps into the `@theokit/sdk` `ModelSelection.params` (`[{ id: 'thinking', value: effort }]`), so an agent can REQUEST extended thinking. The framework already EMITS the `thinking` StreamEvent + ships `AgentThinkingEvent` (Cycle 1); this closes the only missing half — nothing currently asks the provider to reason, so no thinking is ever produced (confirmed by a live theocode turn).

## Goal

> Enable an agent to request extended thinking via a `reasoningEffort` option, measured by `test_buildModelSelection_maps_effort_to_thinking_param` (effort → `model.params:[{id:'thinking',value:effort}]`) + `test_createSdkAgentStream_forwards_reasoningEffort_to_getOrCreate` (the adapter passes it to `Agent.getOrCreate`) — both green via `pnpm --filter @theokit/agents test`.

## Context

The real-turn diagnosis (theocode, 2026-06-28): the render/persist pipeline for thinking is complete, but **no reasoning ever appears because nothing enables it** — `@theokit/agents` passes `model: { id }` (a bare id) to `Agent.getOrCreate` with no reasoning param. The deep-research blueprint (9 frameworks) shows the universal fix: a provider-agnostic effort/budget knob mapped to the provider via the SDK. The `@theokit/sdk` already exposes the enable surface: `ModelSelection { id, params?: ModelParameterValue[] }` (`params` doc: "e.g. reasoning effort"), and the canonical reasoning param id is `thinking` (confirmed in the SDK source example `params: [{ id: "thinking", value: "high" }]`).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Why it exists today | Invariants to preserve |
|---|---|---|---|
| `packages/agents/src/bridge/sdk-adapter.ts` | 405+ | Bridges compiled decorators → SDK `Agent.getOrCreate`/`Run.stream`; builds `model: { id }` at the getOrCreate call; `RuntimeOverrides` per-run surface | `createSdkAgentStream` signature + the #44 merge/dedup + dispose/usage paths unchanged; < 500 LoC (G6); no `@theokit/agents`→core import (G1) |
| `packages/agents/src/bridge/agent-compiler.ts` | 135+ | `compileAgent()` → `CompiledAgentOptions` (carries `model`); `@Agent({...})` config | additive field; existing compiled output unchanged |
| `packages/agents/src/loop/agent-runner.ts` | 230+ | `AgentRunner.run/builder`; `AgentRunnerRunOptions` (has `model?`); forwards to `RuntimeOverrides` | additive field; both on-ramps (delegate + builder) forward it identically |
| `packages/agents/tests/unit/*` (NEW or existing bridge test) | — | unit tests for the bridge | n/a |

Every file in any `#### Files to edit` block appears here.

### Current callers / dependents

- **`RuntimeOverrides`** (`sdk-adapter.ts:76-105`): `{ model?, cwd?, ... }` — the per-run surface forwarded into `Agent.getOrCreate`. The model is resolved `overrides.model ?? compiled.model ?? 'openai/gpt-4o-mini'` (`:339`) and passed as `model: { id: model }` (`:443`).
- **`CompiledAgentOptions.model`** (`agent-compiler.ts:85-86`): the compiled `@Agent` config; populated from `walkResult.agentConfig.model` (`:132`).
- **`AgentRunnerRunOptions.model`** (`agent-runner.ts:67`): per-run override; forwarded at `:204` into the run path → `RuntimeOverrides`.
- **SDK `Agent.getOrCreate(id, opts)`**: `opts.model?: ModelSelection` (`@theokit/sdk` `run-D22b53SU.d.ts:428` + `index.d.ts:132`). `ModelSelection { id, params?: ModelParameterValue[] }`; `ModelParameterValue { id, value }` (`:18,29`). Param defs discovered via `Theokit.models.list()` (`ModelParameterDefinition`/`ModelVariant`, `index.d.ts:1978-2012`).
- **`@Model` decorator** (`decorators/model.ts:35`): `createDecorator<string>()` — model id STRING only. NOT extended here (would break its string contract — D1).

### Domain glossary

- **`reasoningEffort`** — the new provider-agnostic knob: `'minimal'|'low'|'medium'|'high'|'xhigh' | (string & {})` (the common set autocompletes; `(string & {})` accepts provider-specific values forward-compat, mirroring `AgentRunErrorCode` — EC-1). The SDK validates the value against its model catalog.
- **`ModelSelection.params`** — the SDK's per-model param array; reasoning is `{ id: 'thinking', value: <effort> }`.
- **`thinking` StreamEvent** — already emitted by `@theokit/agents` (`bridge/event-translator.ts:155`) when the provider produces reasoning; `AgentThinkingEvent` already in the `theo` contract (Cycle 1, theokit@0.11.0).
- **capability** — `resolveModelCapabilities` (`@theokit/sdk/models`) does NOT expose reasoning; the SDK validates `params` against its runtime catalog (`models.list()`).

### Architecture boundaries affected

- **G2 / `sdk-runtime.md`:** respected — no reimplementation; the knob maps to the SDK's existing `ModelSelection.params`. The SDK owns provider mapping + validation.
- **G1 (dependency direction):** unchanged — `agents` imports `@theokit/sdk` types only (`ModelSelection`/`ModelParameterValue` are type-only).
- **Rule 9:** no reimplemented capability registry; the SDK's `models.list()` catalog is the gate (an unsupported effort surfaces as an SDK/provider error, not a hand-rolled check).
- **G6 (≤ 500 LoC):** the mapping is a small pure helper (`buildModelSelection`) — adapter stays under budget.

## Prior Art & Related Work

- **Blueprint** `code-assistant-reasoning-ux` ADR-2 (the enable model) — primary reference **omnigent** (`omnigent/omnigent/reasoning_effort.py:12-55` per-provider effort sets + typed-error gate; `omnigent/omnigent/llms/adapters/anthropic.py:356-375` effort→budget). Cline `gateway.ts:170-175` (effort/budget knob) + Vercel AI SDK `providerOptions` corroborate.
- **In-repo SDK surface**: `ModelSelection.params` (`@theokit/sdk` `run-D22b53SU.d.ts:18-31`) + canonical id `thinking` (SDK source example `params: [{ id: "thinking", value: "high" }]`).
- **Cycle 1 (shipped)**: `AgentThinkingEvent` contract (theokit@0.11.0) — the consumer side; this plan is the producer-enable side.

## Objective

- [ ] `reasoningEffort?: ReasoningEffort` added to `@Agent` config (`CompiledAgentOptions`), `AgentRunnerRunOptions`, and `RuntimeOverrides` (additive, optional).
- [ ] A pure `buildModelSelection(modelId, effort?): ModelSelection` maps an effort to `{ id, params: [{ id:'thinking', value:effort }] }` (and to `{ id }` when effort is absent).
- [ ] `createSdkAgentStream` uses `buildModelSelection` at the `getOrCreate` call (precedence: run-override > compiled > none), forwarding the param to the SDK.
- [ ] No behavior change when `reasoningEffort` is unset (existing agents pass `model: { id }` exactly as before).
- [ ] `@Model` stays string-only (untouched). No static capability registry reimplemented (SDK validates).
- [ ] theokit released (the consumable version for M3 theocode).

## ADRs

### D1 — Surface `reasoningEffort` on `@Agent` config + `AgentRunner.run`, NOT on `@Model`
- **Decision:** add `reasoningEffort?` to the `@Agent({...})` config (→ `CompiledAgentOptions`) and to `AgentRunnerRunOptions`/`RuntimeOverrides` (per-run override). Leave `@Model` (`createDecorator<string>()`) untouched.
- **Rationale:** `@Model` is a string-id decorator (`@Model('claude-...')`); widening it to an object breaks its contract + every caller. The `model`-id + `reasoningEffort` pair mirrors how `model` already flows (config + run-override). Per-run override matters (omnigent persists effort per session; theocode M3 will set it per session).
- **Alternatives considered:** (a) a new `@ReasoningEffort()` decorator — REJECTED (YAGNI; the @Agent config + run option cover it; a decorator adds surface for one scalar). (b) widen `@Model` to `{id, reasoningEffort}` — REJECTED (breaking).
- **Consequences:** additive optional field across 3 option types; precedence mirrors `model`.

### D2 — Map effort → `ModelSelection.params [{ id:'thinking', value:effort }]` via a pure `buildModelSelection` helper
- **Decision:** add a pure `buildModelSelection(modelId: string, effort?: ReasoningEffort): ModelSelection` returning `{ id: modelId }` when no effort, else `{ id: modelId, params: [{ id: 'thinking', value: effort }] }`. Call it at `sdk-adapter.ts:443`.
- **Rationale:** the SDK's enable surface is `ModelSelection.params`; the canonical reasoning param id is `thinking` (confirmed in the SDK source). Extracting a pure helper keeps the adapter under G6 and makes the mapping unit-testable without a fake Agent (mirrors Cycle-1's `translateInteractionUpdate` extraction).
- **Alternatives considered:** (a) inline the object at the call site — REJECTED (untestable without the async-iterator harness; pushes LoC). (b) resolve the param id dynamically via `models.list()` — REJECTED for M1 (a network/catalog call in the stream path; the `thinking` id is the SDK's documented convention; revisit only if a provider needs a different id).
- **Consequences:** one new exported pure function (with unit tests, G7). The effort `value` is passed through as a string; the SDK validates it against the model's catalog.

### D3 — No static reasoning-capability gate in `@theokit/agents`; the SDK is the gate (typed error pass-through)
- **Decision:** do NOT add a reasoning-capability registry in `@theokit/agents`. Pass the effort param through; if the model/provider does not support it, the SDK/provider surfaces an error (which the adapter already maps to an `error` StreamEvent).
- **Rationale:** `resolveModelCapabilities` has no reasoning flag, and `models.list()` is the SDK's runtime catalog/validator — reimplementing a static gate would duplicate the SDK (Rule 9) and drift. Omnigent's typed-error gate is the *app/SDK* layer's job; the framework just plumbs. Honest: an unsupported effort fails loud via the existing error path.
- **Alternatives considered:** a hardcoded effort-capable model allowlist in agents — REJECTED (Rule 9 duplication + maintenance drift). 
- **Consequences:** an unsupported `reasoningEffort` on a non-reasoning model yields a provider error (visible), not a silent no-op. Documented; M3 (theocode) adds a UI-level model-aware affordance.

### D4 — Precedence: run-override > compiled(@Agent) > none (mirror `model`)
- **Decision:** `const effort = overrides.reasoningEffort ?? compiled.reasoningEffort` (same shape as `overrides.model ?? compiled.model` at `:339`).
- **Rationale:** consistency with the existing `model` resolution; per-run override is the documented need (M3 per-session effort).
- **Alternatives considered:** compiled-only (no run override) — REJECTED (M3 needs per-run/per-session).
- **Consequences:** one resolution line; tested.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| The canonical param id `thinking` is inferred from an SDK source example, not a typed constant | Medium | Confirmed in the SDK dist source (`params: [{ id: "thinking", value: "high" }]`); a wrong id surfaces as a provider error in M3's live test, not a silent failure; if the SDK later exports a constant, switch to it | agents |
| An unsupported effort on a non-reasoning model errors at runtime (no static gate, D3) | Low | Intentional (Rule 9 — SDK validates); the error path already maps to an `error` event; M3 adds model-aware UI gating | agents |
| Effort value vocabulary may differ per provider (`xhigh` only some) | Low | Pass-through string; SDK validates against `models.list()`; the type union documents the common set; unknown value → provider error | agents |
| Threading a new optional field across 3 option types | Low | Additive `?:`; existing callers unaffected; type tests + unit tests | agents |

## Unresolved Questions

- (none — every decision is resolved at plan time). The `thinking` param id is confirmed in the SDK source; the value vocabulary is pass-through validated by the SDK catalog; if a future provider needs a non-`thinking` param id, D2's `buildModelSelection` helper is the single change point.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | installed (peer) | npm | `ModelSelection`/`ModelParameterValue` types (type-only import) + the runtime that maps `params` to the provider. No version change. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | No new dependency — a TypeScript option + a pure mapping over the existing SDK `ModelSelection`. | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

## Dependency Graph

```
Phase 1 (types + buildModelSelection helper + unit tests) ──▶ Phase 2 (thread reasoningEffort through compiler/runner + adapter wiring + tests) ──▶ Phase 3 (Integration Validation + release)
```

Phase 1 is a prerequisite for Phase 2 (the adapter calls the helper + reads the new fields). Sequential.

---

## Phase 1: `ReasoningEffort` type + `buildModelSelection` helper

### T1.1 — Add `ReasoningEffort` type + pure `buildModelSelection`

#### Objective
A `ReasoningEffort` union + a pure `buildModelSelection(modelId, effort?): ModelSelection` in `sdk-adapter.ts` (or a small sibling) mapping effort → `params:[{id:'thinking',value:effort}]`, else `{id}`.

#### Why this step (action + reasoning)
1. Introduces the testable mapping core (D2) — effort → SDK `ModelSelection.params`.
2. Necessary before Phase 2 wires it; extracting it keeps the adapter under G6 and unit-testable without a fake Agent.

#### Evidence
SDK `ModelSelection`/`ModelParameterValue` (`@theokit/sdk` `run-D22b53SU.d.ts:18-31`); canonical id `thinking` (SDK source `params: [{ id: "thinking", value: "high" }]`); current bare `model: { id }` at `sdk-adapter.ts:443`.

#### Files to edit
```
packages/agents/src/bridge/sdk-adapter.ts — add `export type ReasoningEffort` + `export function buildModelSelection(modelId, effort?)`
packages/agents/tests/unit/sdk-adapter-model-selection.test.ts — (NEW) RED unit tests
```

#### Deep file dependency analysis
Pure function; type-only `ModelSelection` import (already imported or add `import type`). No existing signature changes. Used by `createSdkAgentStream` in Phase 2.

#### TDD
```
RED:  test_buildModelSelection_no_effort_returns_bare_id — buildModelSelection('m') → { id:'m' } (no params)
RED:  test_buildModelSelection_maps_effort_to_thinking_param — buildModelSelection('m','high') → { id:'m', params:[{id:'thinking',value:'high'}] }
RED:  test_buildModelSelection_each_effort_level — 'minimal'|'low'|'medium'|'high'|'xhigh' each map to value verbatim
RED:  test_buildModelSelection_empty_effort_is_bare_id — buildModelSelection('m','') → { id:'m' } (no params) (EC-2)
GREEN: implement the union (incl. `(string & {})` forward-compat — EC-1) + helper
VERIFY: pnpm --filter @theokit/agents test sdk-adapter-model-selection
```

#### Concurrency tests (only when applicable)
(none — single-threaded) — pure synchronous mapping.

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test sdk-adapter-model-selection` exits 0 (3 tests green).
- [ ] Pass: lint — `npx eslint packages/agents/src/bridge/sdk-adapter.ts` exits 0.
- [ ] Pass: size — `wc -l packages/agents/src/bridge/sdk-adapter.ts` ≤ 500.
- [ ] Type-only SDK import (no runtime coupling) — `grep "import type" packages/agents/src/bridge/sdk-adapter.ts` covers `ModelSelection`.

#### DoD
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` 0 errors; eslint clean on the file.

---

## Phase 2: Thread `reasoningEffort` through the surfaces + wire the adapter

### T2.1 — Add `reasoningEffort` to the option types + resolve + wire at getOrCreate

#### Objective
`reasoningEffort?` on `CompiledAgentOptions` (+ `@Agent` config), `AgentRunnerRunOptions`, `RuntimeOverrides`; `createSdkAgentStream` resolves `overrides.reasoningEffort ?? compiled.reasoningEffort` and passes `buildModelSelection(model, effort)` to `Agent.getOrCreate`.

#### Why this step (action + reasoning)
1. Connects the declarative + per-run surfaces to the SDK enable param — the actual M1 feature.
2. Depends on T1.1's helper. One task keeps the thread coherent (type + resolve + wire change together).

#### Evidence
`CompiledAgentOptions.model` (`agent-compiler.ts:85-86,132`); `AgentRunnerRunOptions.model` (`agent-runner.ts:67,204`); `RuntimeOverrides.model` (`sdk-adapter.ts:82`); model resolution `:339`; getOrCreate `model: { id: model }` `:443`.

#### Files to edit
```
packages/agents/src/bridge/sdk-adapter.ts — RuntimeOverrides gains reasoningEffort?; resolve effort; replace `model: { id: model }` with `model: buildModelSelection(model, effort)`
packages/agents/src/bridge/agent-compiler.ts — CompiledAgentOptions gains reasoningEffort?; carry from @Agent config (walkResult.agentConfig.reasoningEffort) in compileAgent
packages/agents/src/loop/agent-runner.ts — AgentRunnerRunOptions gains reasoningEffort?; forward into RuntimeOverrides (both run + builder paths)
packages/agents/tests/integration/sdk-adapter-streaming.test.ts — RED: createSdkAgentStream forwards reasoningEffort to getOrCreate (fake Agent asserts opts.model.params)
packages/agents/tests/unit/agent-compiler.test.ts (or existing) — RED: @Agent({reasoningEffort}) → compiled.reasoningEffort
```

#### Deep file dependency analysis
- Additive optional fields — no existing caller breaks. The fake-Agent streaming test captures `getOrCreate(id, opts)` opts; assert `opts.model` equals `buildModelSelection(...)` when effort set, and `{id}` when unset.
- Precedence `overrides.reasoningEffort ?? compiled.reasoningEffort` mirrors `model` (D4).
- `@Agent` config type (`agent-compiler.ts` AgentConfig / the decorator config) gains `reasoningEffort?`; `compileAgent` copies it to `CompiledAgentOptions` next to `model`.

#### TDD
```
RED:  test_createSdkAgentStream_forwards_reasoningEffort_to_getOrCreate — compiled.reasoningEffort='high' ⇒ getOrCreate opts.model = {id, params:[{id:'thinking',value:'high'}]}
RED:  test_run_override_reasoningEffort_beats_compiled — overrides.reasoningEffort='low' wins over compiled 'high'
RED:  test_no_reasoningEffort_passes_bare_model_id — unset ⇒ opts.model = {id} (backward-compat, no params)
RED:  test_agent_config_reasoningEffort_compiles — @Agent({reasoningEffort:'medium'}) → compiled.reasoningEffort==='medium'
GREEN: thread the field + resolve + wire buildModelSelection
REFACTOR: keep adapter < 500 LoC
VERIFY: pnpm --filter @theokit/agents test sdk-adapter ; pnpm --filter @theokit/agents test agent-compiler
```

#### Concurrency tests (only when applicable)
(none — single-threaded) — option threading + a synchronous model-selection build; no shared mutable state.

#### Failure scenarios
| Dependency | Failure mode | Test | Expected |
|---|---|---|---|
| SDK provider | model does not support the effort param | (covered by the existing error path; D3) | the provider error surfaces as an `error` StreamEvent (no silent no-op) — asserted at M3 live, documented here |

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test sdk-adapter` exits 0 (forward + override + bare-id tests green).
- [ ] `pnpm --filter @theokit/agents test agent-compiler` exits 0 (config-compile test green).
- [ ] Backward-compat — `git diff` shows the bare-id path is `buildModelSelection(model)` returning `{id}` (no params) when effort unset; existing streaming tests stay green.
- [ ] Pass: lint — `npx eslint packages/agents` exits 0 on touched files.
- [ ] Pass: size — `wc -l packages/agents/src/bridge/sdk-adapter.ts` ≤ 500.

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green (no regression in the 16 caller tests).
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` 0 errors.
- [ ] CHANGELOG `[Unreleased]` updated (Unbreakable Rule 6).

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Effort → SDK enable param mapping | T1.1 | `buildModelSelection` → `params:[{id:'thinking',value}]` (D2) |
| 2 | Declarative surface (`@Agent`) | T2.1 | `CompiledAgentOptions.reasoningEffort` + compile (D1) |
| 3 | Per-run override surface | T2.1 | `AgentRunnerRunOptions`/`RuntimeOverrides.reasoningEffort` + precedence (D1/D4) |
| 4 | Adapter forwards to SDK `getOrCreate` | T2.1 | `model: buildModelSelection(model, effort)` at `:443` |
| 5 | Backward-compat (no effort → bare id) | T1.1, T2.1 | helper returns `{id}`; bare-id test |
| 6 | `@Model` unchanged; no reimplemented capability gate | T1.1, T2.1 | D1 (string-only) + D3 (SDK validates) |

**Coverage: 6/6 implementation gaps covered (100%)** — (the theokit release for M3 consumption is the post-cycle `cycle-release` step, tracked in Global DoD + Final Phase, not an implementation gap.)

## Global Definition of Done

- [ ] All phases completed.
- [ ] All tests passing — `pnpm --filter @theokit/agents test` green.
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`.
- [ ] Zero lint warnings — `npx eslint packages/agents` on touched files.
- [ ] File-size budget — `sdk-adapter.ts` < 500.
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6).
- [ ] Backward compatibility — unset `reasoningEffort` ⇒ identical `model: { id }` behavior; existing tests green.
- [ ] **Runtime-metric proof** — n/a (a pass-through option; the behavioral proof is the forward + bare-id tests; live reasoning is verified at M3 theocode).
- [ ] **Plan archived** — after `/review` READY_TO_MERGE + PR merged, move to `knowledge-base/plans/completed/`.
- [ ] theokit released (changeset minor) so M3 can consume.

## Failure scenarios (when I/O external)

The adapter's only external boundary is `@theokit/sdk` `Agent.getOrCreate`/`Run.stream` (driven by a fake Agent in tests). The single new failure mode — a provider rejecting an unsupported effort — is handled by the existing error→`error`-StreamEvent path (D3); covered above + verified live at M3. No new external I/O is introduced.

## Final Phase: Integration Validation (MANDATORY)

### Execution
```
pnpm --filter @theokit/agents test                              # full agents suite
npx tsc --noEmit -p packages/agents/tsconfig.test.json          # 0 errors
npx eslint packages/agents                                       # touched files clean
wc -l packages/agents/src/bridge/sdk-adapter.ts                  # < 500
```

### Acceptance Criteria
- [ ] Full agents suite green (16 caller tests + new tests).
- [ ] tsc 0; eslint clean on touched files; sdk-adapter < 500.
- [ ] `buildModelSelection` + forward + override + bare-id + config-compile tests all green.
- [ ] After READY_TO_MERGE: changeset (`theokit` minor) + release so theocode M3 consumes it.

### If Validation Fails
1. Separate plan-caused failures from the documented pre-existing agents-test baseline.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
