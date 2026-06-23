---
slug: v4-mainloop-reflective-runtime
milestone_id: V4-BC
created_at: 2026-06-23
goal: Make `@MainLoop({strategy:'plan-act-reflect'})` execute a real multi-round reflective loop via a new `LoopStrategy`/`ReflectionStrategy` + `AgentRunner` builder, measured by `packages/agents/tests/unit/main-loop-runtime.test.ts` + `tests/integration/reflective-loop-wiring.test.ts` passing green with zero `@MainLoop` strategies remaining metadata-only.
---

# Plan: Give RUNTIME to `@MainLoop({ strategy })` — Reflective Loop + AgentRunner Builder (V4-B + V4-C)

> **Version 1.0** — Today `@MainLoop({ strategy })` is metadata-only: the field is declared, mandatory, and compiled, but `bridge/agent-orchestrator.ts` is single-shot and never branches on `strategy`. This plan closes the "decorator-without-runtime" anti-pattern that V4-A diagnosed by introducing a Zod-validated `LoopStrategy`/`ReflectionStrategy` contract (modeled on Mastra's `agentic-loop`/`stopWhen`, not Spring's per-call Advisor), a multi-round reflective loop that lives in the bridge (the model call + tool loop stay in the SDK via `Run.stream()` per ADR 0031), and an `AgentRunner.builder()` imperative twin that compiles to the same runtime. Expected outcome: `@MainLoop({strategy:'plan-act-reflect'})` runs a real multi-round reflective loop bounded by `maxIterations`, observable via a green unit + integration test pair.

## Goal

> Enable `@theokit/agents` consumers to have `@MainLoop({strategy:'plan-act-reflect'})` execute a real multi-round reflective loop (via a new `LoopStrategy`/`ReflectionStrategy` contract + an `AgentRunner` builder), so that the declared `strategy` actually drives runtime behavior instead of being inert metadata, measured by `packages/agents/tests/unit/main-loop-runtime.test.ts` + `packages/agents/tests/integration/reflective-loop-wiring.test.ts` passing green with zero `@MainLoop` strategies remaining metadata-only.

## Context

V4-A proved that `@MainLoop({ strategy: 'simple-chat'|'plan-act-reflect'|'react' })` is metadata-only. The `strategy` field is declared (`packages/agents/src/types.ts:24`), defaulted at decoration time (`packages/agents/src/decorators/main-loop.ts:20`), walked (`packages/agents/src/bridge/walk-agent-metadata.ts:204`), and the sibling `maxIterations` field is compiled into `CompiledAgentOptions.maxIterations` (`packages/agents/src/bridge/agent-compiler.ts:135`). But the orchestrator never reads `strategy`: `delegate()` consumes exactly one `Run.stream()` turn in a single `for await` (`packages/agents/src/bridge/agent-orchestrator.ts:164-167`) and returns. There is no round re-entry, no `strategy` branch.

This is the exact anti-pattern that `sdk-runtime.md` (ADR 0031) + `system-design-guardrails.md` G10 ("Honest Enforcement") mandate closing — M8 already closed it for `@ContextWindow`/`@Skills`/`@ProjectContext` (`sdk-adapter.ts:118-126` logs `THEO_AGENT_M8_RUNTIME_APPLIED`); `@MainLoop` is the last metadata-only decorator with a mandatory field that does nothing.

The declarative-agent-orchestration discovery findings (SHIPPABLE_WITH_CAVEATS) investigated Spring AI (builder→executable, per-call Advisor) and Mastra (multi-round agentic loop) and concluded: model the terminal decision on Mastra's `stopWhen`/`maxSteps` (NOT Spring's per-call Advisor — wrong shape, EC-4); keep the loop in the bridge with the model call in the SDK (ADR 0031); ship `LoopStrategy` + `ReflectionStrategy` as Zod-validated contracts; expose `AgentRunner.builder()` as the imperative twin of the decorator — two on-ramps, one compiled runtime.

This plan implements **V4-B (AgentRunner builder)** + **V4-C (`strategy:'plan-act-reflect'` = ReflectionStrategy + the multi-round reflective loop)**. Out of scope (deferred to follow-up plans, mentioned in `## Drawbacks & Risks` and `## Unresolved Questions`): V4-D (`react`-only refinements), V4-E (guards in the loop), V4-F (compaction inside the loop), V4-H (`@theokit/starter-*` factories).

## Baseline Context (deep review of current state)

> Generated from real `wc -l` + `git log` + `grep` evidence captured 2026-06-23.

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/types.ts` | 72 | `efe63ed` (2026-06-11) | Decorator option/meta interfaces (`MainLoopOptions`, `MainLoopMeta`) | `MainLoopMeta.strategy` union stays `'simple-chat'\|'plan-act-reflect'\|'react'`; existing exports stay barrel-exported |
| `packages/agents/src/bridge/agent-orchestrator.ts` | 179 | `04d8b40` (2026-06-22) | `delegate()` single-shot sub-agent runner + budget clamp + `processStreamEvent` | `delegate()` signature + `BudgetExceededError`/`DelegationError` stay backward-compatible; budget clamping (D4) preserved |
| `packages/agents/src/decorators/main-loop.ts` | 30 | `efe63ed` (2026-06-11) | `@MainLoop` decorator: stores `MainLoopMeta` | `getMainLoop()` stays; last-wins warning preserved; default `strategy:'simple-chat'` preserved |
| `packages/agents/src/bridge/agent-compiler.ts` | 139 | `04d8b40` (2026-06-22) | `compileAgent()` → `CompiledAgentOptions` (single compile site per sdk-runtime.md) | `CompiledAgentOptions` stays additive; `maxIterations` derivation (`:135`) preserved; single compile site invariant |
| `packages/agents/src/bridge/sdk-adapter.ts` | 166 | `04d8b40` (2026-06-22) | `createSdkAgentStream()` → SDK `Agent.create()` + `Run.stream()` (the ONLY LLM call site) | No direct LLM `fetch`; SDK is sole runtime (G2/ADR 0031); `StreamEvent` shape unchanged |
| `packages/agents/src/bridge/walk-agent-metadata.ts` | 306 | `704bce5` (2026-06-22) | Walks decorator metadata → `AgentWalkResult` (carries `mainLoop: MainLoopMeta`) | `AgentWalkResult.mainLoop` preserved; memoization (WeakMap) preserved; EC-1 missing-`@MainLoop` throw preserved |
| `packages/agents/src/loop/loop-strategy.ts` (NEW) | 0 | — | (file to create — `LoopStrategy` interface + `LoopOutcome` + Zod schema + `resolveLoopStrategy`) | — |
| `packages/agents/src/loop/reflection-strategy.ts` (NEW) | 0 | — | (file to create — `ReflectionStrategy` interface + Zod schema + `'ladder'` default impl) | — |
| `packages/agents/src/loop/run-reflective-loop.ts` (NEW) | 0 | — | (file to create — the multi-round bridge loop driving `createSdkAgentStream` per round) | — |
| `packages/agents/src/loop/agent-runner.ts` (NEW) | 0 | — | (file to create — `AgentRunner` + `AgentRunner.builder()` fluent class) | — |
| `packages/agents/src/loop/index.ts` (NEW) | 0 | — | (file to create — barrel for the `loop/` module, re-exported from `src/index.ts`) | — |
| `packages/agents/src/index.ts` | 9 (head) | `efe63ed` (2026-06-11) | Root barrel re-exporting decorators/bridge/manifest/types | INVARIANT #3: public API only via barrels; existing re-exports preserved |
| `packages/agents/tests/unit/main-loop-runtime.test.ts` (NEW) | 0 | — | (file to create — unit tests for `LoopStrategy`/`ReflectionStrategy`/loop) | — |
| `packages/agents/tests/unit/agent-runner.test.ts` (NEW) | 0 | — | (file to create — unit tests for the builder) | — |
| `packages/agents/tests/integration/reflective-loop-wiring.test.ts` (NEW) | 0 | — | (file to create — end-to-end loop wiring via mock SDK stream) | — |

### Current callers / dependents

- **Symbol:** `delegate()` in `packages/agents/src/bridge/agent-orchestrator.ts`
  - **Callers (production):** re-exported from `packages/agents/src/bridge/index.ts` (barrel). `createSdkAgentStream` is called from `agent-orchestrator.ts:159` and re-exported from `sdk-adapter.ts` + `bridge/index.ts`.
  - **Callers (tests):** `packages/agents/tests/unit/agent-orchestrator.test.ts`, `packages/agents/tests/smoke/sdk-real-llm.test.ts`, `packages/agents/tests/integration/m8-adapter-wiring.test.ts`, `packages/agents/tests/unit/walk-agent-metadata.test.ts`.
  - **External (other repos):** `delegate` is barrel-exported from `@theokit/agents`; treat its signature as a public contract — this plan ADDS a new entry point (`AgentRunner`) and does NOT break `delegate()`.
- **Symbol:** `createSdkAgentStream()` in `packages/agents/src/bridge/sdk-adapter.ts`
  - **Callers (production):** `agent-orchestrator.ts:159`; barrel `bridge/index.ts`.
  - **Callers (tests):** `tests/integration/m8-adapter-wiring.test.ts`, `tests/smoke/sdk-real-llm.test.ts`, `tests/unit/mock-stream.test.ts`.
  - **External:** barrel-exported; the new loop reuses it per-round (no signature change).
- **Symbol:** `MainLoopMeta` / `MainLoopOptions` in `packages/agents/src/types.ts`
  - **Callers (production):** `decorators/main-loop.ts`, `walk-agent-metadata.ts:204`, `agent-compiler.ts:135-136`.
  - **Callers (tests):** `tests/unit/main-loop-decorator.test.ts`, `tests/unit/walk-agent-metadata.test.ts`.
  - **External:** `MainLoopMeta`/`MainLoopOptions` barrel-exported from `src/index.ts`; union stays unchanged.

### Domain glossary

- **`@MainLoop`** — the decorator marking an agent's execution entry point; carries `strategy` + `maxIterations` + `timeoutMs` (`types.ts:21-37`).
- **`strategy`** — one of `'simple-chat' | 'plan-act-reflect' | 'react'`; today inert metadata. `simple-chat` = one round; `plan-act-reflect`/`react` = multi-round.
- **LoopStrategy** — NEW contract: `shouldContinue(outcome): boolean` + `maxIterations: number`; the per-round terminal decision (modeled on Mastra `stopWhen({steps})` inverted + `maxSteps` ceiling).
- **ReflectionStrategy** — NEW contract: `reflect(outcome): { feedback?: string; continue: boolean }`; composes INTO a LoopStrategy — mutates the next-round prompt; `'plan-act-reflect'` resolves to the `'ladder'` default ReflectionStrategy.
- **LoopOutcome** — NEW value object describing one round's result: `{ finishReason, round, toolCalls, responseText }`. `finishReason` is derived in the bridge from the stream events (presence of `tool_result` without terminal `done` ⇒ `'tool-calls'`; terminal `done` ⇒ `'stop'`; `error` event ⇒ `'error'`).
- **AgentRunner / `AgentRunner.builder()`** — NEW imperative twin of `@MainLoop`: a plain standalone TS class (no IoC) that walks/compiles the agent and resolves a `LoopStrategy`, then `run()` drives the reflective loop. Builder + decorator compile to the same runtime.
- **the bridge** — `packages/agents/src/bridge/` (+ new `src/loop/`): compiles decorator metadata and orchestrates rounds; it NEVER calls an LLM directly — the SDK (`Run.stream()`) does (ADR 0031 / G2).

### Architecture boundaries affected

- **G1 dependency direction:** new `src/loop/` lives inside `@theokit/agents` and depends only on the existing `bridge/` (intra-package). `@theokit/agents → @theokit/sdk` only (consumed via `sdk-adapter.ts` dynamic import); NEVER `sdk → agents`. New code imports `@theokit/sdk` types only through the existing adapter, not directly in the loop module.
- **INVARIANT #3 (barrels):** `src/loop/` gets its own `index.ts`; `src/index.ts` re-exports it. No deep cross-module imports.
- **sdk-runtime.md / G2 (ADR 0031):** the multi-round loop machinery is NEW bridge code; the model call + tool loop stay inside the SDK (`createSdkAgentStream` per round). Zero new LLM `fetch`. No re-implemented tool loop.
- **type-safety.md / G3:** `LoopStrategy`/`ReflectionStrategy` config schemas are Zod (SSoT); TS types via `z.infer`.
- **G6 file budget:** each new file ≤ 500 LoC; LoopStrategy / ReflectionStrategy / loop / builder are split across separate files for this reason.

## Prior Art & Related Work

- **Internal discovery** — the declarative-agent-orchestration discovery findings: the design source. Specifically the discovery's recommendations (the `LoopStrategy`/`ReflectionStrategy`/`AgentRunner.builder()` proposed shapes), the discovery's techniques coverage (Mastra canonical agentic-loop state machine), and the discovery's first two recorded ADRs.
- **Patterns skill** — `.claude/skills/theokit-http-decorators-pattern-from-nestjs-patterns/SKILL.md`: the "decorator metadata → factory call, bridge compiles" pattern and the "cross-package imports go through barrels, INVARIANT #3" pattern inform ADR D4 (dual on-ramp to one compiled runtime) and the barrel discipline. No Pattern is overridden by this plan.
- **Reference projects (via blueprint citations):** Mastra `@mastra/core` `loop/workflows/agentic-loop/index.ts:154-168,285` (terminal predicate + `maxSteps` ceiling + `isContinued` round terminator) — the model for `LoopStrategy.shouldContinue`; `tool-loop-agent.test.ts:389-423` (`steps.length === 2` multi-round assertion via `callCount`-switched mock model) — the model for the integration test. Spring AI `DefaultChatClientBuilder.java:114-116` (`build()` = the compile→execute boundary, standalone, zero `@Autowired`) — the model for `AgentRunner.builder().build()`.
- **External literature:** Mastra `stopWhen`/`StopCondition` is re-exported from the AI SDK (`@ai-sdk/provider`); the `finishReason: 'tool-calls'` vs `'stop'` continuation signal is the AI-SDK convention this plan mirrors locally as `LoopOutcome.finishReason`.

## Objective

- [ ] Sub-goal 1 — `LoopStrategy` interface + `LoopOutcome` value object + Zod config schema exist, with `resolveLoopStrategy(strategy, maxIterations)` mapping each `MainLoopMeta.strategy` value to a concrete strategy (`simple-chat` ⇒ one round; `react`/`plan-act-reflect` ⇒ multi-round).
- [ ] Sub-goal 2 — `ReflectionStrategy` interface + Zod schema + the `'ladder'` default implementation exist; `'plan-act-reflect'` resolves to it; `reflect()` returns `{ feedback?, continue }`.
- [ ] Sub-goal 3 — `runReflectiveLoop()` in the bridge drives `createSdkAgentStream` per round, builds a `LoopOutcome` from the stream events, calls `reflect()` then `shouldContinue()`, re-enters with feedback, and is bounded by `maxIterations` (forced terminal at the ceiling).
- [ ] Sub-goal 4 — `AgentRunner.builder(AgentClass).reflection(...).stream().build()` compiles the same agent + resolved `LoopStrategy`; `run(message)` delegates to `runReflectiveLoop`. Builder + decorator paths produce the same runtime.
- [ ] Sub-goal 5 — Zero `@MainLoop` strategies remain metadata-only: the loop branches on `strategy`; integration test proves a `'plan-act-reflect'` agent runs N>1 rounds via a mock SDK stream.

## ADRs

### D1 — ADR: Model `LoopStrategy` on Mastra's `agentic-loop`/`stopWhen`, NOT Spring's per-call Advisor

**Decision:** The terminal-decision contract is `LoopStrategy.shouldContinue(outcome): boolean` + `readonly maxIterations: number`, modeled on Mastra's `stopWhen({ steps })` predicate (inverted) + `maxSteps` ceiling.

**Rationale:** Per the discovery's first recorded ADR (EC-4): Spring's Advisor is a per-single-call interceptor (`before → chain.nextCall → after`); our requirement is a decision *between rounds* of a tool-using loop. Mapping a multi-round concern onto a per-call interceptor is the wrong shape. KISS: the smallest contract that captures `round → outcome → {continue, terminate}`. Cites `sdk-runtime.md` (the round-driving terminal decision is new; model call stays in SDK) + KISS.

**Alternatives considered:** (a) `LoopStrategy = Advisor` (per-call interceptor) — REJECTED: per-call ≠ multi-round (Blueprint EC-4). (b) A generic plugin/middleware chain with ordering — REJECTED: G11 YAGNI, no second concrete consumer; we have exactly the 3 strategy values today.

**Consequences:** Enables a thin, table-testable terminal predicate. Constrains the loop to a single linear round sequence (no parallel branches) — acceptable for the 3 current strategies.

### D2 — ADR: The multi-round loop lives in the BRIDGE; the SDK executes `Run.stream()`

**Decision:** `runReflectiveLoop()` (new bridge code in `src/loop/`) owns the round-counting, reflection, and termination; each round calls `createSdkAgentStream` (which calls SDK `Agent.create()` + `Run.stream()`). No LLM `fetch`, no re-implemented tool loop.

**Rationale:** Cites `sdk-runtime.md` (ADR 0031) + `system-design-guardrails.md` G2 ("SDK is the ONLY agent runtime") + G10 ("Honest Enforcement" — close the metadata-only gap). The loop is the theokit analog of Mastra's `runStreamUntilIdle` re-entering via `agent.stream([], …)` (per the discovery's techniques coverage). DRY: the model/tool loop is the SDK's job, not duplicated here.

**Alternatives considered:** (a) Re-implement the tool loop inside `@theokit/agents` — REJECTED: violates `sdk-runtime.md` G2 (BLOCKER), duplicates SDK logic (DRY). (b) Push the loop into the SDK's future continuation driver (V3-4) — REJECTED: not shipped yet; keeping `LoopStrategy` thin lets us delete it later if the SDK absorbs it (reversibility, see Drawback #1).

**Consequences:** Enables `@MainLoop` strategies to run without touching the SDK. Constrains: if the SDK ships its own continuation driver later, the bridge loop must stay thin enough to defer to it (mitigation in Drawbacks).

### D3 — ADR: `LoopStrategy` / `ReflectionStrategy` config schemas are Zod (SSoT)

**Decision:** The serializable config of each strategy (e.g., `{ name, maxIterations }` for LoopStrategy; `{ name }` for ReflectionStrategy) is defined ONCE as a Zod schema; TS types are derived via `z.infer`. Validation happens at `resolveLoopStrategy` / builder `.build()`.

**Rationale:** Cites `type-safety.md` ("Zod is the Single Source of Truth") + `system-design-guardrails.md` G3. `zod ^4` is already a dependency of `@theokit/agents` (`package.json:42`). Tool `input` schemas are already Zod (`ToolOptions.input`, `types.ts:52`) — consistent.

**Alternatives considered:** (a) Plain TS `interface` for config — REJECTED: loses runtime validation; a bad `maxIterations` (e.g., `0` or negative) would silently produce a zero-round or infinite loop. The Zod schema enforces `maxIterations >= 1`. (b) JSON Schema hand-written — REJECTED: duplicates the Zod SSoT, Rule 9 (don't reinvent).

**Consequences:** Enables fail-fast on invalid strategy config. Adds a small Zod schema per strategy (≤ 10 LoC each). The behavioral interfaces (the methods `shouldContinue`/`reflect`) stay plain TS — only the serializable config is Zod (KISS — do not Zod-wrap function members).

### D4 — ADR: Builder + Decorator are two on-ramps to ONE compiled runtime; standalone, no IoC

**Decision:** `AgentRunner.builder(AgentClass).reflection(...).stream().build()` and `@MainLoop` both produce the same `{ CompiledAgentOptions, resolved LoopStrategy }` consumed by `runReflectiveLoop`. `AgentRunner` is a plain standalone TS class — no IoC container, no new reflect-metadata beyond what decorators already use.

**Rationale:** Cites the discovery's second recorded ADR (Spring proves the builder works standalone — zero `@Autowired`; Mastra confirms via plain `new Agent({...})`) + the Patterns skill "decorator metadata → factory call, bridge compiles" pattern + `architecture.md` INVARIANT #3 (barrels). The decorator on-ramp already ships and is mandatory (`walk-agent-metadata.ts:205`); the builder is the imperative twin without forking the runtime.

**Alternatives considered:** (a) Builder-only, drop the decorator — REJECTED: the decorator is mandatory + already shipped; removing it breaks every existing agent. (b) Decorator-only, no builder — REJECTED: V4-B explicitly scopes the builder; the imperative twin is the documented deliverable and the SDK-style ergonomic. (c) Port Spring Boot auto-config (`@ConditionalOnMissingBean`) — REJECTED: EC-3 non-portable, needs an IoC container (forbidden by ADR 0031).

**Consequences:** Enables imperative + declarative usage with one runtime. Constrains both paths to the same `LoopStrategy` resolution — divergence between them is a bug, caught by the wiring integration test.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| The multi-round loop in the bridge could diverge from the SDK's future continuation driver (V3-4) once it ships, creating two loops | Medium | Keep `LoopStrategy` thin (terminal predicate only); the model call + tool loop stay in the SDK (ADR D2). If V3-4 ships, `runReflectiveLoop` defers to it and `LoopStrategy` collapses to a `stopWhen` adapter. Reversibility test (G11 #3) satisfied: the loop module is deletable in one barrel removal. | @theokit/agents maintainer |
| The reflection ladder (`'ladder'` default) is domain-specific and may not fit every agent | Medium | Ship `'ladder'` as the default but allow a custom `ReflectionStrategy` via `AgentRunner.builder().reflection(customStrategy)`; `'plan-act-reflect'` only resolves to `'ladder'` when no custom strategy is supplied (OCP — extend without modifying). | @theokit/agents maintainer |
| `LoopOutcome.finishReason` is derived heuristically from stream events (no native `finishReason` in current `StreamEvent`) | Medium | Derive deterministically: terminal `done` ⇒ `'stop'`; `tool_result` events seen but no terminal `done` from a round that the SDK ends ⇒ `'tool-calls'`; `error` event ⇒ `'error'`. Unit-test the derivation as a pure function (table-driven). If the SDK later exposes `finishReason`, swap the derivation for the native field (single function to change). | @theokit/agents maintainer |
| Adding `run/3` (loop) to the public surface grows the package API (G6 ≤ 30 exports/package WARN) | Low | Export only `AgentRunner` + the two strategy types from the `loop/` barrel; keep `runReflectiveLoop` internal (not re-exported from `src/index.ts`) — the builder is the public entry, the loop is an implementation detail. | @theokit/agents maintainer |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (Contracts) ──▶ Phase 2 (Runtime loop) ──▶ Phase 3 (Builder) ──▶ Phase 4 (Integration Validation)
       │                        │                         │
       │ T1.1 LoopStrategy ─────┤                         │
       │ T1.2 ReflectionStrategy┘                         │
       │                                                  │
       └── T1.3 loop/ barrel ──▶ (re-exported in T3.1)────┘
```

Phase 1 is a hard blocker for Phase 2 (the loop consumes the contracts). Phase 2 is a hard blocker for Phase 3 (the builder delegates to the loop). T1.1 and T1.2 can run in parallel; T1.3 (barrel) waits for both. Phase 4 runs last.

---

## Phase 1: Contracts (LoopStrategy + ReflectionStrategy + Zod schemas)

**Objective:** Introduce the Zod-validated `LoopStrategy`/`ReflectionStrategy` contracts + `LoopOutcome` value object + the strategy resolver, with zero runtime behavior change yet (pure, table-testable).

### T1.1 — `LoopStrategy` interface + `LoopOutcome` + Zod config + `resolveLoopStrategy`

#### Objective
Create `src/loop/loop-strategy.ts`: the `LoopOutcome` value object, the `LoopStrategy` interface, a Zod schema for its serializable config, and `resolveLoopStrategy(strategy, maxIterations)` mapping each `MainLoopMeta.strategy` to a concrete strategy.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does:** Adds a new pure module defining `LoopOutcome` (`{ finishReason, round, toolCalls, responseText }`), the `LoopStrategy` interface (`shouldContinue(outcome): boolean` + `readonly maxIterations: number`), a Zod schema `loopStrategyConfigSchema` (`{ name, maxIterations }` with `maxIterations >= 1`), and `resolveLoopStrategy` returning a concrete strategy per `strategy` value.

**Why it is necessary now:** Per ADR D1, the terminal predicate is the foundation the loop (Phase 2) branches on; it must exist and be validated before any round logic. Per ADR D3, the config is Zod (SSoT) so an invalid `maxIterations` fails fast at resolve time, not as a silent infinite loop at runtime. Baseline Context shows `maxIterations` is already compiled (`agent-compiler.ts:135`) but never used for round bounding — this task gives it meaning.

#### Evidence
- `packages/agents/src/types.ts:34` — `MainLoopMeta.strategy: 'simple-chat' | 'plan-act-reflect' | 'react'` (the values to map).
- `packages/agents/src/bridge/agent-compiler.ts:135` — `maxIterations` currently derived but only passed to the SDK, not used for round bounding.
- The discovery's recommendations — proposed `LoopStrategy`/`LoopOutcome` shapes (`shouldContinue` ⇐ Mastra `stopWhen` inverted; `maxIterations` ⇐ `maxSteps`).
- The discovery's techniques coverage / `agentic-loop/index.ts:154-168,285` — terminal logic + `maxSteps` ceiling.

#### Files to edit
```
packages/agents/src/loop/loop-strategy.ts — NEW: LoopOutcome, LoopStrategy, loopStrategyConfigSchema (Zod), resolveLoopStrategy
packages/agents/tests/unit/main-loop-runtime.test.ts — NEW: RED tests for resolveLoopStrategy + shouldContinue (table-driven)
```

#### Deep file dependency analysis
- `loop-strategy.ts` (new) imports `z` from `zod` (already a dep, `package.json:42`) and the `MainLoopMeta['strategy']` union type from `../types.js` (barrel-safe intra-package type import).
- No production file depends on it yet (Phase 2 will). Per Baseline Context § Current callers, `MainLoopMeta` is barrel-exported — importing its `strategy` member type does not change that contract.

#### Deep Dives
- **Data structures:** `LoopOutcome = { finishReason: 'tool-calls' | 'stop' | 'length' | 'error'; round: number; toolCalls: { name: string; input: unknown; output: string }[]; responseText: string }`. `loopStrategyConfigSchema = z.object({ name: z.enum(['simple-chat','plan-act-reflect','react']), maxIterations: z.number().int().min(1) })`.
- **Algorithm (`shouldContinue`):** `simple-chat` ⇒ always `false` (one round). `react`/`plan-act-reflect` ⇒ `outcome.finishReason === 'tool-calls' && outcome.round < maxIterations`. `error` ⇒ `false` (terminate). `length` ⇒ `false`.
- **Invariants:** `maxIterations >= 1` (Zod); `resolveLoopStrategy` NEVER returns a strategy whose `shouldContinue` can be `true` forever — bounded by `round < maxIterations`.
- **Edge cases:** `maxIterations = 1` for a multi-round strategy ⇒ runs exactly one round then terminates (degenerates to single-shot — acceptable, documented).

#### Pseudo-code / Signatures
```pseudocode
schema loopStrategyConfigSchema = { name: enum, maxIterations: int >= 1 }
type LoopOutcome = { finishReason, round, toolCalls, responseText }
interface LoopStrategy { readonly name; readonly maxIterations; shouldContinue(o: LoopOutcome): boolean }

function resolveLoopStrategy(strategy, maxIterations = 8): LoopStrategy
  cfg = loopStrategyConfigSchema.parse({ name: strategy, maxIterations })   // fail-fast
  if cfg.name == 'simple-chat': return { name, maxIterations, shouldContinue: () => false }
  return { name: cfg.name, maxIterations: cfg.maxIterations,
           shouldContinue: o => o.finishReason === 'tool-calls' && o.round < cfg.maxIterations }

# Example
input:  resolveLoopStrategy('plan-act-reflect', 3).shouldContinue({finishReason:'tool-calls', round:1, ...})
output: true
input:  resolveLoopStrategy('plan-act-reflect', 3).shouldContinue({finishReason:'stop', round:1, ...})
output: false
```

#### Tasks
1. Create `src/loop/loop-strategy.ts` with `LoopOutcome`, `LoopStrategy`, `loopStrategyConfigSchema`, `resolveLoopStrategy`.
2. Add explicit return types on `resolveLoopStrategy` (type-safety.md: explicit return types on public API).
3. Throw (via Zod `.parse`) on `maxIterations < 1`.

#### TDD
```
RED:  test_resolve_simple_chat_never_continues() — resolveLoopStrategy('simple-chat',8).shouldContinue({finishReason:'tool-calls',round:1,...}) === false
RED:  test_mainloop_plan_act_reflect_continues_on_toolcalls_under_ceiling() — resolveLoopStrategy('plan-act-reflect',3).shouldContinue({finishReason:'tool-calls',round:1,...}) === true
RED:  test_resolve_terminates_at_maxiterations_ceiling() — shouldContinue({finishReason:'tool-calls',round:3,...}) === false when maxIterations=3
RED:  test_resolve_terminates_on_stop_and_error() — shouldContinue({finishReason:'stop',...}) === false AND shouldContinue({finishReason:'error',...}) === false
RED:  test_resolve_rejects_zero_maxiterations() — expect(() => resolveLoopStrategy('react',0)).toThrow (Zod)
GREEN: Implement loop-strategy.ts minimally to pass.
REFACTOR: Extract the multi-round shouldContinue into a shared helper if react/plan-act-reflect duplicate (Rule of 3 — only if a 3rd appears; else inline).
VERIFY: pnpm --filter @theokit/agents test -- main-loop-runtime
```

#### Concurrency tests
(none — single-threaded). `resolveLoopStrategy` + `shouldContinue` are pure synchronous functions with no shared mutable state.

#### Acceptance Criteria
- [ ] `resolveLoopStrategy` maps all 3 strategy values; `simple-chat` ⇒ one round.
- [ ] Invalid `maxIterations` (< 1) throws via Zod.
- [ ] Pass: complexity — `shouldContinue` cyclomatic complexity ≤ 10 (manual audit; it is a single boolean expression).
- [ ] Pass: lint — `npx eslint packages/agents/src/loop/loop-strategy.ts --max-warnings=0`.
- [ ] Pass: size — file ≤ 500 lines (per `architecture.md`/G6).

#### DoD (Definition of Done)
- [ ] RED tests written first and failed before implementation.
- [ ] `pnpm --filter @theokit/agents test -- main-loop-runtime` green.
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` zero errors.
- [ ] `npx eslint packages/agents/ --max-warnings=0` clean on changed files.
- [ ] File-size budget respected.

### T1.2 — `ReflectionStrategy` interface + Zod schema + `'ladder'` default

#### Objective
Create `src/loop/reflection-strategy.ts`: the `ReflectionStrategy` interface (`reflect(outcome): { feedback?: string; continue: boolean }`), a Zod config schema, and the `'ladder'` default implementation that `'plan-act-reflect'` resolves to.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does:** Adds `ReflectionStrategy` + `reflectionStrategyConfigSchema` (Zod) + `ladderReflectionStrategy` (the default). `reflect()` inspects the outcome and returns feedback to inject into the next round prompt plus a `continue` hint.

**Why it is necessary now:** Per ADR D1 + the discovery's ReflectionStrategy recommendation, `ReflectionStrategy` composes INTO the loop (the loop calls `reflect()` then `shouldContinue()`); `'plan-act-reflect'` is exactly the strategy that needs reflection feedback between rounds. It must exist before Phase 2 wires it. Per Drawback #2, shipping `'ladder'` as default + allowing a custom strategy satisfies OCP.

#### Evidence
- The discovery's ReflectionStrategy recommendation (mandatory deliverable) — `reflect(outcome): { feedback?; continue }` shape; `'plan-act-reflect'` distinct from `react` only if it adds reflection feedback.
- The discovery's techniques coverage / `agentic-loop/index.ts:199-247` — Mastra `onIterationComplete` returns `{ feedback, continue }` consumed by the loop.
- `packages/agents/src/types.ts:24` — `'plan-act-reflect'` is one of the 3 declared strategies.

#### Files to edit
```
packages/agents/src/loop/reflection-strategy.ts — NEW: ReflectionStrategy, reflectionStrategyConfigSchema (Zod), ladderReflectionStrategy
packages/agents/tests/unit/main-loop-runtime.test.ts — extend: RED tests for ladderReflectionStrategy.reflect()
```

#### Deep file dependency analysis
- `reflection-strategy.ts` (new) imports `z` from `zod` and the `LoopOutcome` type from `./loop-strategy.js` (intra-module).
- No production caller yet (Phase 2 wires it). The shared test file `main-loop-runtime.test.ts` (created in T1.1) is extended.

#### Deep Dives
- **Data structures:** `ReflectionStrategy = { readonly name: string; reflect(outcome: LoopOutcome): { feedback?: string; continue: boolean } }`. `reflectionStrategyConfigSchema = z.object({ name: z.string().min(1) })`.
- **Algorithm (`'ladder'`):** if `outcome.finishReason === 'tool-calls'` ⇒ `{ feedback: "Tool results received (round N). Reflect on whether the goal is met; if not, refine and continue.", continue: true }`; if `'stop'` ⇒ `{ continue: false }`; if `'error'` ⇒ `{ continue: false }`.
- **Invariants:** `reflect()` is pure (no I/O); `continue: false` whenever `finishReason !== 'tool-calls'`.
- **Edge cases:** empty `toolCalls` with `finishReason: 'tool-calls'` ⇒ still `continue: true` (the SDK may have emitted a partial); the `maxIterations` ceiling in `LoopStrategy.shouldContinue` is the hard backstop, not `reflect()`.

#### Pseudo-code / Signatures
```pseudocode
schema reflectionStrategyConfigSchema = { name: string (min 1) }
interface ReflectionStrategy { readonly name; reflect(o: LoopOutcome): { feedback?: string; continue: boolean } }

const ladderReflectionStrategy: ReflectionStrategy = {
  name: 'ladder',
  reflect(o) {
    if (o.finishReason === 'tool-calls')
      return { feedback: `Tool results received (round ${o.round}). Reflect and refine if the goal is not met.`, continue: true }
    return { continue: false }
  }
}

# Example
input:  ladderReflectionStrategy.reflect({ finishReason:'tool-calls', round:1, toolCalls:[...], responseText:'' })
output: { feedback: 'Tool results received (round 1). ...', continue: true }
```

#### Tasks
1. Create `src/loop/reflection-strategy.ts` with the interface, Zod schema, and `ladderReflectionStrategy`.
2. Explicit return type on `reflect` (type-safety.md).

#### TDD
```
RED:  test_ladder_reflects_continue_on_toolcalls() — ladderReflectionStrategy.reflect({finishReason:'tool-calls',round:1,...}).continue === true AND .feedback is a non-empty string
RED:  test_ladder_stops_on_stop() — ladderReflectionStrategy.reflect({finishReason:'stop',...}) === { continue: false }
RED:  test_ladder_stops_on_error() — ladderReflectionStrategy.reflect({finishReason:'error',...}).continue === false
RED:  test_reflection_config_rejects_empty_name() — reflectionStrategyConfigSchema.parse({name:''}) throws
GREEN: Implement reflection-strategy.ts minimally.
REFACTOR: None expected.
VERIFY: pnpm --filter @theokit/agents test -- main-loop-runtime
```

#### Concurrency tests
(none — single-threaded). `reflect()` is a pure synchronous function.

#### Acceptance Criteria
- [ ] `ladderReflectionStrategy.reflect` returns `{ feedback, continue: true }` on `tool-calls`, `{ continue: false }` otherwise.
- [ ] Zod schema rejects empty `name`.
- [ ] Pass: complexity ≤ 10; Pass: lint clean; Pass: size ≤ 500 LoC.

#### DoD (Definition of Done)
- [ ] RED tests first; `pnpm --filter @theokit/agents test -- main-loop-runtime` green.
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` zero errors.
- [ ] `npx eslint packages/agents/ --max-warnings=0` clean on changed files.

### T1.3 — `src/loop/index.ts` barrel + root barrel re-export

#### Objective
Create the `loop/` barrel and re-export the public surface (`AgentRunner`, `LoopStrategy`, `ReflectionStrategy`, `LoopOutcome`, `resolveLoopStrategy`, `ladderReflectionStrategy`) from `src/index.ts`, keeping `runReflectiveLoop` internal (Drawback #4).

#### Why this step (action + reasoning — ReAct discipline)

**What this step does:** Adds `src/loop/index.ts` exporting the contracts (and later, in T3.1, `AgentRunner`); adds one `export * from './loop/index.js'` line to `src/index.ts`.

**Why it is necessary now:** Per `architecture.md` INVARIANT #3 + the Patterns skill barrels pattern, public API only flows through barrels — the loop module needs its own barrel and a root re-export before any consumer imports it. Establishing the barrel now (even partially populated) prevents Phase 2/3 from being tempted into deep imports. The barrel is extended in T3.1 when `AgentRunner` exists.

#### Evidence
- `packages/agents/src/index.ts:1-3` — root barrel re-exports `./decorators/index.js`, `./bridge/index.js` (the pattern to mirror).
- `packages/agents/src/bridge/index.ts` — existing barrel shape to mirror.
- `architecture.md` — barrels only (INVARIANT #3 + the Patterns skill barrels pattern).

#### Files to edit
```
packages/agents/src/loop/index.ts — NEW: barrel exporting LoopStrategy/ReflectionStrategy/LoopOutcome/resolveLoopStrategy/ladderReflectionStrategy
packages/agents/src/index.ts — add: export * from './loop/index.js'
```

#### Deep file dependency analysis
- `src/index.ts` (Baseline Context: 9-line head, barrel) gains one re-export; existing re-exports are untouched (backward-compatible).
- `loop/index.ts` re-exports from `./loop-strategy.js` + `./reflection-strategy.js` (created in T1.1/T1.2). No external dependents yet.

#### Deep Dives
- **Invariant:** `runReflectiveLoop` is NOT re-exported from `src/index.ts` (kept internal per Drawback #4 to bound the public API surface, G6 ≤ 30 exports WARN).

#### Tasks
1. Create `src/loop/index.ts` re-exporting the T1.1/T1.2 symbols.
2. Add `export * from './loop/index.js'` to `src/index.ts`.

#### TDD
```
RED:  test_loop_barrel_exports_contracts() — import { resolveLoopStrategy, ladderReflectionStrategy } from '@theokit/agents' resolves (compile-time + runtime import assert in main-loop-runtime.test.ts)
GREEN: Add the barrels.
REFACTOR: None expected.
VERIFY: pnpm --filter @theokit/agents test -- main-loop-runtime && npx tsc --noEmit -p packages/agents/tsconfig.test.json
```

#### Concurrency tests
(none — single-threaded). Barrel re-exports are static module wiring with no runtime concurrency.

#### Acceptance Criteria
- [ ] `resolveLoopStrategy` + `ladderReflectionStrategy` importable from `@theokit/agents` root barrel.
- [ ] `runReflectiveLoop` NOT exported from root barrel.
- [ ] Pass: lint clean; Pass: size ≤ 500 LoC.

#### DoD (Definition of Done)
- [ ] `pnpm --filter @theokit/agents test` green; `tsc` zero errors; lint clean.

---

## Phase 2: Runtime — multi-round reflective loop in the bridge

**Objective:** Replace the single-shot consume with a multi-round loop that branches on the resolved `LoopStrategy`, wires `'plan-act-reflect'` to the `'ladder'` ReflectionStrategy, honors `maxIterations`, and surfaces typed errors — proving zero `@MainLoop` strategies remain metadata-only.

### T2.1 — `runReflectiveLoop()` driving `createSdkAgentStream` per round

#### Objective
Create `src/loop/run-reflective-loop.ts`: a function that, per round, consumes one `createSdkAgentStream` turn, builds a `LoopOutcome` from the events, calls `reflect()` then `shouldContinue()`, re-enters with the reflection feedback, bounded by `maxIterations` (forced terminal at the ceiling).

#### Why this step (action + reasoning — ReAct discipline)

**What this step does:** Adds `runReflectiveLoop(compiled, tools, apiKey, message, sessionId, loopStrategy, reflectionStrategy)` that loops: per round it iterates `createSdkAgentStream(...)(prompt, sessionId)`, accumulates events into a `LoopOutcome` (deriving `finishReason`), then if `reflectionStrategy.reflect(outcome).continue && loopStrategy.shouldContinue(outcome)`, builds the next prompt from the feedback and re-enters; otherwise returns the accumulated `DelegationResult`.

**Why it is necessary now:** Per ADR D2, this is the new bridge code that closes the metadata-only gap — it is the ONLY task that makes `strategy` drive behavior. It reuses `createSdkAgentStream` (ADR D2: model call stays in SDK). Baseline Context shows `agent-orchestrator.ts:164-167` is the single-shot site this loop generalizes; `runReflectiveLoop` is the multi-round analog of Mastra's `runStreamUntilIdle` (per the discovery's techniques coverage).

#### Evidence
- `packages/agents/src/bridge/agent-orchestrator.ts:164-167` — the single-shot `for await (const event of streamFactory(...))` this generalizes.
- `packages/agents/src/bridge/agent-orchestrator.ts:95-128` — `processStreamEvent` event taxonomy (`text_delta`/`tool_result`/`done`/`error`) reused to build the `LoopOutcome`.
- `packages/agents/src/bridge/sdk-adapter.ts:65-73` — `createSdkAgentStream(compiled, tools, apiKey, model)(message, sessionId)` signature reused per round.
- The discovery's techniques coverage / `agent.ts:7531-7608` — Mastra re-enters the loop via `agent.stream([], …)` — the re-entry model.

#### Files to edit
```
packages/agents/src/loop/run-reflective-loop.ts — NEW: runReflectiveLoop (the multi-round driver) + finishReason derivation helper
packages/agents/tests/unit/main-loop-runtime.test.ts — extend: RED tests for round-count + maxIterations ceiling + typed-error surfacing (mock stream factory)
```

#### Deep file dependency analysis
- `run-reflective-loop.ts` (new) imports `createSdkAgentStream` + `CompiledTool`/`CompiledAgentOptions` from `../bridge/index.js` (barrel — INVARIANT #3), `LoopStrategy`/`LoopOutcome` from `./loop-strategy.js`, `ReflectionStrategy` from `./reflection-strategy.js`, and reuses `DelegationResult`/`DelegationError` from `../bridge/agent-orchestrator.js` (re-exported via `bridge/index.js`).
- Per Baseline Context § Current callers, `createSdkAgentStream` is barrel-exported; calling it per round does not change its signature. `delegate()` is unchanged in this task (T2.2 wires the branch).

#### Deep Dives
- **Algorithm (per round):** `prompt = round === 1 ? message : message + "\n\n[reflection] " + feedback`. Iterate the stream; accumulate `responseText`, `toolCalls`, `cost`, `tokens`. Derive `finishReason`: saw `error` event ⇒ `'error'` (throw `DelegationError`); saw terminal `done` ⇒ `'stop'`; saw ≥1 `tool_result` but stream ended without `done` ⇒ `'tool-calls'`; else `'stop'`. Build `LoopOutcome`. Compute `reflection = reflectionStrategy.reflect(outcome)`. If `reflection.continue && loopStrategy.shouldContinue(outcome) && round < loopStrategy.maxIterations` ⇒ `round++`, set `feedback`, continue. Else return accumulated result.
- **Invariants:** round count NEVER exceeds `loopStrategy.maxIterations` (hard ceiling — forced terminal). On `maxIterations` reached with `finishReason==='tool-calls'`, return the accumulated terminal response (do NOT throw, do NOT hang). On a mid-round `error` event, throw `DelegationError` (fail-fast, typed — Error Handling rule), never swallow.
- **Edge cases:** `simple-chat` (`shouldContinue` always false) ⇒ exactly 1 round (parity with today's single-shot). `maxIterations=1` multi-round ⇒ 1 round. SDK not installed ⇒ the existing `SDK_NOT_INSTALLED` error event ⇒ derived `finishReason: 'error'` ⇒ typed throw.

#### Pseudo-code / Signatures
```pseudocode
async function runReflectiveLoop(compiled, tools, apiKey, message, sessionId, loop: LoopStrategy, reflection: ReflectionStrategy): Promise<DelegationResult>
  acc = { response:'', toolCalls:[], cost:0, tokens:0 }
  round = 1
  feedback = undefined
  loop forever:
    prompt = round === 1 ? message : `${message}\n\n[reflection] ${feedback}`
    outcome = await consumeOneRound(createSdkAgentStream(compiled, tools, apiKey, compiled.model), prompt, sessionId, round, acc)
    if outcome.finishReason === 'error': throw new DelegationError(...)   // fail-fast typed
    r = reflection.reflect(outcome)
    if not (r.continue and loop.shouldContinue(outcome)): return acc       // terminal (incl. maxIterations ceiling via shouldContinue)
    feedback = r.feedback; round++

# Example (mock stream: round1 emits tool_result, no done; round2 emits done)
input:  runReflectiveLoop(..., loop=resolve('plan-act-reflect',3), reflection=ladder)  // mock yields tool_result then (next round) done
output: DelegationResult after exactly 2 rounds
```

#### Tasks
1. Create `run-reflective-loop.ts` with `runReflectiveLoop` + a `consumeOneRound` helper that derives `finishReason` (pure-ish, reuses `processStreamEvent`-style accumulation).
2. Throw `DelegationError` on `finishReason === 'error'`.
3. Enforce the `maxIterations` ceiling via `loopStrategy.shouldContinue` (no separate counter that could drift).

#### TDD
```
RED:  test_mainloop_plan_act_reflect_runs_until_stop() — mock stream: round1 yields tool_result (no done), round2 yields done → runReflectiveLoop runs exactly 2 rounds (assert round count == 2)
RED:  test_mainloop_simple_chat_runs_one_round() — simple-chat strategy → exactly 1 round even if round1 yields tool_result
RED:  test_mainloop_honors_maxiterations_ceiling() — mock stream yields tool_result on EVERY round; maxIterations=2 → loop stops at 2 rounds, returns accumulated terminal response, does NOT hang/throw
RED:  test_mainloop_surfaces_typed_error_midround() — mock stream yields {type:'error'} on round1 → runReflectiveLoop rejects with DelegationError (not hang, not generic Error)
RED:  test_mainloop_injects_reflection_feedback_next_round() — round2 prompt contains the ladder feedback string
GREEN: Implement run-reflective-loop.ts minimally.
REFACTOR: Reuse the accumulator shape from agent-orchestrator's StreamAccumulator if cleanly extractable; else keep local (DRY only on real knowledge duplication).
VERIFY: pnpm --filter @theokit/agents test -- main-loop-runtime
```

#### Concurrency tests
The loop is JS-async single-threaded but is structured concurrency (async iterable + a `maxIterations` bound). Assert the two structural invariants:
```
RED:  test_loop_maxiterations_ceiling_invariant() — with a mock stream that NEVER emits a terminal done (always tool_result), assert the loop terminates at exactly loopStrategy.maxIterations rounds (ceiling invariant — proves no unbounded loop).
RED:  test_loop_propagates_abort_signal() — pass an AbortSignal; abort after round 1; assert the loop stops re-entering and the in-flight round's async iterator is not advanced further (cancellation propagation).
```
Note: model-call concurrency stays inside the SDK (`Run.stream()`); the bridge loop only sequences rounds, so the only concurrency posture to prove is the maxIterations ceiling + cancellation propagation (not a data race).

#### Acceptance Criteria
- [ ] `'plan-act-reflect'` with a two-round mock stream runs exactly 2 rounds.
- [ ] `'simple-chat'` runs exactly 1 round.
- [ ] `maxIterations` ceiling forces a terminal response (no infinite loop) even when every round yields `tool_result`.
- [ ] Mid-round `error` event ⇒ `DelegationError` thrown (typed), not swallowed, not a hang.
- [ ] Reflection feedback is injected into the next-round prompt — verified by `pnpm --filter @theokit/agents test -- main-loop-runtime -t test_mainloop_injects_reflection_feedback_next_round`, which asserts the round-2 prompt string contains the ladder feedback substring (exit code 0).
- [ ] Pass: complexity — `runReflectiveLoop` + helper each cyclomatic complexity ≤ 10 (manual audit; extract `consumeOneRound` to keep the driver flat).
- [ ] Pass: lint clean; Pass: size ≤ 500 LoC.

#### DoD (Definition of Done)
- [ ] RED tests first; `pnpm --filter @theokit/agents test -- main-loop-runtime` green.
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` zero errors.
- [ ] `npx eslint packages/agents/ --max-warnings=0` clean on changed files.
- [ ] No direct LLM `fetch` introduced — `grep -rn "openrouter.ai\|api.openai.com\|api.anthropic.com" packages/agents/src/loop` returns zero (G2/sdk-runtime.md).

### T2.2 — Branch `delegate()` (and the orchestrator entry) on the resolved `LoopStrategy`

#### Objective
Make `delegate()` resolve a `LoopStrategy`/`ReflectionStrategy` from `walk.mainLoop.strategy` + `maxIterations` and route to `runReflectiveLoop` (multi-round) when `strategy !== 'simple-chat'`, preserving the single-shot path + budget clamping for `simple-chat` and full backward compatibility.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does:** In `agent-orchestrator.ts`, after the walk/compile (`:146-150`), resolve `loopStrategy = resolveLoopStrategy(walk.mainLoop.strategy, walk.mainLoop.maxIterations ?? compiled.maxIterations ?? 8)` and `reflectionStrategy = walk.mainLoop.strategy === 'plan-act-reflect' ? ladderReflectionStrategy : noopReflectionStrategy`. Route to `runReflectiveLoop` for multi-round strategies; keep the existing single-shot `for await` for `simple-chat`. Budget clamping (D4) wraps both paths.

**Why it is necessary now:** This is the wiring task — `runReflectiveLoop` (T2.1) is dead code until a caller branches on `strategy`. Per Baseline Context, `delegate()` is the production entry (barrel-exported) and `walk.mainLoop.strategy` is already available (`walk-agent-metadata.ts:204`, `AgentWalkResult.mainLoop`). This is the "caller" pillar of the wiring triad. G10 (Honest Enforcement): after this task, `strategy` is no longer metadata-only.

#### Evidence
- `packages/agents/src/bridge/agent-orchestrator.ts:146` — `const walk = walkAgentMetadata(SubAgentClass, [])` (where `walk.mainLoop.strategy` is available).
- `packages/agents/src/bridge/agent-orchestrator.ts:156` — budget clamp `Math.min(...)` to preserve around both paths.
- `packages/agents/src/bridge/agent-orchestrator.ts:164-167` — the single-shot loop to keep for `simple-chat`.
- `packages/agents/src/bridge/walk-agent-metadata.ts:204,268` — `mainLoop` carried on `AgentWalkResult`.

#### Files to edit
```
packages/agents/src/bridge/agent-orchestrator.ts — branch delegate() on resolveLoopStrategy(walk.mainLoop.strategy, ...); route to runReflectiveLoop for multi-round; keep single-shot for simple-chat; preserve budget clamp
packages/agents/src/loop/reflection-strategy.ts — add: noopReflectionStrategy ({ reflect: () => ({ continue: false }) }) for non-plan-act-reflect strategies
packages/agents/tests/unit/agent-orchestrator.test.ts — extend: RED test that a plan-act-reflect sub-agent triggers multi-round; simple-chat stays single-shot; budget clamp still enforced across rounds
```

#### Deep file dependency analysis
- `agent-orchestrator.ts` (Baseline: 179 LoC, single compile site consumer) gains the strategy resolution + branch. Its public exports (`delegate`, `BudgetExceededError`, `DelegationError`) are unchanged — backward-compatible per Baseline § Current callers (existing tests in `agent-orchestrator.test.ts`, `m8-adapter-wiring.test.ts`, `sdk-real-llm.test.ts` must still pass).
- Imports `resolveLoopStrategy` from `../loop/index.js` (barrel) + `ladderReflectionStrategy`/`noopReflectionStrategy` + `runReflectiveLoop` from `../loop/index.js` — wait: `runReflectiveLoop` is internal (Drawback #4), so it is imported from `../loop/run-reflective-loop.js` directly within the same package's `bridge/` consuming `loop/` — both are intra-package modules; the INVARIANT #3 barrel rule governs cross-MODULE public API, and `loop/index.ts` is the barrel; the internal `run-reflective-loop.js` is imported by `agent-orchestrator.ts` via the `loop/index.js` barrel which DOES export it internally to the package (re-exported in the barrel but NOT bubbled to `src/index.ts`). To keep it clean: `loop/index.ts` exports `runReflectiveLoop`; `src/index.ts` re-exports `loop/index.ts` selectively (named) excluding `runReflectiveLoop`.
- Budget clamping logic (`:156`, `:174-176`) must wrap the multi-round path: accumulate `cost` across rounds and enforce the ceiling after each round (fail-fast, like the existing post-run check).

#### Deep Dives
- **Algorithm:** `simple-chat` ⇒ existing single-shot path (zero behavior change). `react`/`plan-act-reflect` ⇒ `runReflectiveLoop(compiled, allTools, apiKey, message, sessionId, loopStrategy, reflectionStrategy)` with `reflectionStrategy = strategy === 'plan-act-reflect' ? ladderReflectionStrategy : noopReflectionStrategy`.
- **Invariants:** `delegate()` signature unchanged; `BudgetExceededError` still thrown when accumulated cost across rounds exceeds budget (clamp preserved); session isolation (`sub-${randomUUID}`) preserved; `simple-chat` path byte-for-byte behaviorally identical (regression-guard via existing tests).
- **Edge cases:** `react` strategy uses `noopReflectionStrategy` (no feedback injection) but still multi-rounds while `finishReason==='tool-calls'` — this is the V4-D surface; for THIS plan `react` shares `runReflectiveLoop` with a no-op reflection (the distinct `react` refinement is out of scope, deferred to V4-D).

#### Pseudo-code / Signatures
```pseudocode
// inside delegate(), after compile + mergeTools + budget clamp:
loop = resolveLoopStrategy(walk.mainLoop.strategy, walk.mainLoop.maxIterations ?? compiled.maxIterations ?? 8)
if loop.name === 'simple-chat':
   ... existing single-shot for-await (unchanged) ...
else:
   reflection = walk.mainLoop.strategy === 'plan-act-reflect' ? ladderReflectionStrategy : noopReflectionStrategy
   result = await runReflectiveLoop(compiled, allTools, apiKey, message, sessionId, loop, reflection)
   if Number.isFinite(budget) and result.cost > budget: throw new BudgetExceededError(...)
   return result
```

#### Tasks
1. Add `noopReflectionStrategy` to `reflection-strategy.ts`.
2. In `delegate()`, resolve the strategy and branch; reuse existing single-shot path for `simple-chat`.
3. Wrap budget enforcement around the multi-round path (accumulated cost ceiling).
4. Add the `THEO_AGENT_MAINLOOP_RUNTIME_APPLIED` debug log (wiring triad — runtime metric) recording `{ strategy, rounds }`, mirroring `THEO_AGENT_M8_RUNTIME_APPLIED` in `sdk-adapter.ts:121`.

#### TDD
```
RED:  test_delegate_plan_act_reflect_multi_rounds() — a @MainLoop({strategy:'plan-act-reflect'}) sub-agent with a two-round mock stream → delegate() returns after 2 rounds; reflection feedback injected
RED:  test_delegate_simple_chat_still_single_shot() — simple-chat sub-agent → exactly 1 round (regression guard; existing behavior preserved)
RED:  test_delegate_budget_enforced_across_rounds() — multi-round accumulated cost > budget → BudgetExceededError thrown
RED:  test_delegate_emits_mainloop_runtime_metric() — spy on console.debug → THEO_AGENT_MAINLOOP_RUNTIME_APPLIED logged with strategy + rounds
GREEN: Implement the branch in delegate() + noopReflectionStrategy.
REFACTOR: Extract strategy resolution into a small private helper if delegate() exceeds the 50-LoC function budget (G6).
VERIFY: pnpm --filter @theokit/agents test -- agent-orchestrator
```

#### Concurrency tests
The loop runtime this task wires (`runReflectiveLoop`) has a bounded counter + an abort path, so two race-aware invariants are asserted here: the **maxIterations ceiling invariant** (the cross-round budget/round ceiling cannot be exceeded — an atomic-counter ceiling) and **cancellation propagation** (an aborted delegation stops re-entering rounds). Model-call concurrency stays inside the SDK.
```
RED:  test_delegate_budget_clamp_holds_across_rounds() — accumulated cost across N rounds is checked after each round; assert no round can push cost past the clamped budget without BudgetExceededError (the multi-round analog of the single-shot post-run check; bounded-resource invariant / maxIterations ceiling invariant).
RED:  test_delegate_propagates_cancellation_across_rounds() — pass an AbortSignal; abort after round 1; assert delegate() stops re-entering rounds (cancellation propagation), inheriting runReflectiveLoop's posture.
```

#### Acceptance Criteria
- [ ] A `plan-act-reflect` sub-agent runs multi-round; `simple-chat` stays single-shot.
- [ ] Budget clamp enforced across rounds (`BudgetExceededError` on overflow).
- [ ] `THEO_AGENT_MAINLOOP_RUNTIME_APPLIED` metric logged (runtime-metric proof of wiring).
- [ ] All existing `agent-orchestrator.test.ts` / `m8-adapter-wiring.test.ts` tests still pass (backward compat).
- [ ] Pass: complexity — `delegate()` ≤ 10 (extract helper if needed); Pass: lint clean; Pass: size ≤ 500 LoC.

#### DoD (Definition of Done)
- [ ] RED tests first; `pnpm --filter @theokit/agents test` green (full suite, not just the new file).
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` zero errors.
- [ ] `npx eslint packages/agents/ --max-warnings=0` clean on changed files.
- [ ] CHANGELOG `[Unreleased]` updated (Unbreakable Rule 6) once the file exists for the package.

---

## Phase 3: Builder — `AgentRunner.builder()` (imperative twin)

**Objective:** Ship `AgentRunner.builder(AgentClass).reflection(...).stream().build()` as the imperative twin that compiles to the same `{ CompiledAgentOptions, LoopStrategy }` and `run()`s via `runReflectiveLoop` — proving builder + decorator are two on-ramps to one runtime.

### T3.1 — `AgentRunner` + `AgentRunner.builder()` fluent class

#### Objective
Create `src/loop/agent-runner.ts`: a standalone `AgentRunner` class with a static `builder(AgentClass)` returning a fluent builder (`.reflection(strategy?)`, `.stream(enabled?)`, `.build()`), where `build()` walks+compiles the agent, resolves the `LoopStrategy`, and returns a runnable `AgentRunner`; `run(message, opts)` delegates to `runReflectiveLoop`.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does:** Adds `AgentRunner` (holds `compiled`, `loopStrategy`, `reflectionStrategy`, `apiKey`) + `AgentRunnerBuilder` (accumulates config, `build()` = compile boundary). `builder(AgentClass)` walks metadata (`walkAgentMetadata`), `build()` compiles (`compileAgent`) and `resolveLoopStrategy(walk.mainLoop.strategy, …)`; `.reflection(custom)` overrides the default ReflectionStrategy; `.run(message, { apiKey })` calls `runReflectiveLoop`.

**Why it is necessary now:** Per ADR D4 + V4-B scope, the builder is the imperative deliverable. It must come after the loop (Phase 2) exists because `run()` delegates to it. Per the discovery's recommendations, this mirrors Spring's `ChatClient.builder(model)...build()` standalone (no IoC). It is the second on-ramp proving D4. Extends the `loop/index.ts` barrel (T1.3) to export `AgentRunner`.

#### Evidence
- The discovery's recommendations — `AgentRunner.builder(MyAgentClass).reflection(...).compaction(...).stream().build()` proposed shape; `build()` = compile boundary producing the same `CompiledAgent` as `compileAgent()`.
- `packages/agents/src/bridge/agent-orchestrator.ts:146-150` — the walk+compile sequence the builder reuses.
- Spring `DefaultChatClientBuilder.java:114-116` (via blueprint) — `build()` returns `new DefaultChatClient(...)` standalone.
- The Patterns skill "decorator metadata → factory" pattern — the builder is the imperative twin.

#### Files to edit
```
packages/agents/src/loop/agent-runner.ts — NEW: AgentRunner + AgentRunnerBuilder (builder() / reflection() / stream() / build() / run())
packages/agents/src/loop/index.ts — add: export { AgentRunner } (NOT runReflectiveLoop)
packages/agents/tests/unit/agent-runner.test.ts — NEW: RED tests for builder fluent chain + build() compile parity + run() multi-round
```

#### Deep file dependency analysis
- `agent-runner.ts` (new) imports `walkAgentMetadata` + `compileAgent` + `createSdkAgentStream` types from `../bridge/index.js` (barrel), `resolveLoopStrategy`/`LoopStrategy` from `./loop-strategy.js`, `ladderReflectionStrategy`/`noopReflectionStrategy`/`ReflectionStrategy` from `./reflection-strategy.js`, `runReflectiveLoop` from `./run-reflective-loop.js`.
- `loop/index.ts` (T1.3) gains `AgentRunner`; `src/index.ts` already re-exports the barrel (T1.3). Per Baseline § Architecture boundaries, this keeps `@theokit/agents → @theokit/sdk` direction (no sdk→agents).

#### Deep Dives
- **Data structures:** `AgentRunnerBuilder` fields: `AgentClass: Function`, `reflectionStrategy?: ReflectionStrategy`, `streamEnabled: boolean` (default from `@Agent({stream})`). `AgentRunner` fields: `compiled: CompiledAgentOptions`, `loopStrategy: LoopStrategy`, `reflectionStrategy: ReflectionStrategy`.
- **Algorithm (`build()`):** `walk = walkAgentMetadata(AgentClass)`; `compiled = compileAgent(walk, toolboxInstances)`; `loopStrategy = resolveLoopStrategy(walk.mainLoop.strategy, walk.mainLoop.maxIterations ?? compiled.maxIterations ?? 8)`; `reflectionStrategy = this.reflectionStrategy ?? (walk.mainLoop.strategy === 'plan-act-reflect' ? ladderReflectionStrategy : noopReflectionStrategy)`; return `new AgentRunner(...)`.
- **Invariants:** the `{ compiled, loopStrategy }` produced by `build()` is IDENTICAL to what `delegate()` resolves for the same class (ADR D4 — two on-ramps, one runtime); proven by a parity test. `build()` is the compile→execute boundary (no I/O); `run()` does the I/O.
- **Edge cases:** `.reflection()` with no arg ⇒ keep the default; `.reflection(custom)` ⇒ override (OCP, Drawback #2). Builder is reusable? No — `build()` returns a fresh `AgentRunner` (KISS — no clone/mutate needed for V4-B; defer Spring's `mutate()` to YAGNI).

#### Pseudo-code / Signatures
```pseudocode
class AgentRunner {
  static builder(AgentClass): AgentRunnerBuilder
  run(message: string, opts: { apiKey: string; sessionId?: string }): Promise<DelegationResult>
}
class AgentRunnerBuilder {
  reflection(s?: ReflectionStrategy): this
  stream(enabled = true): this
  build(): AgentRunner   // walk + compile + resolveLoopStrategy — the compile boundary
}

# Example
runner = AgentRunner.builder(SupportAgent).reflection().build()
result = await runner.run('help me', { apiKey })   // multi-round if @MainLoop strategy is plan-act-reflect
```

#### Tasks
1. Create `agent-runner.ts` with `AgentRunner` + `AgentRunnerBuilder`.
2. `build()` reuses `walkAgentMetadata` + `compileAgent` + `resolveLoopStrategy` (DRY — no re-deriving compile logic).
3. `run()` delegates to `runReflectiveLoop` (DRY — same loop as `delegate()`).
4. Export `AgentRunner` from `loop/index.ts` (NOT `runReflectiveLoop`).

#### TDD
```
RED:  test_agentrunner_builder_fluent_chain_returns_runner() — AgentRunner.builder(Agent).reflection().stream().build() instanceof AgentRunner
RED:  test_agentrunner_build_parity_with_delegate() — build() produces the same loopStrategy.name + compiled.maxIterations that delegate() resolves for the same class (D4 parity)
RED:  test_agentrunner_run_multi_round_for_plan_act_reflect() — builder for a plan-act-reflect agent + two-round mock stream → run() returns after 2 rounds
RED:  test_agentrunner_reflection_override() — .reflection(customStrategy) → run() uses customStrategy, not ladder
RED:  test_agentrunner_build_validates_maxiterations() — building an agent whose maxIterations resolves to 0 throws (Zod via resolveLoopStrategy)
GREEN: Implement agent-runner.ts minimally.
REFACTOR: None expected (builder is thin).
VERIFY: pnpm --filter @theokit/agents test -- agent-runner
```

#### Concurrency tests
(none — single-threaded). `AgentRunnerBuilder`/`build()` are pure synchronous construction; `run()`'s concurrency posture (maxIterations ceiling + cancellation) is owned and tested by `runReflectiveLoop` (T2.1).

#### Acceptance Criteria
- [ ] `AgentRunner.builder(...).reflection().stream().build()` returns an `AgentRunner`.
- [ ] `build()` produces the same `{ loopStrategy.name, compiled.maxIterations }` as `delegate()` for the same class (D4 parity).
- [ ] `run()` multi-rounds for `plan-act-reflect`; `.reflection(custom)` overrides the default.
- [ ] `AgentRunner` exported from root barrel; `runReflectiveLoop` not exported.
- [ ] Pass: complexity ≤ 10; Pass: lint clean; Pass: size ≤ 500 LoC.

#### DoD (Definition of Done)
- [ ] RED tests first; `pnpm --filter @theokit/agents test` green.
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` zero errors.
- [ ] `npx eslint packages/agents/ --max-warnings=0` clean on changed files.

---

## Phase 4: Integration Validation (MANDATORY)

**Objective:** Validate the full chain green and prove `@MainLoop` strategy actually loops end-to-end via a mock SDK stream — the "eat your own cooking" gate.

### T4.1 — End-to-end reflective-loop wiring integration test + full chain

#### Objective
Create `tests/integration/reflective-loop-wiring.test.ts` exercising a real decorated `@Agent`/`@MainLoop({strategy:'plan-act-reflect'})` class through BOTH on-ramps (`delegate()` and `AgentRunner.builder().build().run()`) against a `createMockAgentStream`-style stream whose round 1 emits a `tool_result` (no terminal) and round 2 emits a terminal `done`, asserting exactly 2 rounds via both paths.

#### Why this step (action + reasoning — ReAct discipline)

**What this step does:** Wires a fixture agent class (decorated) + a stateful mock stream (call-count-switched, mirroring `tool-loop-agent.test.ts:57-139`), then asserts both `delegate()` and `AgentRunner.run()` run 2 rounds and inject reflection feedback. Then runs the full validation chain (test + tsc + lint).

**Why it is necessary now:** Per the cycle contract, the plan is not complete until integration validation passes. This is the integration pillar of the wiring triad (covers the boundary the unit tests mocked) and the runtime-metric proof (asserts `THEO_AGENT_MAINLOOP_RUNTIME_APPLIED` fires with `rounds: 2`). It is the single test that proves "zero `@MainLoop` strategies remain metadata-only" — the Goal metric.

#### Evidence
- The discovery's integration-tests coverage / `tool-loop-agent.test.ts:389-423` — `steps.length === 2` multi-round assertion via `callCount`-switched mock model (the recipe ported).
- `packages/agents/tests/unit/mock-stream.test.ts` + `createMockAgentStream` (permitted per `sdk-runtime.md § "O que é permitido"`) — the mock-stream harness to reuse.
- `packages/agents/tests/integration/m8-adapter-wiring.test.ts` — existing integration-wiring pattern to mirror.

#### Files to edit
```
packages/agents/tests/integration/reflective-loop-wiring.test.ts — NEW: end-to-end loop wiring via mock stream, both on-ramps, runtime-metric assertion
```

#### Deep file dependency analysis
- The test imports `delegate` + `AgentRunner` from `@theokit/agents` (root barrel — proving the public surface), `@Agent`/`@MainLoop`/`@Tool`/`@Toolbox` decorators, and a mock stream helper. It mocks `@theokit/sdk`'s `Agent.create`/`Run.stream` (the only LLM boundary) via the existing mock-stream approach — no real LLM (testing.md + sdk-runtime.md).
- Per Baseline § Current callers, exercising both `delegate` and `AgentRunner` through the barrel verifies INVARIANT #3 (public API via barrels) and ADR D4 (both on-ramps).

#### Deep Dives
- **Algorithm:** stateful mock: `callCount === 1` ⇒ yield `{type:'tool_result',...}` then end (no `done`) ⇒ derived `finishReason: 'tool-calls'`; `callCount >= 2` ⇒ yield `{type:'done',...}` ⇒ `'stop'`. Assert: both on-ramps run exactly 2 rounds; round-2 prompt contains the ladder feedback; `THEO_AGENT_MAINLOOP_RUNTIME_APPLIED` logged with `rounds: 2`.
- **Invariants:** deterministic (no real network); both on-ramps observe identical round count (D4 parity at runtime).
- **Edge cases:** a `simple-chat` fixture agent through the same mock runs exactly 1 round (regression guard inside the integration file).

#### Tasks
1. Create the fixture decorated agent + stateful mock stream.
2. Assert 2 rounds via `delegate()` and via `AgentRunner.builder().build().run()`.
3. Assert reflection feedback injection + the runtime metric.
4. Add a `simple-chat` regression assertion (1 round).

#### TDD
```
RED:  test_plan_act_reflect_loops_twice_via_delegate() — delegate(PlanActReflectAgent, msg, {apiKey, mockStream}) → 2 rounds
RED:  test_plan_act_reflect_loops_twice_via_agentrunner() — AgentRunner.builder(PlanActReflectAgent).build().run(msg,{apiKey}) → 2 rounds
RED:  test_reflective_loop_emits_runtime_metric_rounds_2() — THEO_AGENT_MAINLOOP_RUNTIME_APPLIED logged with rounds === 2
RED:  test_simple_chat_single_round_regression() — simple-chat fixture → 1 round through both on-ramps
GREEN: (Phases 1-3 already implement; this test proves the wiring end-to-end.)
REFACTOR: None expected.
VERIFY: pnpm --filter @theokit/agents test -- reflective-loop-wiring
```

#### Concurrency tests
End-to-end, the wired loop is proven against the **maxIterations ceiling invariant** (no unbounded rounds) and **cancellation propagation** (an aborted run stops re-entering) — the same race-aware posture `runReflectiveLoop` owns, observed through both public on-ramps.
```
RED:  test_reflective_loop_no_unbounded_rounds_integration() — a mock stream that NEVER emits done + maxIterations=4 → both on-ramps terminate at exactly 4 rounds (end-to-end ceiling invariant — proves no hang in the wired path).
RED:  test_reflective_loop_cancellation_integration() — abort the run after round 1 via AbortSignal → both on-ramps stop re-entering (cancellation propagation end-to-end).
```

#### Acceptance Criteria
- [ ] Both on-ramps run exactly 2 rounds against the two-round mock — `pnpm --filter @theokit/agents test -- reflective-loop-wiring` asserts `rounds === 2` for both `delegate()` and `AgentRunner.run()` (exit code 0).
- [ ] Reflection feedback injected on round 2 — the integration test asserts the round-2 prompt `contains` the ladder feedback string (`expect(round2Prompt).toContain(feedback)`).
- [ ] `THEO_AGENT_MAINLOOP_RUNTIME_APPLIED` runtime metric observed with `rounds: 2` (runtime-metric proof — Global DoD).
- [ ] `simple-chat` stays single-shot (regression) — same suite asserts `rounds === 1` for the simple-chat fixture.
- [ ] maxIterations ceiling proven end-to-end (no hang) — `test_reflective_loop_no_unbounded_rounds_integration` asserts both on-ramps terminate at exactly `4` rounds when `maxIterations=4` and the mock never emits `done` (exit code 0, no timeout).
- [ ] Pass: lint clean; Pass: size ≤ 500 LoC.

#### DoD (Definition of Done)
- [ ] `pnpm --filter @theokit/agents test` green (full suite).
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` zero errors.
- [ ] `npx eslint packages/agents/ --max-warnings=0` clean.

### Execution (full validation chain)

```
pnpm --filter @theokit/agents test                          # unit + integration + smoke
npx tsc --noEmit -p packages/agents/tsconfig.test.json      # zero type errors
npx eslint packages/agents/ --max-warnings=0                # zero lint warnings
grep -rn "openrouter.ai\|api.openai.com\|api.anthropic.com" packages/agents/src --include="*.ts"   # MUST be zero (G2)
```

### Acceptance Criteria
- [ ] All test suites green (unit + integration; smoke unaffected) — `pnpm --filter @theokit/agents test` exits `0` with `0` failing tests.
- [ ] Zero type errors; zero lint warnings — `npx tsc --noEmit -p packages/agents/tsconfig.test.json` reports `0` errors AND `npx eslint packages/agents/ --max-warnings=0` exits `0`.
- [ ] Runtime-metric proof — `THEO_AGENT_MAINLOOP_RUNTIME_APPLIED` observed non-zero (`rounds >= 2`) in the integration test.
- [ ] Failure scenarios green — every row of `## Failure scenarios` exercised in `main-loop-runtime.test.ts` / `reflective-loop-wiring.test.ts`.
- [ ] G2 grep returns zero (no direct LLM call introduced).

### If Validation Fails
1. Identify plan-caused failures vs pre-existing.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Pre-existing issues logged in the PR description, do not block.

---

## Coverage Matrix

| # | Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `LoopStrategy` contract (terminal predicate + maxIterations) modeled on Mastra stopWhen (D1) | T1.1 | `loop-strategy.ts` with `shouldContinue` + `maxIterations`, Zod-validated |
| 2 | `ReflectionStrategy` contract + `'ladder'` default for plan-act-reflect (V4-C) | T1.2 | `reflection-strategy.ts` with `reflect()` + `ladderReflectionStrategy` |
| 3 | Strategy resolver mapping all 3 `@MainLoop` strategy values | T1.1 | `resolveLoopStrategy(strategy, maxIterations)` |
| 4 | Zod SSoT for strategy config (D3) | T1.1, T1.2 | `loopStrategyConfigSchema` + `reflectionStrategyConfigSchema` |
| 5 | Public API via barrels (INVARIANT #3) | T1.3, T3.1 | `loop/index.ts` + root re-export; `runReflectiveLoop` internal |
| 6 | Multi-round reflective loop in the bridge (D2; V4-C) | T2.1 | `runReflectiveLoop` driving `createSdkAgentStream` per round |
| 7 | `maxIterations` honored — forced terminal, no infinite loop | T2.1 | ceiling via `shouldContinue`; ceiling invariant test |
| 8 | Typed error surfacing on mid-round model error (Failure scenario) | T2.1 | `DelegationError` thrown on `finishReason==='error'` |
| 9 | `@MainLoop` strategy drives runtime — zero metadata-only (Goal; G10) | T2.2 | `delegate()` branches on `resolveLoopStrategy(walk.mainLoop.strategy)` |
| 10 | Budget clamping preserved across rounds (backward compat, D4) | T2.2 | accumulated-cost ceiling around the multi-round path |
| 11 | Runtime-metric proof (wiring triad) | T2.2, T4.1 | `THEO_AGENT_MAINLOOP_RUNTIME_APPLIED` log + integration assertion |
| 12 | `AgentRunner.builder()` imperative twin (V4-B; D4) | T3.1 | `agent-runner.ts` builder→`build()`→`run()` |
| 13 | Builder + decorator = one runtime (D4 parity) | T3.1, T4.1 | parity test + both on-ramps in integration test |
| 14 | End-to-end loop wiring proof (integration; Goal metric) | T4.1 | `reflective-loop-wiring.test.ts` 2-round assertion both on-ramps |
| 15 | SDK is sole runtime — no direct LLM fetch (G2/ADR 0031) | T2.1, T4.1 | model call stays in `createSdkAgentStream`; G2 grep gate |

**Coverage: 15/15 requirements covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/agents test` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/ --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6: each new file ≤ 500 LoC)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6) once the file exists in the package
- [ ] Backward compatibility preserved across public API (`delegate()`, `createSdkAgentStream`, `MainLoopMeta` unchanged)
- [ ] Dependency direction respected: `@theokit/agents → @theokit/sdk` only; no `sdk → agents` (G1)
- [ ] No direct LLM `fetch` — G2 grep returns zero in `packages/agents/src`
- [ ] **Runtime-metric proof** — `THEO_AGENT_MAINLOOP_RUNTIME_APPLIED` observed with `rounds >= 2` in `reflective-loop-wiring.test.ts`, not just compiled
- [ ] Zero `@MainLoop` strategies remain metadata-only — proven by the integration test (the Goal metric)
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR is merged, move this plan to `knowledge-base/plans/completed/`

## Failure scenarios (when I/O external)

The loop calls the model via `Run.stream()` (external LLM I/O, through the SDK). Failure modes:

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `@theokit/sdk` `Run.stream()` (LLM) | Model error / exception mid-round | mock stream yields `{ type: 'error', code, message }` on round 1 (`test_mainloop_surfaces_typed_error_midround`) | `runReflectiveLoop` derives `finishReason: 'error'` and throws `DelegationError` (typed, fail-fast) — does NOT hang, does NOT swallow, does NOT re-enter the loop |
| `@theokit/sdk` `Run.stream()` (LLM) | Model never converges — every round returns `tool-calls`, no terminal | mock stream yields `tool_result` (no `done`) on EVERY round; `maxIterations=2` (`test_mainloop_honors_maxiterations_ceiling` + `test_loop_maxiterations_ceiling_invariant`) | loop stops at exactly `maxIterations` rounds and returns the accumulated terminal response (forced terminal) — no infinite loop |
| `@theokit/sdk` (peer dep) | SDK not installed | `createSdkAgentStream` yields the existing `SDK_NOT_INSTALLED` error event | derived `finishReason: 'error'` ⇒ `DelegationError` thrown with a clear message (reuses `sdk-adapter.ts:96-104` path) |
| `@theokit/sdk` `Run.stream()` (LLM) | Caller cancels mid-loop | pass an `AbortSignal`, abort after round 1 (`test_loop_propagates_abort_signal`) | loop stops re-entering; in-flight round's iterator not advanced further (cancellation propagation) |
