# @theokit/agents

## 0.13.0

### Minor Changes

- 8811577: V4-M: `AgentRunner.stream()` reflective-loop rounds now share a persisted SDK session, so round N+1 sees what rounds 1..N read and did.

  - Each round resumes the same session via `Agent.getOrCreate(sessionId, { conversationStorage })` with ONE shared `conversationStorage` created per run (default `InMemoryConversationStorage` — per-run, no disk), survivable across the per-round agent dispose.
  - Rounds 2+ no longer re-send the original task — the persisted session carries it; the round-2+ prompt is the reflection block (or a short continuation). Round 1 sends the original message unchanged.
  - New `AgentRunnerRunOptions.conversationStorage` (and `RuntimeOverrides.conversationStorage`) lets an app plug a `FileSystemConversationStorage`/custom adapter for durable cross-run history.

  **Behavior change (fix):** previously each round created a fresh, memoryless agent (history was NOT carried across rounds) — a multi-round reflective loop whose rounds could not see prior tool results. Rounds are now stateful by default. This reuses the SDK's own session-persistence primitives (Rule 9); no new dependency. It unblocks consumers (e.g. a code agent) adopting `AgentRunner.stream()` for continuation loops. The `delegate()` sub-agent path shares the same loop driver, so sub-agent delegation rounds gain session memory too.

## 0.12.0

### Minor Changes

- 47dd837: V4-L.3: `AgentRunner.stream()/run()` complete the per-request `Agent.create` surface with four more `AgentRunnerRunOptions` fields (Axis-A / SWAP), each forwarded to the SDK when present — parallel to the existing `tools`/`model`/`cwd`/`maxIterations`.

  - **`plugins`** (`PluginsSettings`) — per-request plugins (e.g. a permission gate selected by request mode).
  - **`providers`** (`ProviderRoutingSettings`) — per-request provider routing.
  - **`agents`** (`Record<string, AgentDefinition>`) — per-request sub-agent definitions (opts-only; `@SubAgents` compiled agents stay deferred).
  - **`budgetTracker`** (`BudgetTracker`) — per-request SDK budget tracker capping the INNER tool-loop per send (distinct from the OUTER reflective-loop USD `budget`).

  Internals: `createSdkAgentStream`'s per-request parameters are collapsed into a single `RuntimeOverrides` object (subsuming the prior `envModel`/`cwd` positionals) to avoid a parameter explosion; the model now resolves at a single site (`overrides.model ?? compiled.model ?? default`). Backward-compatible (absent fields ⇒ no `Agent.create` key; the 3-arg `createSdkAgentStream` call still compiles); no new dependency. With this slice the full per-request surface theocode needs is expressible through `AgentRunner`.

## 0.11.0

### Minor Changes

- b1c6a71: V4-L.2: `AgentRunner.stream()/run()` accept three per-request overrides on `AgentRunnerRunOptions` (Axis-A / SWAP), each merge-over-compiled, parallel to the V4-J `tools` override.

  - **`model`** — overrides the compiled model for this call (`opts.model ?? compiled.model ?? default`).
  - **`cwd`** — forwarded into `Agent.create({ local: { cwd } })`, so the SDK populates `SystemPromptContext.cwd` (read by a V4-L.1 `SystemPromptResolver` / `@ProjectContext`). Absent ⇒ no `local.cwd`.
  - **`maxIterations`** — overrides the reflective-loop ceiling for this call by re-resolving the loop strategy (zod-validated — `< 1` throws, never a silent unbounded loop); the build-time strategy is not mutated. Terminal `step_limit` when the override stops a would-continue round.

  All three are backward-compatible (absent ⇒ build-time defaults); a `{ apiKey }`-only call and existing `tools` overrides behave exactly as before. No new dependency.

## 0.10.0

### Minor Changes

- 13a4abc: V4-L.1: `@Agent`'s `systemPrompt` now accepts a per-request `SystemPromptResolver`, not just a static string.

  - `@Agent({ systemPrompt: (ctx) => ... })` declares a prompt COMPUTED per request (from project rules, memory, cwd, etc.); the SDK invokes the resolver each send with the run's `SystemPromptContext`. A plain string still works unchanged (backward-compatible union widening — `string | SystemPromptResolver`).
  - The resolver flows byref through the compile boundary (`compileAgent` → `CompiledAgentOptions.systemPrompt`) into `Agent.create` — no translation, no new dependency (the type is the SDK's own `SystemPromptResolver`).
  - `@ProjectContext` now COMPOSES with a resolver base: env + repo map + project instructions are prepended to the resolved base output (resolve-then-prepend); a failing base resolver propagates (fail-loud). Previously `base` was `string`-only.
  - This is Axis-B (computed-per-request config) of the dynamic-`@Agent` design and closes the long-standing M8 edge case where the decorator could only carry a static prompt. Sub-agent resolver execution remains out of scope (the type is carried, not invoked).

## 0.9.0

### Minor Changes

- 079f725: V4-J + V4-K: two backward-compatible `AgentRunner` hooks that unblock loop adoption by apps with per-request tools and stateful reflection.

  - **V4-J — runtime tool override:** `AgentRunner.stream(message, opts)` / `run(...)` accept `opts.tools?: readonly CompiledTool[]` that replaces the build-time `compiled.tools` for that call only (a consumer selecting tools by request mode/permission). Absent ⇒ the agent's compiled tools (unchanged). Decorators and the compile path are untouched.
  - **V4-K — ReflectionContext:** `ReflectionStrategy.reflect(outcome, ctx?)` now receives a per-run mutable `ReflectionContext` (a generic scratch bag). The reflective loop creates ONE per run and passes the SAME reference to every round, so a stateful custom strategy can accumulate cumulative state (counters, one-shot flags). The framework writes nothing app-specific into it (the strategy owns the contents). `ctx` is optional — shipped `ladderReflectionStrategy`/`noopReflectionStrategy` and existing custom strategies are unaffected.

## 0.8.0

### Minor Changes

- 0620275: V4-D-stream: the reflective `@MainLoop` runtime now streams events live. `AgentRunner` gains a `stream(message, opts)` method that yields each round's events incrementally (the on-ramp for SSE-first apps) while still returning the aggregated result. `run()` is unchanged for callers — it drains the stream internally. Fully backward-compatible: the collect-mode `delegate()` path is untouched.
- 0620275: V4-F: a named, callable `TranscriptCompactionStrategy` authoring layer. `@Compaction('token-budget', { keepTokens })` (and `AgentRunner.builder(...).compaction(...)`) resolve a strategy exposed as `runner.compaction`, which the app calls directly — `runner.compaction?.compact(messages, { summarize })`. The `'token-budget'` strategy delegates to the SDK's `compactTranscript` (no reimplementation — the SDK owns the algorithm); the app keeps when-to-compact and the summarize callback. Compaction is opt-in (`runner.compaction` is `undefined` when undeclared); the builder override wins over the decorator. Requires `@theokit/sdk >= 2.9.0` (the `keepTokens` token-budget mode).

## 0.7.0

### Minor Changes

- V4-D — `@MainLoop` react/plan-act-reflect loops gain two outer-loop terminals on `LoopStrategy`, surfaced on `DelegationResult.finishReason`: `no_progress` (the loop ends when the agent repeats the same round signature — sorted, key-canonical tool-call set + text — for 2 consecutive rounds, so a stuck agent no longer drains the whole `maxIterations` budget) and `step_limit` (the loop reports when it stopped at the `maxIterations` ceiling, distinct from a natural `stop`, and injects a graceful "summarize, no more tools" prompt hint on the final round — modeled on opencode's `MAX_STEPS_PROMPT`). Both fire on both on-ramps (`delegate()` + `AgentRunner`) via the shared `runReflectiveLoop`; no new dependency, no `@theokit/sdk` change. Derived from the codex/opencode agent-loop study — neither implements no-progress, so it is a theokit value-add.

## 0.6.0

### Minor Changes

- d9012b4: V4-B/V4-C — `@MainLoop({ strategy })` gets a real multi-round reflective runtime (was metadata-only). A Zod-validated `LoopStrategy`/`ReflectionStrategy` contract + a shared `runReflectiveLoop` driver give the strategy field execution: `simple-chat` ⇒ one round (unchanged); `react`/`plan-act-reflect` ⇒ multi-round bounded by `maxIterations` (forced terminal at the ceiling), with a degenerate/empty round terminating as `stop`. Both on-ramps — `delegate()` (decorator) and `AgentRunner.builder()` (imperative twin) — route through the same driver, so the runtime metric, cumulative budget, typed errors and result shape are identical (ADR D4). The loop lives in the bridge while the model call stays in the SDK `Run.stream()` (no second runtime, ADR 0031). Modeled on Mastra's `agentic-loop`/`stopWhen` + `maxSteps` ceiling.

  Also fixes the `event-translator` against the real `@theokit/sdk` `SDKMessage` union: assistant content is read from `msg.message.content`, the cloud-run status enum is matched UPPERCASE (`FINISHED`/`CANCELLED` → done, `ERROR`/`EXPIRED` → error — fail-loud), `tool_call` uses `call_id`, and `thinking` reads `msg.text`. Previously a live SDK run returned an empty response and silently swallowed `ERROR`. The adapter's fallback `done` is now conditional so a translated `FINISHED` does not double-emit the terminal.

## 0.5.0

### Minor Changes

- fa1518b: M8 — declarative decorators get SDK-backed runtime. `@Skills`, `@ContextWindow`, and `@ProjectContext` are no longer metadata-only: the bridge compiles each into a native `@theokit/sdk` `Agent.create()` field (`skills` → `SkillsSettings`, `@ContextWindow` → `ContextSettings.maxTokens`, `@ProjectContext` → a `systemPrompt` resolver composing the env block + repo map + nearest `THEO.md` via `@theokit/sdk-tools` + `@theokit/sdk/project`), and the SDK executes it (the bridge compiles; the SDK runs — `sdk-runtime.md`). Decorator knobs with no native SDK mapping now emit a stable `THEO_AGENT_*_METADATA_ONLY` warning at compile time instead of silently doing nothing. Requires `@theokit/sdk >= 2.5.0`; adds `@theokit/sdk-tools` as an optional peer.
