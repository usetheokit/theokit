# @theokit/agents

## 0.20.0

### Minor Changes

- 45f229a: V4-T: `delegate()` carries the same per-run config surface as `AgentRunner.stream()`.

  `DelegateOptions` gains optional `model`/`cwd`/`plugins`/`providers`/`agents`/`budgetTracker`/`conversationStorage`/`sdkTools`/`retry`/`reflection`/`maxIterations`, and `delegate()` forwards them to `createSdkAgentStream` (the model opt wins over the sub-agent's `@Agent` model) + the reflective loop (retry; custom reflection overriding the strategy-derived ladder/noop; `maxIterations` re-resolves the loop ceiling). The two on-ramps to the shared `runReflectiveLoop` driver now expose the same per-run surface, so a sub-agent inherits the parent's runtime config (providers, mode-selected permission plugin, working dir, pre-built SDK tools). Additive + backward-compatible: absent fields ⇒ byte-identical to before (decorator model only; strategy-derived reflection; no retry). The fields were already accepted by the adapter's `RuntimeOverrides` + the loop's `RunReflectiveLoopConfig` — pure forwarding, no new dependency (Rule 9). Unblocks an app delegating to a sub-agent without losing per-run config.

## 0.19.0

### Minor Changes

- 01e9ea8: V4-S: `plan-act-reflect` defers the continuation decision to the `ReflectionStrategy`.

  `resolveLoopStrategy('plan-act-reflect')`'s `shouldContinue` is now `round < maxIterations` (instead of the `finishReason === 'tool-calls'` gate). The reflective loop ANDs `reflection.continue` with `shouldContinue`, so this lets a custom `ReflectionStrategy` extend even a terminal (`stop`) round — e.g. "you answered without editing any file; make the edit now" — within the iteration ceiling. Backward-compatible with the shipped `ladderReflectionStrategy` (which itself returns `continue: true` only on `tool-calls`, so the observable behavior with the default ladder is unchanged). `react` is unchanged (the `noop` reflection means the strategy stays the gate: continue only on `tool-calls`). Closes the last seam for an app whose reflection ladder fires on final-answer rounds (theocode's `reflect_no_edit`/`verify`/`fix`).

## 0.18.0

### Minor Changes

- 6d02c56: V4-R: `AgentRunner` accepts an injectable `RoundStreamFactory` via `run-options.streamFactory`.

  `AgentRunnerRunOptions.streamFactory?: RoundStreamFactory` drives the reflective loop with a caller-provided per-round stream INSTEAD of `createSdkAgentStream` (for tests or a custom transport). When set, the SDK-create options (`tools`/`sdkTools`/`model`/`cwd`/...) are not used for that call — the consumer owns the stream. Absent ⇒ the SDK adapter (the default runtime), byte-identical to before. `RoundStreamFactory` (`(message, sessionId) => AsyncIterable<StreamEvent>`) is now exported from the package barrel so consumers can type their factory (the loop DRIVER `runReflectiveLoop` stays internal). Lets an app adopt `AgentRunner.stream()` while keeping its existing stream-injection tests — closes the last adoption seam the theocode discover found. Additive + backward-compatible; no new dependency.

## 0.17.0

### Minor Changes

- 6ec6124: V4-Q: `AgentRunner` accepts pre-built SDK `CustomTool[]` via `run-options.sdkTools`.

  `AgentRunnerRunOptions.sdkTools?: readonly CustomTool[]` (and `RuntimeOverrides.sdkTools`) forwards already-built SDK tools RAW to `Agent.create.tools`, appended after the `@Tool`-compiled tools, bypassing `defineTool` (which requires a Zod schema). Lets an app whose tools come from imperative SDK factories (`@theokit/sdk-tools` → `CustomTool[]`, JSON-Schema `inputSchema`, no recoverable Zod) adopt `AgentRunner.stream()` — closes the last tool-sourcing gap the theocode loop-adoption discover found. Additive + backward-compatible: absent ⇒ the compiled-tools path is byte-identical; distinct from `tools` (which REPLACES the compiled set). No new dependency (Rule 9).

## 0.16.0

### Minor Changes

- 208ea7f: V4-P: per-round transient retry in the reflective loop.

  `AgentRunnerRunOptions.retry?: RetryOptions` (and `RunReflectiveLoopConfig.retry`) opt into retrying a transient failure at a round START — the factory creation + first event, before any event is yielded, so a recovered 429/5xx/network blip never re-applies an edit. Reuses the SDK `withRetry` (`@theokit/sdk/retry`, default `isRetryable: isTransientError`), dynamic-imported only when `retry` is set so the loop stays SDK-optional. Once an event is yielded, a throw propagates (exactly-one-terminal + no double-edit preserved). Absent ⇒ single attempt (backward-compatible). Lets a consumer (theocode) keep its per-continuation-round retry safety when it adopts `AgentRunner.stream()`. No new dependency (Rule 9).

## 0.15.0

### Minor Changes

- d69f7b4: V4-O: forward the SDK reasoning/cache token buckets through the adapter `done` event and `DelegationResult`.

  `realUsageDone` (`createSdkAgentStream`) now reads `reasoningTokens`/`cacheReadTokens`/`cacheWriteTokens` from `RunResult.usage` and includes them on the `done` event (0 when the provider omits them); the reflective loop folds them per round and accumulates them into `DelegationResult` (alongside the V4-N split usage). The typed `DoneEvent.usage` declares the three optional buckets. Additive + backward-compatible: existing fields unchanged, the new fields are optional, absent buckets default to 0. Lets a consumer (theocode's `LlmUsage`) keep full per-turn usage when it adopts `AgentRunner.stream()` — closes the usage-richness regression the loop-adoption discover found. Reuses the `RunResult.usage` already read by `run.wait()` (Rule 9); no new dependency.

## 0.14.0

### Minor Changes

- 6f1a757: V4-N: the reflective loop now exposes faithful per-round tool calls + split token usage, so a custom `ReflectionStrategy` (and `DelegationResult` consumers) can read the tool-call command, correlate by id, and map split usage.

  - `LoopOutcome.toolCalls` / `DelegationResult.toolCalls` entries now carry `{ id, name, input, output }` — `input` is the tool-call args (correlated from the `tool_call` event by callId), no longer always `{}`, and `id` is the call id.
  - `DelegationResult` now carries `tokensInput` / `tokensOutput` (accumulated across rounds); `tokens` (total) is preserved.

  Additive + backward-compatible (existing fields unchanged; new fields are optional on `DelegationResult`). `consumeOneRound` correlates each round's `tool_call` events (which carry the input/command) with their `tool_result` events (which carry the output) by callId; an unmatched result degrades to `input: {}` (no worse than before). The tool-call id+input half flows on the real SDK path. NOTE: the split-usage half is plumbing — the SDK adapter must emit real per-turn token counts on the `done` event for `tokensInput`/`tokensOutput` to be non-zero (today it emits zeros, unchanged from before; a follow-up). Unblocks a consumer's verify-before-finish / fix-failed-test ladder + tool persistence that need the command and the id.

### Patch Changes

- a4e1c25: V4-N.1: `createSdkAgentStream` now emits the SDK Run's REAL token usage on the `done` event.

  It reads `run.wait()` after the stream and emits one `done` carrying the real `TokenUsage` (`inputTokens`/`outputTokens`/derived `totalTokens`) + `cost`, suppressing the stream's zero-usage `done`. This completes V4-N's split-usage story end-to-end: `DelegationResult.tokens`/`tokensInput`/`tokensOutput` now report real values on the real SDK path (previously hardcoded to 0). An error round skips the `wait()` re-emit (exactly-one-terminal); a `wait()` rejection surfaces as an `error` (fail-loud). Additive; reuses the SDK's documented `run.wait()` (Rule 9); no new dependency.

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
