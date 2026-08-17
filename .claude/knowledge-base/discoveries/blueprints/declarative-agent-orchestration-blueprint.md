# Blueprint: Declarative Agent Orchestration — dar runtime ao `@MainLoop` (builder + strategy)

> **Verdict-readiness:** SHIPPABLE_WITH_CAVEATS (all 7 questions answered with real `path:line`; 0 fabricated citations; 4 coverage corners populated; ADRs synthesized; EC-2/EC-3/EC-4 honored). Caveat: the in-tree `packages/agents/...` anchors (ADR D3) are validated by human review downstream, not by the `/discover-confidence` checker.
>
> **Slug:** `declarative-agent-orchestration` · **Sources:** spring-ai (2.0.1-SNAPSHOT) + mastra (`@mastra/core@1.46.0-alpha.3`), cloned 2026-06-23 (`--depth 1`). **Date:** 2026-06-23.

## Executive summary

Spring AI and Mastra solve the two open axes the `@theokit/agents` `@MainLoop` runtime needs, but they split cleanly. Spring AI is the SOTA of the **builder→executable** pattern (`ChatClient.builder(model)...build()` materializes a `DefaultChatClient` that is **standalone — zero `@Autowired`/`ApplicationContext`**, with DI relegated to a *separate* auto-config module) and of the **per-call interceptor** pattern (Advisor: `before` → `chain.nextCall()` → `after`, ordered, short-circuitable). Mastra is the SOTA of the **multi-round loop** in TypeScript: the canonical loop lives in `agent/agent.ts` → `loop/workflows/agentic-loop/index.ts`, driven by AI-SDK `StopCondition` predicates (`stopWhen({ steps })`) plus a `maxSteps` ceiling, with `finishReason: 'tool-calls'` vs `'stop'` as the round-continuation signal. **Crucially (EC-2): Mastra's `tool-loop-agent/` is NOT the canonical loop — it is an interop adapter that wraps an AI-SDK v6 `ToolLoopAgent` as an `inputProcessor`. The canonical loop terminal contract is `agentic-loop/index.ts`.** And (EC-4) **Spring's Advisor analogy breaks for our target**: an Advisor is a per-single-call interceptor (middleware), while our `LoopStrategy` decides *between rounds* — so `LoopStrategy` must be modeled on Mastra's `stopWhen`/`agentic-loop`, not on Spring's `adviseCall`. The recommendation: a Zod-validated `LoopStrategy.shouldContinue(outcome)` + `ReflectionStrategy.reflect(outcome)` contract, compiled by the bridge from the `@MainLoop({ strategy })` metadata field into `Agent.create()`/`Run.stream()` calls (ADR 0031: bridge compiles, SDK executes, no IoC, no new reflect-metadata).

---

## Context

O V4-A provou que o `@MainLoop({ strategy: 'simple-chat'|'plan-act-reflect'|'react' })` do `@theokit/agents` é metadata-only: declarado + obrigatório (`packages/agents/src/bridge/walk-agent-metadata.ts:5`) + compilado (`agent-compiler.ts`), mas o orquestrador (`packages/agents/src/bridge/agent-orchestrator.ts`) é single-shot e nunca faz branch em `strategy`. É o anti-pattern "decorator-without-runtime" que ADR 0031 + `sdk-runtime.md` mandam fechar; o M8 fechou para `@ContextWindow`/`@Skills`, faltou o `@MainLoop`. Este blueprint investiga Spring AI (builder + Advisor + starter) e Mastra (loop multi-round tipado em TS) para decidir COMO dar runtime a esse `strategy` como `LoopStrategy`/`ReflectionStrategy` + `AgentRunner` builder, sem IoC.

## Objective

Permitir decidir como dar runtime ao `strategy` do `@MainLoop` (loop multi-round + reflexão) como strategies nomeadas + builder fluente, compilando para `Agent.create()`/`Run.stream()` (ADR 0031), de modo que o theocode adote e delete `agent-loop.ts` (248 LoC) + colapse `agent-stream.ts` (470 LoC). Sucesso = contratos `LoopStrategy`/`ReflectionStrategy` + shape do `AgentRunner.builder()` propostos com evidência de Spring AI + Mastra, e `/discover-confidence` ≥ SHIPPABLE_WITH_CAVEATS.

## Coverage Corner 1 — Integration Tests

Answers **Q4** (Spring AI advisor tests) and **Q5** (Mastra multi-round loop test).

### Q4 — How Spring AI tests an Advisor isolated + composed (no real LLM)

| Test | What it mocks | What it asserts | Citation |
|---|---|---|---|
| `DefaultAroundAdvisorChainTests.getCallAdvisors` | `CallAdvisor` via `mock(CallAdvisor.class)`; stubs `getName()` + `adviseCall(any(),any()) → ChatClientResponse.builder().build()` | the chain dispatches advisors; no real model invoked | `references/spring-ai/spring-ai-client-chat/src/test/java/org/springframework/ai/chat/client/advisor/DefaultAroundAdvisorChainTests.java:101-108` |
| `DefaultAroundAdvisorChainTests` (null guards) | nothing — builds chain with `ObservationRegistry.NOOP` | `build()` rejects null advisor / null list / null elements via `IllegalArgumentException` | `.../DefaultAroundAdvisorChainTests.java:54-82` |
| `SimpleLoggerAdvisorTests` | `@Mock ChatModel`; `when(chatModel.getOptions()).thenReturn(ChatOptions.builder().build())` | `loggerAdvisor.getOrder()` == 1; logged `request:`/`response:` contain prompt + `finishReason` | `.../advisor/SimpleLoggerAdvisorTests.java:60-112` |
| `ChatClientAdvisorTests` / `ChatClientTests` | `@ExtendWith(MockitoExtension.class)` + `@Mock` `ChatModel`; `given/when…thenReturn` | default-system override behavior end-to-end through the chain, content == `"response"` | `.../ChatClientTests.java:62-129` |

**Recipe:** mock the `ChatModel` (or mock the `CallAdvisor` itself) with Mockito; assert (a) `getOrder()` for ordering, (b) chain dispatch via `chain.nextCall()`, (c) `before`/`after` mutation of request/response. No LLM key needed. The chain itself is built with a fluent builder (`DefaultAroundAdvisorChain.builder(ObservationRegistry.NOOP).pushAll(...).build()`) — testable standalone.

### Q5 — How Mastra tests the multi-round loop (mock model returning several rounds)

The canonical recipe is a stateful mock that switches `finishReason` by call count:

- `createToolCallingMockModel(toolName, toolInput)` keeps a `callCount`; **round 1** returns `finishReason: { unified: 'tool-calls' }` with a `tool-call` content part; **subsequent rounds** return `finishReason: { unified: 'stop' }` with a text part — `references/mastra/packages/core/src/tool-loop-agent/__tests__/tool-loop-agent.test.ts:57-139`.
- The multi-round assertion: after `agent.generate('What is the weather…')`, the test asserts `result.toolCalls[0].payload.toolName === 'weather'` and **`result.steps.length === 2`** (tool-call round + final-response round) — `tool-loop-agent.test.ts:389-423`.
- `prepareCall` is asserted to run exactly once on the first step: `expect(prepareCallSpy).toHaveBeenCalledTimes(1)` — `tool-loop-agent.test.ts:427-447`.
- The mock model uses `MockLanguageModelV3` + `convertArrayToReadableStreamV3` from `agent/__tests__/mock-model` — `tool-loop-agent.test.ts:4,16-51`.

**Recipe for theokit:** drive a fake SDK stream whose first round emits a `tool-call`/`tool-use` event (no terminal) and whose second emits a terminal (`finish`/`stop`); assert the loop ran exactly N rounds and stopped on the terminal — deterministic, no real LLM. This mirrors the existing `createMockAgentStream()` permitted by `sdk-runtime.md` § "O que é permitido".

---

## Coverage Corner 2 — Dependencies

Answers **Q6** (runtime deps + standalone-vs-DI verdict).

| Ref | Orchestration-layer runtime deps | Citation |
|---|---|---|
| Spring AI `spring-ai-client-chat` | `spring-ai-model`, `reactor-core` (the `Flux` stream of `adviseStream`), **`spring-context`** (DI container — but see verdict), `jtokkit` (token count), `jsonschema-generator`, `json-schema-validator`, `kotlin-stdlib`/`kotlin-reflect` | `references/spring-ai/spring-ai-client-chat/pom.xml:37,65-66,72` (artifactIds: `spring-ai-model`, `reactor-core`, `spring-context`, `jtokkit`) |
| Mastra `@mastra/core` | `@ai-sdk/provider-utils-v5/v6`, `@ai-sdk/provider-v5/v6` (the loop's `StopCondition`/`finishReason` come from here), `@isaacs/ttlcache`, `zod ^3.25 || ^4` (peer) | `references/mastra/packages/core/package.json:792-796,822` |
| `@theokit/agents` (target) | consumes `@theokit/sdk` only (`createSdkAgentStream`); per G1 it imports `@theokit/http` not core, and never the SDK's transport | `packages/agents/src/bridge/agent-orchestrator.ts:159` (`createSdkAgentStream(...)`); G1/G2 in `architecture.md` |

### Standalone vs DI verdict (load-bearing for "no IoC", ADR 0031)

- **Spring AI's builder is STANDALONE.** `grep` for `ApplicationContext|@Autowired|@Component|@Service|@Inject` in `DefaultChatClient.java` + `DefaultChatClientBuilder.java` returns **ZERO** matches. The builder is instantiated by `ChatClient.builder(chatModel)` and `build()` simply does `new DefaultChatClient(this.defaultRequest)` — `references/spring-ai/spring-ai-client-chat/src/main/java/org/springframework/ai/chat/client/DefaultChatClientBuilder.java:63-65,114-116`.
- The DI layer (`@AutoConfiguration`, `ApplicationContext`, `@Bean`) lives **only** in the *separate* `auto-configurations/models/chat/client/...` module — an opt-in convenience, never a requirement. Its test uses `ApplicationContextRunner` (a test-only container), confirming the container is external to the chat-client core — `references/spring-ai/auto-configurations/.../ChatClientAutoConfigurationTests.java:45-46`.
- **`spring-context` on the classpath ≠ DI required to construct a `ChatClient`.** It is used for ordering/`Ordered` (`Advisor extends Ordered`) and observation, not for wiring the builder.

**Conclusion:** the builder/strategy pattern is achievable **without any IoC container** — exactly the constraint ADR 0031 + `sdk-runtime.md` impose. Mastra confirms the same in TS: `new Agent({...})` is a plain constructor; no container. The theokit `AgentRunner.builder()` can be a plain TS class.

---

## Coverage Corner 3 — Tools

Answers **Q7** (Spring Boot starter / auto-configuration model — the V4-H "starter").

How Spring Boot packages an opinionated default agent and the build tooling that enables it:

- **Auto-config class** `ChatClientAutoConfiguration` is annotated `@AutoConfiguration(after = ToolCallingAutoConfiguration.class)` + `@ConditionalOnClass(ChatClient.class)` + `@EnableConfigurationProperties(ChatClientBuilderProperties.class)` + `@ConditionalOnProperty(prefix=…, name="enabled", havingValue="true", matchIfMissing=true)` — `references/spring-ai/auto-configurations/models/chat/client/spring-ai-autoconfigure-model-chat-client/src/main/java/org/springframework/ai/model/chat/client/autoconfigure/ChatClientAutoConfiguration.java:67-72`.
- It auto-wires a default builder bean **only if the user did not provide one**: `@Bean @Scope("prototype") @ConditionalOnMissingBean ChatClient.Builder chatClientBuilder(...)` — `ChatClientAutoConfiguration.java:112-129`. `@ConditionalOnMissingBean` is the "opinionated default, overridable" lever; `@Scope("prototype")` gives each injection point a fresh cloned builder (`ChatClientAutoConfiguration.java:54-57`).
- A model-specific starter (`AnthropicChatAutoConfiguration`) layers `@ConditionalOnClass(AnthropicClient.class)` + `@ConditionalOnProperty(name=CHAT_MODEL, havingValue=ANTHROPIC, matchIfMissing=true)` so the right provider auto-activates by classpath presence — `references/spring-ai/auto-configurations/models/spring-ai-autoconfigure-model-anthropic/src/main/java/org/springframework/ai/model/anthropic/autoconfigure/AnthropicChatAutoConfiguration.java:48-56`.
- **Build tooling that enables discovery:** the starter is registered via a resource file `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` (Spring Boot 3 mechanism) — `references/spring-ai/auto-configurations/models/chat/client/spring-ai-autoconfigure-model-chat-client/src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` (file exists; header verified). Tests use `ApplicationContextRunner().withConfiguration(AutoConfigurations.of(ChatClientAutoConfiguration.class))` to assert the bean materializes — `ChatClientAutoConfigurationTests.java:45-46,60-92`.

**Mapping to `@theokit/starter-*` (V4-H):** the portable contract is "ship an opinionated default the consumer can override with `@ConditionalOnMissingBean` semantics." In TS/theokit there is **no `ApplicationContext`** — the equivalent is a factory function that returns a pre-configured `AgentRunner.builder()` which the app may either use as-is or override per-call. **EC-3 NON-PORTABLE:** `@AutoConfiguration`, `@ConditionalOnClass`, `@ConditionalOnMissingBean`, `@EnableConfigurationProperties`, the `AutoConfiguration.imports` discovery file, and prototype-scoped beans are **Java/Spring-Boot-only mechanisms** that MUST NOT be reproduced in TS (they require an IoC container — forbidden by ADR 0031). The portable *idea* is "classpath/config presence selects a default; explicit user config wins."

---

## Coverage Corner 4 — Techniques

Answers **Q1** (builder→executable), **Q2** (Advisor-as-strategy + where the analogy breaks), **Q3** (Mastra multi-round loop + EC-2 canonical verdict).

### Q1 — Spring AI builder→executable (`DefaultChatClient`)

`DefaultChatClientBuilder` accumulates a `DefaultChatClientRequestSpec` (default model, advisors, tools, system/user templates) via fluent setters, then `build()` materializes the executable client:

| Fluent method | Effect | Citation |
|---|---|---|
| `defaultAdvisors(Advisor...)` / `(List)` / `(Consumer<AdvisorSpec>)` | appends interceptors | `DefaultChatClientBuilder.java:122-132` |
| `defaultTools(Object...)` / `defaultToolCallbacks(...)` | registers tools | `DefaultChatClientBuilder.java:195-228` |
| `defaultSystem(...)` / `defaultUser(...)` | sets prompt templates | `DefaultChatClientBuilder.java:142-189` |
| `defaultOptions(ChatOptions.Builder)` | model options | `DefaultChatClientBuilder.java:137` |
| `build()` | `return new DefaultChatClient(this.defaultRequest)` — **the compile→execute boundary** | `DefaultChatClientBuilder.java:114-116` |
| `clone()` / `mutate()` | fork the builder (each injection point gets its own) | `DefaultChatClientBuilder.java:118-120`; `DefaultChatClient.java:146` |

The built client then exposes `prompt()` → `ChatClientRequestSpec` and `.call()`/`.stream()` response specs; the actual execution flows through the advisor chain: `advisorChain.nextCall(chatClientRequest)` terminates in the `ChatModelCallAdvisor` — `DefaultChatClient.java:639-663` (`doGetObservableChatClientResponse`). **Diagram:** `builder.defaults*(...) → build() → DefaultChatClient → prompt().call()/.stream() → advisorChain.nextCall() → model`. Maps directly to `AgentRunner.builder(AgentClass).reflection(...).stream().build() → run`.

### Q2 — Spring AI Advisor as Strategy (contract, order, short-circuit) + where the analogy breaks (EC-4)

**Contract** (3 interfaces): `Advisor extends Ordered` declares `String getName()` + inherits `int getOrder()` — `references/spring-ai/spring-ai-client-chat/src/main/java/org/springframework/ai/chat/client/advisor/api/Advisor.java:31-45`. `CallAdvisor extends Advisor` declares the single method `ChatClientResponse adviseCall(ChatClientRequest, CallAdvisorChain)` — `.../advisor/api/CallAdvisor.java:30-34`. `BaseAdvisor extends CallAdvisor, StreamAdvisor` reduces boilerplate to two hooks: `before(request, chain)` and `after(response, chain)`, with the default `adviseCall` = `before → chain.nextCall(req) → after` — `.../advisor/api/BaseAdvisor.java:42-89`.

**Ordering + short-circuit + chaining:** the chain pops the next advisor and calls `advisor.adviseCall(request, this)`; advisors are sorted by `getOrder()` (`OrderComparator.sort`) — `references/spring-ai/spring-ai-client-chat/src/main/java/org/springframework/ai/chat/client/advisor/DefaultAroundAdvisorChain.java:98-120` (dispatch) and `:279-284` (sort). An advisor **short-circuits** by NOT calling `chain.nextCall()` and returning its own `ChatClientResponse` instead — the chain only advances when an advisor explicitly delegates.

**Concrete impl** (`RetrievalAugmentationAdvisor implements BaseAdvisor`): `before` transforms+expands the query, retrieves docs, augments the user prompt, returns a mutated `ChatClientRequest` (`references/spring-ai/spring-ai-rag/src/main/java/org/springframework/ai/rag/advisor/RetrievalAugmentationAdvisor.java:107-154`); `after` enriches the response metadata (`:166-182`); `getOrder()` returns a configurable order (`:190-192`).

**EC-4 — where the analogy breaks (recorded explicitly):** Spring's Advisor is a **per-single-call interceptor** — `adviseCall(request, chain)` wraps **one** model invocation (middleware shape: before/around/after). It has NO concept of "run the model again with the tool result and decide whether to continue." Our `LoopStrategy` decides **between multiple rounds** of an agentic loop (round → outcome → {continue, terminate}). Mapping `LoopStrategy` onto `adviseCall` would force a multi-round concern into a per-call interceptor — wrong shape. **Therefore: model `LoopStrategy` on Mastra's `agentic-loop`/`stopWhen` (Q3), and reserve the Advisor pattern only for cross-cutting per-call concerns (logging, RAG augmentation) — which in theokit are already covered by `@UseGuards`/`@UseInterceptors` metadata (G5).** The Advisor→`ReflectionStrategy` mapping is *partial*: a reflection step that mutates the next prompt resembles `before()`, but the decision to re-enter the loop is a loop concern, not an advisor concern.

**EC-3 NON-PORTABLE (Q1/Q2):** Java method overloading (`defaultUser(String)` / `defaultUser(Resource)` / `defaultUser(Consumer)`), `Ordered`/`OrderComparator` (Spring core), and `reactor.core.publisher.Flux`/`Mono` (Reactor) are Java-only. The portable contract is: a fluent builder that accumulates config and a `build()` that materializes an executable; an ordered, short-circuitable interceptor with a `getOrder()`-equivalent (a numeric `order` field) and a `next()`-equivalent delegation. TS uses async iterables/`ReadableStream`, not `Flux`.

### Q3 — Mastra multi-round loop + stream (EC-2 cross-check verdict)

**EC-2 VERDICT — `tool-loop-agent/` is an alpha INTEROP ADAPTER, NOT the canonical loop.** Cross-check: `agent/index.ts` and `agent/agent.ts` do **not** reference `tool-loop-agent` (grep returned zero). `tool-loop-agent/index.ts` imports `Agent` from `../agent` and wraps an AI-SDK v6 `ToolLoopAgent` into a Mastra `Agent` by attaching a `ToolLoopAgentProcessor` as an `inputProcessor` — `references/mastra/packages/core/src/tool-loop-agent/index.ts:1-9,33-47`. The processor only maps AI-SDK settings (`prepareCall`/`prepareStep`/`stopWhen`) into Mastra's processor hooks — `references/mastra/packages/core/src/tool-loop-agent/tool-loop-processor.ts:39-127,320-349`. **So the canonical loop was read from `agent/agent.ts` + `loop/` per the EC-2 instruction.**

**Canonical loop state machine** (`loop/workflows/agentic-loop/index.ts`): the loop is a `.dountil` workflow step that returns `isContinued` to drive the next round. Per round it (a) accumulates the step into `accumulatedSteps` (`:152`); (b) if continuing, evaluates terminal predicates — `(Array.isArray(stopWhen) ? stopWhen : [stopWhen]).map(condition => condition({ steps }))`; `hasStopped = conditions.some(...)` — `references/mastra/packages/core/src/loop/workflows/agentic-loop/index.ts:154-168`; (c) enforces a `maxSteps` ceiling — `accumulatedSteps.length < rest.maxSteps` (`:230,240`); (d) fires `onIterationComplete` with `{ iteration, maxIterations, isFinal, finishReason }` (`:170-196`); (e) the round terminator: `return typedInputData.stepResult?.isContinued ?? false` (`:285`). The `StopCondition` type is **re-exported from AI SDK** (`StopConditionV5`/`StopConditionV6`) — `references/mastra/packages/core/src/loop/types.ts:5,9,47,151-152`. The continuation signal is `finishReason: 'tool-calls'` (continue) vs `'stop'` (terminate) — `references/mastra/packages/core/src/tool-loop-agent/__tests__/tool-loop-agent.test.ts:67,85`.

**Stream model:** the agent's public entry is `async stream(messages, options): Promise<MastraModelOutput<T>>` — `references/mastra/packages/core/src/agent/agent.ts:7386-7391`; when `untilIdle` is set it delegates to `runStreamUntilIdle` which **re-enters the agentic loop via `agent.stream([], ...)`** when a background task completes (`agent.ts:7413-7425,7531-7608`). Stream chunks are typed `ChunkType` and the workflow stream extends `ReadableStream<ChunkType>` — `references/mastra/packages/core/src/stream/MastraWorkflowStream.ts:1-10,79-82`, emitting `step-finish`/`finish` chunks (`agentic-loop/index.ts:270-277`). **State machine:** `round → model call → finishReason → { 'tool-calls' && !stopWhen && steps<maxSteps : continue ; else : terminate }`.

---

## Cross-cutting Comparison

| Dimension | Spring AI (`spring-ai-client-chat`) | Mastra (`@mastra/core`) | `@theokit/agents` (current) |
|---|---|---|---|
| **Construction (builder)** | `ChatClient.builder(model).default*(…).build()` → `new DefaultChatClient` (`DefaultChatClientBuilder.java:114-116`) | `new Agent({ id, model, tools, … })` plain constructor + `defaultOptions` (`tool-loop-processor.ts:118-127`) | Decorator-only: `@Agent`/`@MainLoop` metadata; **no builder twin** (`packages/agents/src/decorators/main-loop.ts:9-26`) |
| **Variable behavior (strategy)** | Advisor: ordered, short-circuit per-call interceptor (`CallAdvisor.adviseCall`, `Advisor.java:31-45`) | `inputProcessor`s + `prepareCall`/`prepareStep` hooks (`tool-loop-processor.ts:320-349`); loop terminal via `stopWhen` predicates | `strategy: 'simple-chat'\|'plan-act-reflect'\|'react'` **metadata only, never branched at runtime** (`packages/agents/src/types.ts:22-37`) |
| **Multi-round loop** | NONE at client layer (Advisor is per-call); tool loop is inside `ToolCallingAdvisor` | `agentic-loop` `.dountil` returns `isContinued`; `stopWhen({steps})` + `maxSteps` (`agentic-loop/index.ts:154-168,285`) | **Single-shot** — `delegate()` consumes one stream, no round re-entry, no `strategy` branch (`packages/agents/src/bridge/agent-orchestrator.ts:138-178`) |
| **Streaming** | `Flux<ChatClientResponse>` (Reactor); `adviseStream` (`BaseAdvisor.java:56-74`) — Java-only | `MastraModelOutput`/`ReadableStream<ChunkType>` (`MastraWorkflowStream.ts:1-10`); `agent.stream()` (`agent.ts:7386`) | `createSdkAgentStream` → `Run.stream()` async iterable (`agent-orchestrator.ts:159,165`) |
| **DI-coupling** | **Builder standalone (zero `@Autowired`)**; DI is a *separate* opt-in auto-config module (`DefaultChatClientBuilder.java:63-65`; `ChatClientAutoConfigurationTests.java:45-46`) | Standalone constructor; no container | No IoC by mandate (ADR 0031 / G2); bridge compiles, SDK executes (`sdk-runtime.md`) |
| **Testing** | Mockito `@Mock ChatModel` + `mock(CallAdvisor)`; assert `getOrder()`/chain dispatch (`DefaultAroundAdvisorChainTests.java:99-120`) | `MockLanguageModelV3` w/ `callCount`-switched `finishReason`; assert `steps.length` (`tool-loop-agent.test.ts:57-139,423`) | `createMockAgentStream()` permitted (`sdk-runtime.md`); no loop test yet (single-shot) |

---

## Recommendations

One concrete decision proposal per research question, anchored to what exists today and compiled per ADR 0031.

- **Q1 → `AgentRunner.builder()` (imperative twin of `@MainLoop`).** Adopt Spring's builder→executable shape, TS-flavored. Proposed shape:
  ```ts
  AgentRunner
    .builder(MyAgentClass)            // walks decorator metadata (walkAgentMetadata)
    .reflection(myReflectionStrategy) // optional, overrides @MainLoop strategy
    .compaction(myCompactionPolicy)   // optional (M2 @ContextWindow already runtime)
    .stream()                         // selects Run.stream() vs Run.send()
    .build()                          // → AgentRunner (compiled, ready to run)
  ```
  `build()` is the compile boundary: it produces a `CompiledAgent` (same struct `compileAgent()` emits today — `packages/agents/src/bridge/agent-compiler.ts`) plus a resolved `LoopStrategy`. No new transport; `run()` delegates to `createSdkAgentStream` (`agent-orchestrator.ts:159`). The decorator path (`@MainLoop`) and the builder path produce the **same** `CompiledAgent` — two on-ramps, one runtime (mirrors Spring's `clone()`/`mutate()` parity, `DefaultChatClientBuilder.java:118-120`).

- **Q2 → `LoopStrategy` contract (NOT modeled on Advisor — EC-4).** Model the terminal predicate on Mastra's `stopWhen`, not Spring's `adviseCall`. Zod-validated config (type-safety G3, SSoT). Proposed:
  ```ts
  interface LoopOutcome {            // shape mirrors agentic-loop step result
    finishReason: 'tool-calls' | 'stop' | 'length' | 'error'
    round: number                    // accumulatedSteps.length
    toolCalls: ToolCallRecord[]
  }
  interface LoopStrategy {
    readonly name: 'simple-chat' | 'plan-act-reflect' | 'react'
    shouldContinue(outcome: LoopOutcome): boolean   // ⇐ Mastra stopWhen({steps}) inverted
    readonly maxIterations: number                  // ⇐ Mastra maxSteps ceiling
  }
  ```
  `simple-chat` = `shouldContinue` always `false` (one round); `react`/`plan-act-reflect` = `finishReason === 'tool-calls' && round < maxIterations`. Cite: terminal logic `agentic-loop/index.ts:154-168,285`; `maxSteps` `:230,240`. The existing `@MainLoop({ maxIterations })` field (`types.ts:25-26`) feeds `maxIterations`.

- **Q3 → multi-round runtime in the bridge orchestrator.** Replace the single-shot consume in `delegate()` (`agent-orchestrator.ts:164-167`) with a loop that, per round, consumes one `Run.stream()` turn, builds a `LoopOutcome`, and re-enters with the tool result when `strategy.shouldContinue(outcome)` — bounded by `maxIterations`. This is the theokit analog of Mastra `runStreamUntilIdle` re-entering via `agent.stream([], …)` (`agent.ts:7531-7608`). **The loop machinery stays inside the bridge; the model call + tool execution stay inside the SDK (`Run.stream()`) — no LLM `fetch`, no re-implemented tool loop (G2/`sdk-runtime.md`).**

- **Q4/Q5 → testing.** Unit-test `LoopStrategy.shouldContinue` as a pure function (table-driven, like `SimpleLoggerAdvisorTests.getOrder`, `SimpleLoggerAdvisorTests.java:102`). Integration-test the loop with a `createMockAgentStream()` whose round 1 emits a tool-call event (no terminal) and round 2 emits `finish`, then assert exactly 2 rounds ran — the theokit port of `tool-loop-agent.test.ts:389-423` (`expect(steps.length).toBe(2)`). TDD-first per `testing.md`.

- **Q6 → keep standalone, no IoC.** `AgentRunner.builder()` is a plain TS class (no container), proven viable by Spring's zero-`@Autowired` builder (`DefaultChatClientBuilder.java:63-65`) and Mastra's plain `new Agent({...})`. Reuse `@theokit/sdk` deps only; add **zero** new runtime deps and **no** reflect-metadata beyond what decorators already use (ADR 0031).

- **Q7 → `@theokit/starter-*` as a factory, not auto-config.** Ship an opinionated default as an exported factory returning a pre-configured `AgentRunner.builder()` the app can use or override per-call — the portable kernel of Spring's `@ConditionalOnMissingBean` default (`ChatClientAutoConfiguration.java:112-129`). **Do NOT** port `@AutoConfiguration`/`AutoConfiguration.imports`/prototype beans (EC-3 non-portable — they need an IoC container).

- **`ReflectionStrategy` contract (mandatory deliverable).** A reflection step mutates the next prompt between rounds (the portable half of Spring's `before()`), but the re-entry decision is a loop concern:
  ```ts
  interface ReflectionStrategy {
    readonly name: string
    reflect(outcome: LoopOutcome): { feedback?: string; continue: boolean }  // ⇐ Mastra onIterationComplete → {feedback, continue}
  }
  ```
  Cite: Mastra's `onIterationComplete` returns `{ feedback, continue }` consumed by the loop (`agentic-loop/index.ts:199-247`). `ReflectionStrategy` composes INTO `LoopStrategy` (the loop calls `reflect()` then `shouldContinue()`), it does not replace it.

- **YAGNI/KISS guard (G11).** Ship `LoopStrategy` with the **2 real implementations** that exist as `@MainLoop` strategy values today (`simple-chat` single-round + `react` multi-round) — not a speculative plugin system. `plan-act-reflect` only ships if it has a distinct `shouldContinue` from `react`; otherwise collapse them (Rule of 3). The interface is justified by ≥2 concrete impls (G11 single-implementor WARN avoided).

---

## ADRs

### D1 — Model `LoopStrategy` on Mastra's `agentic-loop`/`stopWhen`, NOT Spring's Advisor (EC-4)

**Decision:** The `@MainLoop` runtime's terminal-decision contract (`LoopStrategy.shouldContinue(outcome)` + `maxIterations`) is modeled on Mastra's canonical agentic loop (`stopWhen({ steps })` predicate + `maxSteps` ceiling, `references/mastra/packages/core/src/loop/workflows/agentic-loop/index.ts:154-168,285`), explicitly NOT on Spring AI's `CallAdvisor.adviseCall` (`references/spring-ai/spring-ai-client-chat/src/main/java/org/springframework/ai/chat/client/advisor/api/CallAdvisor.java:30-34`).

**Rationale:** Spring's Advisor is a per-single-call interceptor (middleware: `before → chain.nextCall → after`, `BaseAdvisor.java:46-54`); our requirement is a decision *between rounds* of a tool-using loop. Mapping a multi-round concern onto a per-call interceptor is the wrong shape (EC-4). Mastra's loop is the SOTA multi-round model in the same TS/AI-SDK ecosystem theokit already depends on.

**Alternatives considered:** (a) `LoopStrategy = Advisor` — rejected (EC-4: per-call ≠ multi-round). (b) Re-implement a loop ad-hoc — rejected (DRY/G2: the round-driving + tool execution stay in `@theokit/sdk Run.stream()`; only the *terminal decision* is new).

**Project rule cited:** `sdk-runtime.md` (bridge compiles / SDK executes / no re-implemented tool loop, ADR 0031) + `architecture.md` G2 + KISS (smallest contract that captures round→outcome→{continue,terminate}).

### D2 — Builder + Decorator are two on-ramps to ONE compiled runtime; standalone, no IoC

**Decision:** `AgentRunner.builder(AgentClass).reflection(...).compaction(...).stream().build()` and the `@MainLoop` decorator both compile to the same `CompiledAgent` + resolved `LoopStrategy`, executed by `Agent.create()`/`Run.stream()`. The builder is a plain standalone TS class — no IoC container, no `@AutoConfiguration`, no new reflect-metadata.

**Rationale:** Spring proves the builder works **standalone** (zero `@Autowired` in `DefaultChatClientBuilder.java:63-65`; DI relegated to a separate opt-in module, `ChatClientAutoConfigurationTests.java:45-46`). Mastra confirms in TS (`new Agent({...})`). The current `@MainLoop` is metadata-only (`packages/agents/src/decorators/main-loop.ts:9-26`) and the orchestrator is single-shot (`packages/agents/src/bridge/agent-orchestrator.ts:138-178`) — the builder gives the imperative twin without forking the runtime. Zod is the SSoT for the strategy config (`type-safety.md` G3).

**Alternatives considered:** (a) Port Spring Boot auto-config (`@ConditionalOnMissingBean`, `AutoConfiguration.imports`) — rejected, EC-3 non-portable (needs an IoC container, forbidden by ADR 0031); the portable substitute is an exported factory function (Q7 recommendation). (b) Builder-only, drop the decorator — rejected (the decorator on-ramp already ships and is mandatory per `walk-agent-metadata.ts`).

**Project rule cited:** `architecture.md` INVARIANT #3 (public API through barrels; `agents → http`, never core, G1) + ADR 0030 direction + `sdk-runtime.md` ADR 0031 (no IoC) + G11 YAGNI (interface justified by ≥2 real strategy impls).

---

## Blocked questions (if any)

None. All 7 research questions answered with verified `path:line` citations. Fase A returned ≥1 hotspot for every question on the first or second query variant; no question hit the 3-retry exhaustion.
