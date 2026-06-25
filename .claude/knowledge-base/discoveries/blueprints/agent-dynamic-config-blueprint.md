# Blueprint — Dynamic / Per-Request Config for `@Agent` (decorator-vs-dynamic tension)

**Slug:** `agent-dynamic-config`
**Date:** 2026-06-25
**Status:** SHIPPABLE (research synthesis; prior-art validated)
**Question investigated:** "How should `@theokit/agents`' `@Agent` decorator + `AgentRunner` support DYNAMIC / per-request configuration (model, system prompt, cwd, plugins, iteration budget) without bolting on ad-hoc options?"

## Context

`@Agent({ model, systemPrompt, tools })` is a class decorator (static metadata, frozen at class-definition time). theocode (`runCodeAgent` → `agent-stream.ts:297-365`) needs PER REQUEST: dynamic `model`, dynamic `systemPrompt` (assembled from rules+memory+skills each request), per-request `cwd`, conditional `plugins`, iteration-count budget. The declarative decorator cannot express per-request dynamism. This blueprint is the design foundation for V4-L (the framework-first close of the 5 theocode loop-adoption gaps).

## The core finding — config has TWO axes, not one

Every mature decorator/agent framework splits dynamic config into two kinds and treats each differently:

| Axis | What it is | Resolution mechanism | theokit gaps |
|---|---|---|---|
| **A — SWAP** | A value you ALREADY HOLD at call time (model, maxIterations, cwd, budget, tool set) | **Per-request options object that MERGES over static defaults** | `model`, `cwd`, `maxIterations` |
| **B — COMPUTE** | A value DERIVED per request from context/deps (systemPrompt from rules+memory, plugins by mode) | **Resolver callable supplied at the declaration, invoked by the framework per request** | `systemPrompt`, `plugins` |

Nobody uses a resolver for a value already held (ceremony, fails KISS). Nobody uses flat options for a computed value (god-object). The "5 ad-hoc opts" critique only bites if everything is flat run-options; splitting by axis is what keeps it coherent.

## Per-framework prior art

| Framework | Static declaration | Per-request mechanism | Pattern | Citation |
|---|---|---|---|---|
| **Spring core** | bean singleton | method-arg value; `ObjectProvider.getObject()` / `@Lookup` for fresh bean | values + provider | Spring Method Injection, Bean Scopes |
| **Spring AI** (closest analog) | `ChatClient.builder(model).defaultOptions(...).build()` (ONCE) | `.prompt().system(...).options(ChatOptions...).advisors(...).call()` — runtime options **merge over** defaults; Advisors compute per-request context | **values-override (merge) + advisor-callable** | Spring AI Chat Client API, Advisors |
| **CrewAI** | `Agent(llm=...)` fixed; YAML `{placeholders}` | `crew.kickoff(inputs={...})` fills placeholders; no per-task llm override | pure values-override (degenerate) | CrewAI Agents/Crews |
| **NestJS** | provider singleton; `@Module` | `forRootAsync({useFactory, inject})`; `Scope.REQUEST` + `@Inject(REQUEST)`; `ModuleRef.resolve()` | factory/resolver | NestJS Dynamic Modules, Injection Scopes |
| **FastAPI** | `@app.get(...)` route | `param = Depends(resolver_fn)` — resolver runs EVERY request | resolver-callable (cleanest) | FastAPI Dependencies |
| **Pydantic AI** | `Agent('model', system_prompt='...')` | `agent.run(prompt, model=..., model_settings=..., deps=...)` (values); **`@agent.system_prompt`/`@agent.instructions`** callable given `RunContext[Deps]`, run per request | **values-override + resolver-callable (hybrid)** | Pydantic AI Agents/Dependencies |
| **OpenAI Agents SDK** | `Agent(name, model, tools)` | `instructions: str \| Callable[[RunContextWrapper, Agent], str]`; `Runner.run(..., context=...)`; `RunConfig(model=...)` | resolver-callable + values-override | OpenAI Agents docs |
| **LangChain** | `.configurable_fields(...)` | `.with_config(configurable={...})` swaps values | values-override | LangChain configure runtime |

## The dominant pattern (the recommendation)

**Hybrid, and it is the SOTA shape, not a compromise:**
- **Axis A → per-request options object** (Spring AI `ChatOptions`, Pydantic `run(...)`, OpenAI `RunConfig`). Correct for `model`, `cwd`, `maxIterations`, `budget`, `tools`.
- **Axis B → resolver function on the declaration** (Pydantic `@system_prompt`, OpenAI callable `instructions`, FastAPI `Depends`, NestJS `useFactory`). Correct for `systemPrompt`, `plugins`.

### Key enabler already in the codebase
`@theokit/sdk` already exports `SystemPromptResolver = (promptCtx: { cwd?, ... }) => string | Promise<string>` and `Agent.create` accepts `systemPrompt: string | SystemPromptResolver`. `sdk-adapter.ts:20` already accepts the union; `compile-project-context.ts:41` already compiles `@ProjectContext` to a resolver. The framework simply does not EXPOSE this duality to the `@Agent` author. Documented as EC-4 in `reviews/m8-decorator-runtime-edge-cases-2026-06-22.md` ("if a future change lets `@Agent` accept a resolver, revisit T3.1"). **This blueprint is that change.**

## Recommended `@theokit/agents` design

Three authoring tiers (the simple case stays a string — KISS):

```ts
// Tier 1 — static (80% case, ergonomics intact)
@Agent({ model: 'claude-sonnet-4-6', systemPrompt: 'You are...' })

// Tier 2 — computed-per-request resolver on the declaration (theocode's case)
@Agent({ systemPrompt: (ctx) => assemblePrompt({ rules, memory, cwd: ctx.cwd }) })

// Tier 3 — per-request swap at the call site
runner.stream(msg, { apiKey, model: req.model, cwd: req.cwd, maxIterations: 5 })
```

### Rollout — 3 independently shippable slices (sequential, user-chosen 2026-06-25)
- **V4-L.1** — widen `AgentOptions.systemPrompt` to `string | SystemPromptResolver` (closes EC-4; smallest, highest-leverage; SDK already accepts the union).
- **V4-L.2** — add `model`/`cwd`/`maxIterations` to `AgentRunnerRunOptions` with documented merge-over-compiled semantics (parallels the shipped V4-J `tools`).
- **V4-L.3** — add `AgentRunnerBuilder.withRequestContext(resolver)` for per-request `cwd`/`plugins` composition (NestJS `forRootAsync` / FastAPI `Depends` analog).

## Inheritance verdict — NO

A subclass (`class GptCodeAgent extends BaseCodeAgent` overriding `model`) is STILL static — resolved at class-definition time, exactly like the base decorator; cannot express per-request variation, which is the actual requirement. Real LSP risk (subclass narrowing `@Sandbox` breaks an `AgentRunner` written against the base; the compile-once builder won't catch it). Inheritance models only a closed set of fixed variants — and the run-options `model` field covers that with zero new classes AND the open/per-request case. Composition (resolver + run-options) wins; consistent with G11 (YAGNI) and the existing mixin/`applyDecorators` composition mechanism.

## Mapping to the 5 theocode gaps (coherent, not 5 ad-hoc fields)

| Gap | Axis | Mechanism | Code landing |
|---|---|---|---|
| `model` (per request) | A — swap | `AgentRunnerRunOptions.model`; `opts.model ?? compiled.model ?? default` | `agent-runner.ts` + `sdk-adapter.ts:71` |
| `systemPrompt` (assembled per request) | B — compute | widen `AgentOptions.systemPrompt` to `string \| SystemPromptResolver` (EC-4); resolver also accepted at run-level | `types.ts`, `agent-compiler.ts`, `sdk-adapter.ts` (already accepts union) |
| `cwd` (per request) | A — swap (feeds B) | `AgentRunnerRunOptions.cwd` → threaded into `promptCtx.cwd` | `compile-project-context.ts:46` (already reads it; just supply it) |
| `plugins` (conditional) | B — compute | single `AgentRunnerBuilder.withRequestContext((req) => ({ plugins }))` | new builder method |
| iteration budget (per request) | A — swap | `AgentRunnerRunOptions.maxIterations` → `resolveLoopStrategy` | `agent-runner.ts` |

Three of five are Axis-A swaps joining the existing run-options alongside the shipped `tools` (V4-J). Two are Axis-B computed values served by the resolver seam the SDK already exposes. No new concept invented — the design surfaces to the author the union the runtime already speaks.

## Key source files (theokit)
- `packages/agents/src/types.ts` (`AgentOptions`) — widen `systemPrompt`.
- `packages/agents/src/loop/agent-runner.ts` (`AgentRunnerRunOptions`; builder) — Axis-A fields + `withRequestContext`.
- `packages/agents/src/bridge/agent-compiler.ts` — carry resolver through compile.
- `packages/agents/src/bridge/sdk-adapter.ts` — already accepts `string | SystemPromptResolver`; thread `opts.model`/`opts.cwd`.
- `packages/agents/src/bridge/compile-project-context.ts` — already consumes `promptCtx.cwd`.
- Prior decision: `.claude/knowledge-base/reviews/m8-decorator-runtime-edge-cases-2026-06-22.md` (EC-4).
