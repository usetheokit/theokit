---
slug: v4q-runner-sdk-tools
milestone_id: V4-Q
created_at: 2026-06-26
goal: Let AgentRunner accept pre-built SDK CustomTool[] so an app with imperative tools can adopt the loop.
---

# Plan: V4-Q — `AgentRunner` accepts pre-built SDK `CustomTool[]` (`sdkTools`)

> **Version 1.0** — `AgentRunner` sources tools ONLY from `@Tool`-compiled `CompiledTool[]` (whose `inputSchema` is a Zod schema the adapter re-runs through `defineTool`). An app whose tools come from imperative SDK factories (`@theokit/sdk-tools` → `CustomTool[]`, with a JSON-Schema `inputSchema` and no recoverable Zod) CANNOT supply them via `run-options.tools` — `defineTool<T extends ZodType>` rejects a JSON Schema. This blocks theocode's loop adoption (its `codeTools`/`memoryTools`/`webTools` are `CustomTool[]`). V4-Q adds `sdkTools?: readonly CustomTool[]` to the per-run options: the adapter forwards them RAW to `Agent.create.tools` (which natively accepts `CustomTool[]`), appended after the compiled tools, bypassing `defineTool`. Additive + backward-compatible (absent ⇒ unchanged); no new dependency.

## Goal

> "Enable `AgentRunner.stream()` to forward pre-built SDK `CustomTool[]` to `Agent.create.tools` so an app with imperative tools adopts the loop, measured by `npx vitest run packages/agents/tests/integration/runner-sdk-tools.test.ts` passing (the agent is created with the provided sdkTools)."

## Context

theocode's loop-adoption discover proved every loop capability is covered (V4-M/N/N.1/O/P) but the tool-sourcing path is not: theocode builds tools via `@theokit/sdk-tools` factories returning SDK `CustomTool[]`. The framework's `createSdkAgentStream` does `compiledTools.map((t) => defineTool({ inputSchema: t.inputSchema, ... }))`, and `defineTool<T extends ZodType>` requires a Zod schema. A `CustomTool` (post-`defineTool`) carries a JSON-Schema `inputSchema`, so re-feeding it breaks. `Agent.create({ tools })` natively accepts `CustomTool[]`, so the fix is to forward pre-built tools straight through.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/bridge/sdk-adapter.ts` | ~300 | `030f8c1` (2026-06-26) | builds `sdkTools` from `compiledTools` + creates the SDK agent | compiled-tools path unchanged; SDK is the only runtime (G2) |
| `packages/agents/src/loop/agent-runner.ts` | ~270 | `030f8c1` | `AgentRunner.stream`/`run` + `AgentRunnerRunOptions` | same signatures; additive option |
| `packages/agents/tests/integration/runner-sdk-tools.test.ts` (NEW) | 0 | — | (file to be created) | — |

### Current callers / dependents

- **`createSdkAgentStream`** (`sdk-adapter.ts:165`) — builds `sdkTools = compiledTools.map(defineTool)` (`:219`) then `Agent.getOrCreate({ tools: sdkTools })` (`:250-253`). V4-Q appends `overrides.sdkTools` raw.
- **`AgentRunner.stream`** (`agent-runner.ts`) — passes the `RuntimeOverrides` to `createSdkAgentStream`; V4-Q threads `opts.sdkTools`.
- **SDK:** `Agent.create/getOrCreate({ tools: CustomTool[] })` natively accepts `CustomTool[]`; `CustomTool` is exported from `@theokit/sdk`.

### Domain glossary

- **`sdkTools`** — pre-built SDK `CustomTool[]` supplied by the app; forwarded to `Agent.create.tools` WITHOUT `defineTool` (they are already defined).
- **compiled tools** — `@Tool`-compiled `CompiledTool[]` (Zod `inputSchema`) the adapter runs through `defineTool` (unchanged path).

### Architecture boundaries affected

- None new. `CustomTool` is an SDK type already used across the adapter. SDK stays the only runtime (G2); no dependency change (G1). The per-run surface grows by one optional field (V4-L precedent).

## Prior Art & Related Work

- **In-repo precedent** — V4-J added `run-options.tools` (CompiledTool override); V4-L.3 added plugins/providers/agents/budgetTracker. V4-Q adds `sdkTools` the same additive way.
- **SDK contract** — `Agent.create({ tools: CustomTool[] })` + `defineTool<T extends ZodType>` (so a pre-built `CustomTool` must bypass `defineTool`).
- **Consumer** — theocode `toolsForMode` returns `CustomTool[]` from `@theokit/sdk-tools` factories.

## Objective

- [ ] `AgentRunnerRunOptions` + `RuntimeOverrides` gain `sdkTools?: readonly CustomTool[]`.
- [ ] `createSdkAgentStream` appends `overrides.sdkTools` (raw) to the `sdkTools` array passed to `Agent.getOrCreate.tools`, after the compiled tools.
- [ ] `AgentRunner.stream` threads `opts.sdkTools` into the adapter overrides.
- [ ] Backward compatibility: absent ⇒ identical behavior (compiled-tools-only).
- [ ] A test proves the agent is created with the provided `sdkTools`.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | `>=2.9.0` (installed) | npm | `CustomTool` type + `Agent.create({ tools })` natively accepts `CustomTool[]`. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | | | | No dependency added — forwards an existing SDK type. |

### Removed

| Package | Last version | Why removed |
|---|---|---|

## ADRs

### D1 — Forward pre-built `CustomTool[]` raw via a distinct `sdkTools` option

- **Decision:** add `sdkTools?: readonly CustomTool[]`; the adapter builds `[...compiledTools.map(defineTool), ...(overrides.sdkTools ?? [])]` for `Agent.create.tools`.
- **Rationale:** `defineTool` requires Zod; a pre-built `CustomTool` cannot round-trip through it. A distinct `sdkTools` field forwards them straight to the SDK (which accepts `CustomTool[]`), keeping the compiled path intact.
- **Alternatives considered:** (a) Make `run-options.tools` accept `CompiledTool | CustomTool` and branch on shape — REJECTED: shape-sniffing is fragile; an explicit field is honest. (b) Have the app rebuild Zod specs — REJECTED: external `@theokit/sdk-tools` factories return `CustomTool[]` with no recoverable Zod schema.
- **Consequences:** apps with imperative tools adopt the loop; the compiled-tools path is byte-identical when `sdkTools` is absent.

### D2 — `sdkTools` is opt-in per run (Axis-A SWAP)

- **Decision:** `AgentRunnerRunOptions.sdkTools?` threads into `RuntimeOverrides.sdkTools`; absent ⇒ no append.
- **Rationale:** per-request tool sourcing (a consumer selects tools by mode); additive optional field (V4-L precedent).
- **Alternatives considered:** (a) A builder `.sdkTools()` — REJECTED: tools are per-run (mode/cwd-derived), not build-time; run-options is the right axis.
- **Consequences:** the decorator path is unaffected; `sdkTools` composes with the compiled tools.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Name collision between a compiled tool and an sdkTool | Low | Same risk as any tool set; the SDK validates tool-name uniqueness at create | maintainer |
| `sdkTools` typed `CustomTool` couples the option to the SDK type | Low | The whole adapter already depends on the SDK runtime (G2); `CustomTool` is the SDK's public tool type | maintainer |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (adapter append + AgentRunnerRunOptions.sdkTools + thread) ──▶ Phase 2 (TDD proof: agent created with sdkTools; absent ⇒ compiled-only)
                                                                          │
                                                                          ▼
                                                                 Final Phase: Integration Validation
```

## Phase 1: Forward sdkTools

**Objective:** the adapter appends `overrides.sdkTools`; `AgentRunner` threads `opts.sdkTools`.

### T1.1 — Adapter append + run-option wiring

#### Objective
`RuntimeOverrides.sdkTools` + append in `createSdkAgentStream`; `AgentRunnerRunOptions.sdkTools` + thread in `AgentRunner.stream`.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — adds the optional `sdkTools` field to both option types; concatenates `overrides.sdkTools` (raw) after the compiled tools in the array handed to `Agent.getOrCreate.tools`; threads `opts.sdkTools` from `AgentRunner.stream` into the adapter overrides.
2. **Why it is necessary now** — it is the fix (ADR D1); without it an app with imperative SDK tools cannot adopt `AgentRunner.stream()`.

#### Evidence
`sdk-adapter.ts:219-226` (`sdkTools = compiledTools.map(defineTool)`) + `:250-253` (`Agent.getOrCreate({ tools: sdkTools })`); `agent-runner.ts` `RuntimeOverrides` forwarding; SDK `CustomTool` + `Agent.create({ tools })`.

#### Files to edit
```
packages/agents/src/bridge/sdk-adapter.ts — RuntimeOverrides.sdkTools; append raw to sdkTools
packages/agents/src/loop/agent-runner.ts — AgentRunnerRunOptions.sdkTools; thread into createSdkAgentStream overrides
```

#### Deep file dependency analysis
- `sdk-adapter.ts` — `import type { CustomTool } from '@theokit/sdk'`; `RuntimeOverrides.sdkTools?: readonly CustomTool[]`; `const sdkTools = [...compiledTools.map(defineTool), ...(overrides.sdkTools ?? [])]`.
- `agent-runner.ts` — `AgentRunnerRunOptions.sdkTools?: readonly CustomTool[]`; pass `sdkTools: opts.sdkTools` into the `createSdkAgentStream` overrides object.

#### Deep Dives
- **Invariant:** compiled-tools path unchanged; `sdkTools` are appended, never replace.
- **Edge case:** `sdkTools` absent → `...[]` → identical array as today.
- **Type:** `CustomTool` is the SDK's public tool type (`defineTool`'s return); forwarded raw, never re-`defineTool`'d.

#### Pseudo-code / Signatures
```ts
// RuntimeOverrides + AgentRunnerRunOptions: sdkTools?: readonly CustomTool[]
const sdkTools = [
  ...compiledTools.map((t) => defineTool({ name: t.name, description: t.description, inputSchema: t.inputSchema, handler: t.handler })),
  ...(overrides.sdkTools ?? []),
]
```

#### Tasks
1. Add `sdkTools` to `RuntimeOverrides` (+ `CustomTool` import) and append in the array.
2. Add `sdkTools` to `AgentRunnerRunOptions` and thread it.
3. Run typecheck + lint.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Types compile: `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Pass: complexity — `npx eslint packages/agents/src/bridge/sdk-adapter.ts --max-warnings=0`
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/runner-sdk-tools.test.ts` ≥ 90% on changed files
- [ ] Pass: lint — `npx eslint packages/agents/src --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/src/bridge/sdk-adapter.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

## Phase 2: TDD proof

**Objective:** prove the agent is created with the forwarded `sdkTools`, and absent ⇒ compiled-only.

### T2.1 — sdkTools forwarding test

#### Objective
A test drives `createSdkAgentStream` (or `AgentRunner.run`) with `sdkTools: [fakeTool]` and a mock `Agent.getOrCreate` that captures its `tools`; asserts the fake tool is present; a second case asserts absent `sdkTools` yields compiled-only.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — a hoisted mock captures `Agent.getOrCreate({ tools })`; the test passes `sdkTools: [{ name:'x', ... }]` and asserts `captured.tools` contains it (and no `defineTool` was run on it — identity preserved).
2. **Why it is necessary now** — forwarding is the Goal's metric; without the test it is unproven.

#### Evidence
The V4-N.1/V4-O adapter mock tests (hoisted `Agent.getOrCreate` capture) are the template.

#### Files to edit
```
packages/agents/tests/integration/runner-sdk-tools.test.ts (NEW) — sdkTools forwarded + absent ⇒ compiled-only
```

#### Deep file dependency analysis
- New test mocks `@theokit/sdk` (`Agent.getOrCreate` captures opts; `defineTool` identity; `InMemoryConversationStorage` stub) and asserts `captured.tools` includes the provided sdkTool object by reference.

#### Deep Dives
- **Assertion:** `captured.tools.some((t) => t === fakeTool)` (forwarded by reference, not re-defined).
- **Absent case:** no `sdkTools` → `captured.tools.length === compiledCount`.

#### Pseudo-code / Signatures
```ts
const fakeTool = { name: 'x', description: 'd', inputSchema: {}, handler: () => 'ok' }
await AgentRunner.builder(A).build().run('hi', { apiKey: 'k', sdkTools: [fakeTool] })
expect(h.captured.tools).toContain(fakeTool)
```

#### Tasks
1. Create `runner-sdk-tools.test.ts` with the forward + absent cases.
2. Run the suite.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Forwarding proven: `npx vitest run packages/agents/tests/integration/runner-sdk-tools.test.ts`
- [ ] Full suite green: `npx vitest run packages/agents`
- [ ] Pass: complexity — `npx eslint packages/agents/tests/integration/runner-sdk-tools.test.ts --max-warnings=0`
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/runner-sdk-tools.test.ts` exercises the append branch
- [ ] Pass: lint — `npx eslint packages/agents/tests --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/tests/integration/runner-sdk-tools.test.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| G1 | imperative SDK CustomTool[] cannot reach AgentRunner | T1.1, T2.1 | `sdkTools` forwarded raw to `Agent.create.tools` (ADR D1) |
| G2 | must not break the compiled-tools path | T1.1, T2.1 | appended after compiled tools; absent ⇒ unchanged |
| G3 | per-run opt-in | T1.1 | `AgentRunnerRunOptions.sdkTools` threaded (ADR D2) |
| G4 | proof the agent receives sdkTools | T2.1 | mock capture asserts `tools` contains the forwarded tool |
| G5 | backward compat | T1.1, T2.1 | additive optional field; full suite green |

**Coverage: 5/5 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `rules/architecture.md` / G6)
- [ ] CHANGELOG.md updated — add a changeset (minor bump `@theokit/agents`)
- [ ] Backward compatibility preserved (additive optional field; compiled path unchanged)
- [ ] Plan-specific: `npx vitest run packages/agents/tests/integration/runner-sdk-tools.test.ts` passes (the Goal metric)
- [ ] **Runtime-metric proof** — n/a (no new counter)
- [ ] **Plan archived** — after `/review` READY_TO_MERGE AND PR merged

## Failure scenarios (when I/O external)

```
(none — no external I/O touched)
```

The SDK owns the agent/model call (mocked in tests); V4-Q only forwards an array of already-built tools.

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
