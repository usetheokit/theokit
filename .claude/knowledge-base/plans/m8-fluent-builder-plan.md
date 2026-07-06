---
slug: m8-fluent-builder
milestone_id: M8
created_at: 2026-07-06
goal: A composable `agent()` builder with accumulative type-state that resolves to the same branded AgentDefinition.
---

# M8 — Fluent agent builder with type-state

## Goal

`agent().context<C>().tool(t).model(id).system(s).build()` — a fluent builder that accumulates
**type-state** (tRPC/Zod/Hono technique) and resolves to the **SAME branded `AgentDefinition`**
that `defineAgent` produces (ADR-B1, one runtime N syntaxes). Compile-time guarantees:
- `.build()` is a compile error when `model` is unset (UnsetMarker technique).
- `.tool(t)` is a compile error when the tool declares a required context ⊄ the agent's `C`.
- tool names accumulate into a union type parameter on the builder.

## Baseline Context

| File | Role | LoC |
|---|---|---|
| `packages/agents/src/bridge/define-agent.ts` | `defineAgent` → branded `AgentDefinition`; `DefineAgentConfig` (input/model/system/reasoningEffort/tools/context — context added in M7) | ~110 |
| `packages/agents/src/bridge/agent-compiler.ts` | `compileAgentDefinition(def)` consumes `AgentDefinition` → `CompiledAgentOptions` | — |
| `packages/theo/src/server/define/define-agent-tool.ts` | `defineAgentTool` → `CustomTool` (M7 forwards ctx) | ~130 |
| `packages/agents/src/index.ts` + `bridge/index.ts` | public barrels | — |

**Convergence is by construction:** `.build()` calls `defineAgent(accumulatedConfig)` → the exact
branded value the scanner/manifest/runtime already consume. No third runtime, no new mount path.

Research grounding: `.claude/knowledge-base/references/trpc/packages/server/src/unstable-core-do-not-import/procedureBuilder.ts` (UnsetMarker `utils.ts:2-4`, IntersectIfDefined `:37-41`, terminal constraint `:362-379`).

## Tasks

### T1 — Builder types + implementation (`bridge/agent-builder.ts`)
- `UnsetMarker` branded type; `AgentBuilder<TInput, TModel, TContext, TTools>` interface.
- `.model(id)` sets `TModel`; `.system(s)`; `.input(schema)` sets `TInput`; `.context<C>(c)` sets `TContext`; `.use(preset)` merges a partial chain; `.tool(t)` accumulates `TTools | name` AND enforces `TContext extends t.requiredContext`.
- `.build()`: signature only valid when `TModel extends UnsetMarker ? never`. Returns `AgentDefinition<TInput>` via `defineAgent`.
- Runtime is a thin immutable accumulator over a plain config object.
- **TDD:** RED type test that `.build()` without `.model()` errors.

### T2 — Type tests (`tests/type/agent-builder.test-d.ts`)
- `expectTypeOf` + `@ts-expect-error`: build-without-model error, double-model error, tool-context-mismatch error, tool-name-union accumulation, input inference through `.build()`.

### T3 — Runtime + convergence tests (`tests/integration/agent-builder-runtime.test.ts`)
- Convergence: `agent().model(m).system(s).tools([t]).build()` deep-equals `defineAgent({ model, system, tools })` (both branded, both compile via `compileAgentDefinition`).
- Runtime: builder-built agent runs through `createSdkAgentStream` (reuse M7 mock) and `context` reaches the tool handler.

### T4 — Barrel export + example
- Export `agent` (and types) from `bridge/index.ts` + package barrel.
- Present `examples/code-assistant` in builder form (canonical example).

### T5 — Gate
- `tsc` 0 (tsconfig.test.json), full `@theokit/agents` suite green (0 regression), type tests pass, lint 0, CHANGELOG updated.

## Coverage Matrix

| Goal claim | Task |
|---|---|
| Fluent builder with type-state methods | T1 |
| `.build()` requires model (compile error) | T1, T2 |
| `.tool()` context-satisfaction compile error | T1, T2 |
| tool-name union accumulates | T1, T2 |
| resolves to same branded AgentDefinition (convergence) | T1, T3 |
| example in builder form | T4 |
| gate green | T5 |

## Drawbacks & Risks

1. **Type-gymnastics maintenance** (roadmap risk 1) — mitigated by minimal scope: 6 methods, one UnsetMarker, one accumulation operator. NOT a 40-method DSL.
2. **Three construction surfaces** (roadmap risk 2) — mitigated by the convergence test (T3) proving builder ≡ defineAgent; docs pick one canonical path.
3. **Merge gate:** M8 rides with M7 (depends on it); both merge only after `@theokit/sdk` publishes the run-context seam. M8's own code is verifiable locally against the M7 working-tree state.

## Unresolved Questions

- Client codegen of the tool-name union into `.theokit/agents.d.ts` (DoD item 3 "reaches the generated typed client" end-to-end) touches the vite/manifest codegen subsystem — larger surface. Scoped as a follow-up slice if it exceeds the builder-type-level union; the builder-level union + manifest tool-name list is the in-session deliverable.

## Prior Art

tRPC `procedureBuilder.ts` (UnsetMarker + IntersectIfDefined + terminal constraint), Zod `ZodObject.extend` shape accumulation, Hono `ToSchema` route accumulation. Full citations in the discover report.
