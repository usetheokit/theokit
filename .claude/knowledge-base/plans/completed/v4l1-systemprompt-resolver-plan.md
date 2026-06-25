---
slug: v4l1-systemprompt-resolver
milestone_id: V4-L
created_at: 2026-06-25
goal: Widen @Agent's systemPrompt to accept a per-request SystemPromptResolver across the declaration→compile→adapter path.
---

# Plan: V4-L.1 — `@Agent` systemPrompt accepts a per-request resolver

> **Version 1.1** (absorbed `/edge-case-plan` test items EC-1/2/3 into T2.1's TDD; EC-4 recorded via ADR D3) — Widen `@Agent`'s `systemPrompt` from `string` to `string | SystemPromptResolver` across the declaration (`AgentOptions`), the compile boundary (`CompiledAgentOptions` / `CompiledSubAgent`), and the `@ProjectContext` composition seam, so an app can supply a prompt COMPUTED per request (rules + memory + cwd) instead of a static string. Axis-B (COMPUTE) of the two-axis dynamic-config design; closes review item EC-4. The SDK already exports `SystemPromptResolver` and `Agent.create` already accepts the union, so the change is a type-widening plus one composition fix — no new dependency, no runtime-engine change (the SDK still executes the resolver per `sdk-runtime.md`).

## Goal

> "Enable `@theokit/agents` authors to declare `@Agent({ systemPrompt: (ctx) => ... })` so that a prompt computed per request flows unchanged from the decorator to `Agent.create`, measured by `npx vitest run packages/agents/tests/integration/systemprompt-resolver-stream.test.ts` passing (the resolver reference reaches the SDK `Agent.create` call)."

## Context

The reflective loop + `AgentRunner` (V4-B…V4-K, released `@theokit/agents@0.9.0`) gave theocode a declarative on-ramp, but theocode's `runCodeAgent` (`agent-stream.ts:297-365`) still assembles its `systemPrompt` PER REQUEST from project rules + memory + skills. `@Agent({ systemPrompt })` is typed `string` (`packages/agents/src/types.ts:18`), so that per-request assembly cannot be expressed declaratively — it is one of the 5 framework gaps blocking theocode's loop adoption. The prior-art research (`knowledge-base/discoveries/blueprints/agent-dynamic-config-blueprint.md`) showed every mature framework serves this "computed-per-request" need with a resolver callable on the declaration (Pydantic AI `@system_prompt`, OpenAI Agents callable `instructions`, FastAPI `Depends`). The seam already exists one layer down — the SDK exports `SystemPromptResolver` and `Agent.create` accepts `string | SystemPromptResolver` — the framework simply does not surface it to the `@Agent` author. The M8 edge-case review flagged this exactly: `knowledge-base/reviews/m8-decorator-runtime-edge-cases-2026-06-22.md` EC-4 ("if a future change lets `@Agent` accept a resolver, revisit"). The present plan is that change, scoped as the smallest of the three V4-L slices.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/types.ts` | 72 | `efe63ed` (2026-06-11) | Decorator option interfaces (`AgentOptions` etc.) | `AgentOptions.systemPrompt` MUST keep accepting a plain `string` (backward compat); no new runtime dependency (type-only import) |
| `packages/agents/src/bridge/agent-compiler.ts` | 139 | `04d8b40` (2026-06-22) | Compiles decorator metadata → `CompiledAgentOptions` for the SDK | `compileAgent` MUST keep carrying a `string` systemPrompt unchanged; `tools: []` for toolbox-less agents (EC-7) |
| `packages/agents/src/bridge/compile-project-context.ts` | 68 | `704bce5` (2026-06-22) | Builds a `SystemPromptResolver` from `@ProjectContext`, prepending env+repoMap+instructions to `base` | When no `cwd`, resolver returns the base unchanged; never throws on missing THEO.md; no direct `node:` access (G8) |
| `packages/agents/tests/unit/systemprompt-resolver.test.ts` (NEW) | 0 | — | (file to be created) | — |
| `packages/agents/tests/integration/systemprompt-resolver-stream.test.ts` (NEW) | 0 | — | (file to be created) | — |

`packages/agents/src/bridge/sdk-adapter.ts` (173 LoC, `af4cd4e` 2026-06-23) is NOT edited: `M8CreateOptions.systemPrompt` already types `string | SystemPromptResolver` (`sdk-adapter.ts:20`) and the `else if (base !== undefined) options.systemPrompt = base` branch (`sdk-adapter.ts:52-54`) already forwards a resolver. It is listed here only as the integration boundary the Phase 3 test exercises; widening `compileProjectContext`'s `base` parameter (T2.1) is what makes the existing `compileProjectContext(compiled.projectContext, base)` call at `sdk-adapter.ts:50` type-check with a resolver base.

### Current callers / dependents

- **Symbol:** `AgentOptions.systemPrompt` (type field) in `packages/agents/src/types.ts:18`
  - **Callers (production):** `packages/agents/src/bridge/agent-compiler.ts:107` (`compileSubAgents` → `config.systemPrompt`), `packages/agents/src/bridge/agent-compiler.ts:125` (`compileAgent` → `walkResult.agentConfig.systemPrompt`); set by `packages/agents/src/decorators/agent.ts:46-51` (`setMeta` spreads `...options`, no validation that would reject a function)
  - **Callers (tests):** `packages/agents/tests/unit/agent-compiler.test.ts`, `packages/agents/tests/unit/m8-project-context-compile.test.ts`
  - **External (public API consumed by other repos):** yes — `@theokit/agents` is published; theocode consumes `@Agent`. Widening a union is backward-compatible (existing `string` call sites keep compiling).
- **Symbol:** `CompiledAgentOptions.systemPrompt` + `CompiledSubAgent.systemPrompt` in `packages/agents/src/bridge/agent-compiler.ts:74,80`
  - **Callers (production):** `packages/agents/src/bridge/sdk-adapter.ts:38` (`const base = compiled.systemPrompt`), `:50` (`compileProjectContext(..., base)`), `:52-54` (forward base)
  - **Callers (tests):** `packages/agents/tests/unit/agent-compiler.test.ts`
  - **External:** `CompiledAgentOptions` is exported via the bridge barrel; widening is backward-compatible.
- **Symbol:** `compileProjectContext(options, base?)` in `packages/agents/src/bridge/compile-project-context.ts:41`
  - **Callers (production):** `packages/agents/src/bridge/sdk-adapter.ts:50`
  - **Callers (tests):** `packages/agents/tests/unit/m8-project-context-compile.test.ts`
  - **External:** internal bridge function (not a published top-level export).

### Domain glossary

- **`SystemPromptResolver`** — SDK type `(promptCtx: { cwd?: string; ... }) => string | Promise<string>`; a function the SDK calls per send to compute the system prompt. Exported from `@theokit/sdk` (imported at `sdk-adapter.ts:9`, `compile-project-context.ts:17`).
- **Axis-A (SWAP) / Axis-B (COMPUTE)** — the two-axis dynamic-config taxonomy from the blueprint: SWAP = a value held at call time (per-request options object); COMPUTE = a value derived per request (resolver callable). `systemPrompt` is Axis-B.
- **Compile boundary** — `compileAgent` (`agent-compiler.ts`) turns decorator metadata into `CompiledAgentOptions`; `AgentRunner.build()` and `delegate()` both run through it.
- **M8 decorators** — the declarative-authoring decorators (`@Skills`, `@ContextWindow`, `@ProjectContext`, …) projected into `Agent.create` by `assembleM8CreateOptions` (`sdk-adapter.ts`).

### Architecture boundaries affected

- `@theokit/agents` → `@theokit/sdk` (type-only import of `SystemPromptResolver` into `types.ts`). The type-only import crosses the same boundary already crossed by `sdk-adapter.ts:9` and `compile-project-context.ts:17`; it is a `import type`, erased at compile, so it adds NO runtime dependency and does NOT violate G1/G2 (the SDK remains the only runtime; the resolver is executed by the SDK, not by agents). Direction: agents depends on the SDK type surface (existing, allowed).
- No change to the `core → nothing` invariant (this is the `agents` package, outside the `packages/theo/src` module graph in `rules/architecture.md`; the relevant contract is `system-design-guardrails.md` G1–G13).

## Prior Art & Related Work

- **Internal blueprint** — `knowledge-base/discoveries/blueprints/agent-dynamic-config-blueprint.md` §"The dominant pattern" + §"Recommended @theokit/agents design" (Tier 2 resolver-on-declaration) + §"Mapping to the 5 theocode gaps" (the `systemPrompt` row). The plan implements that row.
- **Internal review** — `knowledge-base/reviews/m8-decorator-runtime-edge-cases-2026-06-22.md` EC-4 (the explicit "revisit when @Agent accepts a resolver" note this plan acts on).
- **In-repo precedent** — `packages/agents/src/bridge/compile-project-context.ts` already produces a `SystemPromptResolver` and `sdk-adapter.ts` already consumes the `string | SystemPromptResolver` union; this plan extends the same seam to the author-facing decorator.
- **External literature** — Pydantic AI `@agent.system_prompt` callable (https://ai.pydantic.dev/agent/) and OpenAI Agents SDK callable `instructions` (https://openai.github.io/openai-agents-python/agents/): both attach a prompt function at definition, executed per run — the exact shape adopted here.

## Objective

- [ ] `@Agent({ systemPrompt: (ctx) => ... })` type-checks and is carried as a resolver (Axis-B), while `@Agent({ systemPrompt: 'string' })` still type-checks (backward compat).
- [ ] The resolver survives the compile boundary: `compileAgent` carries it into `CompiledAgentOptions.systemPrompt` byref.
- [ ] `@ProjectContext` + a resolver base COMPOSE (env+repoMap+instructions prepended to the resolved base output) rather than failing to type-check or silently dropping the base.
- [ ] An integration test proves the resolver reference reaches `Agent.create` for a non-`@ProjectContext` agent.
- [ ] Backward compatibility: existing string-systemPrompt tests stay green.

## ADRs

### D1 — Widen `systemPrompt` to the union `string | SystemPromptResolver` (one field, not two)

- **Decision:** Change `AgentOptions.systemPrompt`, `CompiledAgentOptions.systemPrompt`, and `CompiledSubAgent.systemPrompt` from `string` to `string | SystemPromptResolver` (the exact SDK type), via a type-only import from `@theokit/sdk`.
- **Rationale:** The SDK's own `Agent.create` already takes `string | SystemPromptResolver`; mirroring that union keeps one authoring concept ("the system prompt, static or computed") and lets the resolver flow byref with zero translation. KISS + DRY (no parallel type).
- **Alternatives considered:** (a) A separate `systemPromptResolver?: SystemPromptResolver` field alongside `systemPrompt?: string` — REJECTED: two fields for one concept, forces precedence rules and a "both set" error path that the union makes impossible by construction. (b) Make `systemPrompt` resolver-only (`SystemPromptResolver`) — REJECTED: breaks the static-string 80% case and is a breaking change.
- **Consequences:** Enables Tier-2 authoring; widening a published union is backward-compatible (narrowing later would be breaking, accepted as a one-way door because the union matches the SDK's stable shape).

### D2 — `@ProjectContext` composes with a resolver base (resolve-then-prepend), never throws

- **Decision:** Widen `compileProjectContext(options, base?: string)` to `base?: string | SystemPromptResolver`; inside the produced resolver, when `base` is a function, await it with the same `promptCtx` and prepend env+repoMap+instructions to its result (unchanged order: `[env, repoMap, instructions, resolvedBase]`).
- **Rationale:** "project context + a dynamically-assembled base prompt" is exactly theocode's shape; composition is the correct, prior-art-aligned behavior (Spring AI advisors compose; the existing resolver already prepends to a string base — extending it to a resolver base is the natural generalization).
- **Alternatives considered:** (a) Throw when both `@ProjectContext` and a resolver `systemPrompt` are present — REJECTED: removes a legitimate, desirable combination. (b) Ignore the base when it is a resolver — REJECTED: silent data loss (the author's computed prompt would vanish), violates fail-loud.
- **Consequences:** `@ProjectContext` and a resolver base now interoperate; the resolver awaits one extra async hop (negligible — already async).

### D3 — Sub-agent resolver carried at the type level, execution out of scope for this slice

- **Decision:** Widen `CompiledSubAgent.systemPrompt` to the union for type consistency (so `compileSubAgents` keeps compiling), but do NOT add sub-agent resolver execution wiring or tests in this slice; document the limitation in the field's JSDoc.
- **Rationale:** theocode's need is the top-level agent prompt; `compileSubAgents`' output (`compiled.agents`) is not even spread into `Agent.create` in `createSdkAgentStream` today (it feeds the separate `delegate()` path). Adding sub-agent resolver execution now is speculative (YAGNI / G11).
- **Alternatives considered:** (a) Keep `CompiledSubAgent.systemPrompt: string` and guard with `typeof === 'string'` in `compileSubAgents` — REJECTED: adds runtime branching for a path with no consumer. (b) Full sub-agent resolver support — REJECTED: YAGNI; no current caller.
- **Consequences:** Type stays consistent; a future slice can wire sub-agent resolver execution if a real case appears.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Widening a published union is effectively a one-way door (narrowing later is breaking) | Low | The union mirrors the SDK's own `systemPrompt` type — it is the already-stable shape, unlikely to need narrowing | maintainer |
| `CompiledSubAgent.systemPrompt` accepts a resolver that is never executed (per D3) — risks misleading a reader | Low | JSDoc on the field states execution is top-level-only this slice; ADR D3 records the scope | maintainer |
| `@ProjectContext` composition adds an extra `await` of the base resolver inside the projectContext resolver | Low | Path is already async; cost is one awaited call per send, negligible vs the I/O it already does | maintainer |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (widen union: types.ts + agent-compiler.ts) ──▶ Phase 2 (@ProjectContext compose) ──▶ Phase 3 (integration wiring proof)
                                                                                                   │
                                                                                                   ▼
                                                                                          Final Phase: Integration Validation
```

Phases are sequential: Phase 2's `base?: string | SystemPromptResolver` only type-checks after Phase 1 widens the source types; Phase 3 exercises the whole path end-to-end.

---

## Phase 1: Widen the `systemPrompt` union across declaration + compile boundary

**Objective:** `@Agent` and the compile boundary accept and carry a `SystemPromptResolver`, with `string` still valid.

### T1.1 — Widen `AgentOptions.systemPrompt` and the compiled types to `string | SystemPromptResolver`

#### Objective
`AgentOptions.systemPrompt`, `CompiledAgentOptions.systemPrompt`, and `CompiledSubAgent.systemPrompt` accept the union; `compileAgent` carries a resolver byref.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — adds `import type { SystemPromptResolver } from '@theokit/sdk'` to `types.ts` and `agent-compiler.ts`, changes the three `systemPrompt?: string` fields to `systemPrompt?: string | SystemPromptResolver`, and adds a JSDoc note on `CompiledSubAgent.systemPrompt` per ADR D3.
2. **Why it is necessary now** — it is the root enabler (ADR D1): until the declaration and compile types admit a function, a resolver cannot be authored or carried, and `compileSubAgents` (`agent-compiler.ts:107`) would fail to compile once `AgentOptions.systemPrompt` widens. Doing it first unblocks Phases 2 and 3.

#### Evidence
`packages/agents/src/types.ts:18` (`systemPrompt?: string`); `packages/agents/src/bridge/agent-compiler.ts:74,80` (compiled fields) and `:104-107,:125` (the assignments that would type-error if only the source widened); `packages/agents/src/bridge/sdk-adapter.ts:9` proves `SystemPromptResolver` is an existing `@theokit/sdk` type-only import.

#### Files to edit
```
packages/agents/src/types.ts — import type SystemPromptResolver; widen AgentOptions.systemPrompt
packages/agents/src/bridge/agent-compiler.ts — import type SystemPromptResolver; widen CompiledAgentOptions.systemPrompt + CompiledSubAgent.systemPrompt (+ JSDoc per D3)
packages/agents/tests/unit/systemprompt-resolver.test.ts — RED tests added first (TDD)
```

#### Deep file dependency analysis
- `types.ts` (Baseline row: decorator option interfaces) — add the union to `AgentOptions.systemPrompt`. Downstream: `agent.ts:46` (`setMeta` spread — unaffected, already accepts the value), `walk-agent-metadata.ts:202,271` (carries `agentConfig` whole — unaffected), `agent-compiler.ts:104,125` (reads `.systemPrompt`).
- `agent-compiler.ts` (Baseline row: compiles metadata) — widen `CompiledAgentOptions.systemPrompt` (line 80) and `CompiledSubAgent.systemPrompt` (line 74); the assignments at `:104-105` and `:125` then type-check. Downstream: `sdk-adapter.ts:38,50,52` reads `compiled.systemPrompt` (already typed to accept the union at `:20`).

#### Deep Dives
- **Invariant:** `@Agent({ systemPrompt: 'a string' })` MUST still compile and behave identically (Baseline `types.ts` invariant). The union is additive.
- **Edge case (backward compat):** a `string` value still flows through `compileAgent` and `assembleM8CreateOptions` exactly as before (the `else if (base !== undefined)` branch handles both arms of the union).
- **Type-only import:** `import type` is erased at emit — no runtime dependency on `@theokit/sdk` is introduced into `types.ts` (consistent with `sdk-adapter.ts:9`).

#### Pseudo-code / Signatures
```ts
// types.ts
import type { SystemPromptResolver } from '@theokit/sdk'
export interface AgentOptions {
  // ...
  systemPrompt?: string | SystemPromptResolver
}
// agent-compiler.ts
export interface CompiledSubAgent { model?: string; systemPrompt?: string | SystemPromptResolver /* D3: carried, exec top-level only */ }
export interface CompiledAgentOptions { /* ... */ systemPrompt?: string | SystemPromptResolver }
```

#### Tasks
1. Add `import type { SystemPromptResolver } from '@theokit/sdk'` to `types.ts`; widen `AgentOptions.systemPrompt`.
2. Add the same `import type` to `agent-compiler.ts`; widen `CompiledAgentOptions.systemPrompt` and `CompiledSubAgent.systemPrompt`; add the D3 JSDoc note.
3. Run the type test + typecheck.

#### TDD
```
RED:     test_agent_options_systemPrompt_accepts_resolver() — expectTypeOf<AgentOptions['systemPrompt']>().toEqualTypeOf<string | SystemPromptResolver | undefined>() (fails: currently string|undefined)
RED:     test_agent_options_systemPrompt_still_accepts_string() — a string literal is assignable to AgentOptions['systemPrompt'] (guards backward compat)
RED:     test_compileAgent_carries_resolver_byref() — given an AgentWalkResult whose agentConfig.systemPrompt is a resolver fn, compileAgent(...).systemPrompt === that same fn reference
GREEN:   widen the three union fields + imports
REFACTOR: None expected
VERIFY:  npx vitest run packages/agents/tests/unit/systemprompt-resolver.test.ts && npx tsc --noEmit -p packages/agents/tsconfig.test.json
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `test_agent_options_systemPrompt_accepts_resolver` and `test_compileAgent_carries_resolver_byref` pass: `npx vitest run packages/agents/tests/unit/systemprompt-resolver.test.ts`
- [ ] Backward compat: `npx vitest run packages/agents/tests/unit/agent-compiler.test.ts` stays green
- [ ] Pass: complexity — `npx eslint packages/agents/src/types.ts packages/agents/src/bridge/agent-compiler.ts --max-warnings=0` (complexity rule clean)
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/unit/systemprompt-resolver.test.ts` ≥ 90% on changed files
- [ ] Pass: lint — `npx eslint packages/agents/src/types.ts packages/agents/src/bridge/agent-compiler.ts --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/src/types.ts)" -le 500 && test "$(wc -l < packages/agents/src/bridge/agent-compiler.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

---

## Phase 2: Compose `@ProjectContext` with a resolver base

**Objective:** `compileProjectContext` accepts a resolver base and composes it (resolve-then-prepend) instead of failing to type-check or dropping it.

### T2.1 — Widen `compileProjectContext` base to the union and resolve a function base

#### Objective
`compileProjectContext(options, base?: string | SystemPromptResolver)` prepends env+repoMap+instructions to the resolved base, for both string and resolver bases, preserving the no-`cwd` and never-throw invariants.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — widens the `base` parameter type and, inside the returned resolver, computes `resolvedBase = typeof base === 'function' ? await base(promptCtx) : base` before the existing `[env, repoMap, instructions, resolvedBase].filter(Boolean).join('\n\n')`.
2. **Why it is necessary now** — after Phase 1, `compiled.systemPrompt` can be a resolver, so `sdk-adapter.ts:50` passes a resolver into `compileProjectContext`; without this change that call fails to type-check and the combination would be broken (ADR D2). It must land before the Phase 3 end-to-end proof.

#### Evidence
`packages/agents/src/bridge/compile-project-context.ts:41-67` (current `base?: string` + the `[env, repoMap, instructions, base]` join); `packages/agents/src/bridge/sdk-adapter.ts:50` (the call site that passes `base`).

#### Files to edit
```
packages/agents/src/bridge/compile-project-context.ts — widen base param to the union; resolve a function base inside the resolver
packages/agents/tests/unit/systemprompt-resolver.test.ts — RED test for the compose case (extends the Phase 1 file)
```

#### Deep file dependency analysis
- `compile-project-context.ts` (Baseline row: builds the `@ProjectContext` resolver) — change the `base` param type and add one branch to resolve a function base. Downstream: `sdk-adapter.ts:50` (the only production caller) now type-checks with a resolver base; `m8-project-context-compile.test.ts` (existing tests with a string base stay valid).

#### Deep Dives
- **Invariant (Baseline):** when `promptCtx.cwd` is absent the resolver still returns the base unchanged — but now the base can be a resolver, so the no-`cwd` arm must also resolve it: `return typeof base === 'function' ? await base(promptCtx) : (base ?? '')`. Never throws (the `readProjectInstructions` try/catch is unchanged).
- **Edge case:** `base` undefined → `''` (unchanged). `base` string → identical to today. `base` function → awaited once, then prepended-to.
- **Order:** unchanged — env, repoMap, instructions, then resolvedBase.

#### Pseudo-code / Signatures
```ts
export function compileProjectContext(
  options: ProjectContextOptions,
  base?: string | SystemPromptResolver,
): SystemPromptResolver {
  return async (promptCtx) => {
    const resolvedBase = typeof base === 'function' ? await base(promptCtx) : base
    if (!promptCtx.cwd) return resolvedBase ?? ''
    // ... existing env/repoMap/instructions ...
    return [env, repoMap, instructions, resolvedBase].filter(Boolean).join('\n\n')
  }
}
// Example
// base = (ctx) => `MEMORY for ${ctx.cwd}`; cwd='/r'  → "<env>\n\n<repoMap>\n\n<instructions>\n\nMEMORY for /r"
```

#### Tasks
1. Widen the `base` parameter type to `string | SystemPromptResolver`.
2. Compute `resolvedBase` once at the top of the returned resolver; use it in both the no-`cwd` arm and the join.
3. Run the unit tests.

#### TDD
```
RED:     test_projectContext_composes_resolver_base() — compileProjectContext(opts, ctx => 'BASE')({ cwd: '/r' }) resolves and the output ENDS WITH 'BASE' (env/repoMap mocked)
RED:     test_projectContext_resolver_base_without_cwd_returns_resolved_base() — with no cwd, output === 'BASE' (resolver awaited, not the function object)
RED:     test_projectContext_resolver_base_rejection_propagates() — (edge EC-1) a base resolver that throws causes the composed resolver to reject with the same error (fail-loud, NOT swallowed)
RED:     test_projectContext_async_resolver_base_is_awaited() — (edge EC-2) a base returning Promise.resolve('BASE') composes to a string ending with 'BASE' (not '[object Promise]')
RED:     test_projectContext_empty_resolver_base_no_trailing_separator() — (edge EC-3) a base resolving to '' produces no leading/trailing blank join (parity with the string-'' case)
GREEN:   widen base param + resolve function base
REFACTOR: None expected
VERIFY:  npx vitest run packages/agents/tests/unit/systemprompt-resolver.test.ts packages/agents/tests/unit/m8-project-context-compile.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `test_projectContext_composes_resolver_base` + `test_projectContext_resolver_base_without_cwd_returns_resolved_base` pass: `npx vitest run packages/agents/tests/unit/systemprompt-resolver.test.ts`
- [ ] Existing string-base behavior unchanged: `npx vitest run packages/agents/tests/unit/m8-project-context-compile.test.ts` green
- [ ] Pass: complexity — `npx eslint packages/agents/src/bridge/compile-project-context.ts --max-warnings=0` (complexity + max-lines-per-function rules clean)
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/unit/systemprompt-resolver.test.ts` ≥ 90% on `compile-project-context.ts`
- [ ] Pass: lint — `npx eslint packages/agents/src/bridge/compile-project-context.ts --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/src/bridge/compile-project-context.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

---

## Phase 3: End-to-end wiring proof (resolver reaches `Agent.create`)

**Objective:** prove (wiring triad — integration test) that a resolver authored on `@Agent` reaches the SDK `Agent.create` call unchanged for a non-`@ProjectContext` agent.

### T3.1 — Integration test: resolver flows through `createSdkAgentStream` to `Agent.create`

#### Objective
With the SDK mocked, a built agent whose `systemPrompt` is a resolver causes `Agent.create` to be called with `systemPrompt` === that resolver reference.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — adds an integration test that mocks `@theokit/sdk`, drives `createSdkAgentStream` for a `CompiledAgentOptions` whose `systemPrompt` is a resolver (no `@ProjectContext`), and asserts the captured `Agent.create` options carry the resolver byref; plus a companion assertion that a string systemPrompt still arrives as the same string (backward compat).
2. **Why it is necessary now** — Phases 1–2 widen types and compose project-context, but the Goal's metric is "the resolver reference reaches `Agent.create`". The test is the wiring proof (pillar b — integration test against the SDK boundary) that the path actually fires, not just compiles, and is the last gate before validation.

#### Evidence
`packages/agents/src/bridge/sdk-adapter.ts:52-54` (the `else if (base !== undefined) options.systemPrompt = base` branch the resolver takes when no `@ProjectContext`) and `:129-134` (`Agent.create({ ...m8 })`); existing mock pattern in `packages/agents/tests/integration/runtime-tools.test.ts:14-31` (how the SDK adapter is mocked / captured).

#### Files to edit
```
packages/agents/tests/integration/systemprompt-resolver-stream.test.ts (NEW) — mock @theokit/sdk; assert resolver byref reaches Agent.create
```

#### Deep file dependency analysis
- New integration test only — exercises `createSdkAgentStream` (`sdk-adapter.ts`) with a mocked `@theokit/sdk` (`vi.mock('@theokit/sdk', ...)` capturing the `Agent.create` argument). No production file changes in this task.

#### Deep Dives
- **Invariant:** `Agent.create` receives `systemPrompt` identical (byref for the resolver; byvalue for the string) to what was compiled. The mock captures the options object passed to `Agent.create`.
- **Edge case:** the agent under test declares NO `@ProjectContext`, so the resolver takes the `else if` branch (not the compose branch covered by T2.1) — this isolates the base-resolver path.
- **Mock shape:** mirror `runtime-tools.test.ts` — `vi.mock('@theokit/sdk', () => ({ Agent: { create: vi.fn(async (opts) => { captured = opts; return fakeAgent }) }, defineTool: (s)=>s }))`; drain one event so `Agent.create` runs.

#### Pseudo-code / Signatures
```ts
const resolver = (ctx) => `prompt for ${ctx.cwd}`
const compiled = { /* minimal */ systemPrompt: resolver, tools: [], agents: {}, stream: true }
for await (const _ of createSdkAgentStream(compiled, [], 'k')('hi', 's')) { /* drain */ }
expect(captured.systemPrompt).toBe(resolver)  // byref
// companion: systemPrompt: 'static' → expect(captured.systemPrompt).toBe('static')
```

#### Tasks
1. Create the integration test with the SDK mock capturing `Agent.create` options.
2. Assert resolver-byref for a resolver systemPrompt and string-byvalue for a string systemPrompt.
3. Run the integration test.

#### TDD
```
RED:     test_createSdkAgentStream_passes_resolver_to_agent_create() — captured.systemPrompt === resolver (fails before Phase 1 widening compiles the path)
RED:     test_createSdkAgentStream_still_passes_string_systemPrompt() — captured.systemPrompt === 'static' (backward compat)
GREEN:   (no production change in this task — Phases 1+2 already make the path type-check; the test asserts the existing forward behavior)
REFACTOR: None expected
VERIFY:  npx vitest run packages/agents/tests/integration/systemprompt-resolver-stream.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `test_createSdkAgentStream_passes_resolver_to_agent_create` passes: `npx vitest run packages/agents/tests/integration/systemprompt-resolver-stream.test.ts`
- [ ] Backward-compat assertion `test_createSdkAgentStream_still_passes_string_systemPrompt` passes (same command)
- [ ] Pass: complexity — `npx eslint packages/agents/tests/integration/systemprompt-resolver-stream.test.ts --max-warnings=0` (complexity rule clean)
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/systemprompt-resolver-stream.test.ts` exercises `sdk-adapter.ts:52-54`
- [ ] Pass: lint — `npx eslint packages/agents/tests/integration/systemprompt-resolver-stream.test.ts --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/tests/integration/systemprompt-resolver-stream.test.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

---

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | `>=2.9.0` (peer/dev, already installed) | npm | Source of the `SystemPromptResolver` type (type-only import) and the agent runtime that executes the resolver. Already a dependency of `@theokit/agents` (imported at `sdk-adapter.ts:9`, `compile-project-context.ts:17`). |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | | | | This slice adds NO dependency — `SystemPromptResolver` is a type-only import from the already-present `@theokit/sdk`; nothing is added to `packages/agents/package.json`. |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| G1 | `AgentOptions.systemPrompt` only accepts `string` (can't author a resolver) | T1.1 | Widen to `string \| SystemPromptResolver` (ADR D1) |
| G2 | Compile boundary (`CompiledAgentOptions`/`CompiledSubAgent`) drops/rejects a resolver | T1.1 | Widen both compiled fields; `compileAgent` carries byref (ADR D1, D3) |
| G3 | `@ProjectContext` + resolver base fails to type-check / would drop the base | T2.1 | Compose: resolve-then-prepend (ADR D2) |
| G4 | No proof the resolver reaches `Agent.create` (wiring) | T3.1 | Integration test asserts resolver byref at the SDK boundary |
| G5 | EC-4 closed: `@Agent` author can declare a computed prompt | T1.1 | Resolver is a first-class `@Agent({ systemPrompt })` value |
| G6 | Backward compatibility (string systemPrompt unchanged) | T1.1, T3.1 | Union is additive; string-path tests + byvalue assertion stay green |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `rules/architecture.md` / G6)
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6) — `packages/agents/CHANGELOG.md` exists; add the entry, plus a changeset under `.changeset/` (minor bump `@theokit/agents`)
- [ ] Backward compatibility preserved across public API (string systemPrompt still valid)
- [ ] Plan-specific: `npx vitest run packages/agents/tests/integration/systemprompt-resolver-stream.test.ts` passes (the Goal metric)
- [ ] **Runtime-metric proof** — n/a (no new counter introduced this slice; the existing `[THEO_AGENT_M8_RUNTIME_APPLIED]` log is unchanged)
- [ ] **Plan archived** — after `/review` returns `READY_TO_MERGE` AND the PR is merged, move this plan to `knowledge-base/plans/completed/`

## Failure scenarios (when I/O external)

```
(none — no external I/O touched)
```

The `@ProjectContext` resolver does filesystem I/O, but this plan only changes whether its `base` can be a function — it does not add or alter any external I/O call; the existing never-throw contract (try/catch around `readProjectInstructions`) is preserved unchanged.

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 1–3. The plan is NOT done until this chain passes.

**Objective:** the whole `@theokit/agents` suite is green with the widened union and the resolver path proven end-to-end.

### Execution
```
npx vitest run packages/agents                                   # unit + integration (incl. the two new files)
npx vitest run --coverage packages/agents                        # coverage report (≥ 90% on changed files)
npx tsc --noEmit -p packages/agents/tsconfig.test.json           # zero type errors
npx eslint packages/agents --max-warnings=0                      # zero lint warnings
```

### Acceptance Criteria
- [ ] All test suites green — `npx vitest run packages/agents`
- [ ] Coverage ≥ 90% on changed files — `npx vitest run --coverage packages/agents` (`types.ts`, `agent-compiler.ts`, `compile-project-context.ts`)
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] Runtime-metric proof — n/a this slice (no new counter; documented above)
- [ ] Failure scenarios green — n/a (`(none — no external I/O touched)` declared)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description (do not block on them).
