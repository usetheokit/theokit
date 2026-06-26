/**
 * AgentRunner — the imperative twin of `@MainLoop` (plan ADR D4, V4-B).
 *
 * `AgentRunner.builder(AgentClass).reflection().stream().build()` walks +
 * compiles the agent and resolves the SAME `{ compiled, loopStrategy }` that
 * `delegate()` resolves for the decorator path (two on-ramps, one runtime).
 * `build()` is the compile boundary (no I/O, no IoC — standalone, mirrors
 * Spring's `ChatClient.builder(...).build()`); `stream()`/`run()` do the I/O via
 * `runReflectiveLoopStream` (the SAME loop `delegate()` drains — DRY, ADR 0031).
 * V4-D-stream: `stream()` yields events live (SSE-first); `run()` drains it to a result.
 *
 * referencia: knowledge-base/references/spring-ai DefaultChatClientBuilder.java (build() returns standalone).
 */
import type {
  AgentDefinition,
  BudgetTracker,
  ConversationStorageAdapter,
  CustomTool,
  PluginsSettings,
  ProviderRoutingSettings,
} from '@theokit/sdk'
import type { RetryOptions } from '@theokit/sdk/retry'

import {
  type CompiledAgentOptions,
  type CompiledTool,
  compileAgent,
} from '../bridge/agent-compiler.js'
import type { StreamEvent } from '../bridge/agent-sse-handler.js'
import type { DelegationResult } from '../bridge/delegation-types.js'
import { createSdkAgentStream } from '../bridge/sdk-adapter.js'
import { walkAgentMetadata } from '../bridge/walk-agent-metadata.js'

import {
  resolveCompactionStrategy,
  type TranscriptCompactionStrategy,
} from './compaction-strategy.js'
import { type LoopStrategy, resolveLoopStrategy } from './loop-strategy.js'
import {
  ladderReflectionStrategy,
  noopReflectionStrategy,
  type ReflectionStrategy,
} from './reflection-strategy.js'
import { runReflectiveLoopStream } from './run-reflective-loop.js'

/** Options for {@link AgentRunner.run}. */
export interface AgentRunnerRunOptions {
  /** LLM API key. */
  readonly apiKey: string
  /** Session id override (default: a fresh isolated id). */
  readonly sessionId?: string
  /** Cumulative USD budget across rounds. */
  readonly budget?: number
  /** Cancellation — aborts stop the reflective loop from re-entering. */
  readonly signal?: AbortSignal
  /**
   * V4-J: per-run tool override. When provided, REPLACES the build-time
   * `compiled.tools` for this call only (e.g. a consumer that selects tools by
   * request mode/permission). Absent ⇒ the agent's compiled tools (unchanged).
   */
  readonly tools?: readonly CompiledTool[]
  /**
   * V4-L.2 (Axis-A SWAP): per-run model override. Merge-over-compiled —
   * `opts.model ?? compiled.model ?? default`. Absent ⇒ the compiled model.
   */
  readonly model?: string
  /**
   * V4-L.2 (Axis-A SWAP): per-run working directory, forwarded into
   * `Agent.create({ local: { cwd } })` so the SDK populates `SystemPromptContext.cwd`
   * (read by a `SystemPromptResolver` / `@ProjectContext`). Absent ⇒ no `local.cwd`.
   */
  readonly cwd?: string
  /**
   * V4-L.2 (Axis-A SWAP): per-run loop-ceiling override. When provided, the loop
   * strategy is re-resolved with this ceiling for this call only (zod-validated —
   * `< 1` throws, never a silent unbounded loop). Absent ⇒ the build-time ceiling.
   */
  readonly maxIterations?: number
  /** V4-L.3 (Axis-A SWAP): per-run plugins (e.g. permission gate by request mode). */
  readonly plugins?: PluginsSettings
  /** V4-L.3 (Axis-A SWAP): per-run provider routing. */
  readonly providers?: ProviderRoutingSettings
  /** V4-L.3 (Axis-A SWAP): per-run sub-agent definitions (opts-only; @SubAgents stays deferred). */
  readonly agents?: Record<string, AgentDefinition>
  /**
   * V4-L.3 (Axis-A SWAP): per-run SDK budget tracker — caps the INNER SDK tool-loop per
   * send. Distinct from {@link AgentRunnerRunOptions.budget} (the OUTER reflective-loop USD ceiling).
   */
  readonly budgetTracker?: BudgetTracker
  /**
   * V4-M: conversation store shared across the loop's rounds so history persists (round N+1
   * sees rounds 1..N). Default `InMemoryConversationStorage` (per-run, no disk). Pass a
   * `FileSystemConversationStorage`/custom adapter for durable cross-run history.
   */
  readonly conversationStorage?: ConversationStorageAdapter
  /**
   * V4-Q: pre-built SDK `CustomTool[]` forwarded RAW to `Agent.create.tools` (appended after the
   * agent's compiled tools), bypassing `defineTool`. For an app whose tools come from imperative
   * SDK factories (no `@Tool` compile path / no recoverable Zod schema). Distinct from `tools`
   * (which REPLACES the compiled `CompiledTool[]`).
   */
  readonly sdkTools?: readonly CustomTool[]
  /**
   * V4-P: per-round transient retry. When set, the START of each reflective round (factory
   * creation + first event, before any event is yielded) is wrapped in the SDK `withRetry` —
   * a 429/5xx/network blip is recovered without re-applying an edit. Absent ⇒ single attempt.
   * Default `isRetryable` is the SDK `isTransientError`.
   */
  readonly retry?: RetryOptions
}

/**
 * A built, runnable agent. Construct via {@link AgentRunner.builder} — the
 * constructor takes already-resolved state and is an internal detail.
 */
/** Already-resolved state handed to the {@link AgentRunner} constructor (internal). */
export interface AgentRunnerState {
  readonly compiled: CompiledAgentOptions
  readonly agentName: string
  /** The resolved terminal-decision strategy (parity with `delegate()`). */
  readonly loopStrategy: LoopStrategy
  /** The resolved between-round reflection (default or `.reflection(custom)` override). */
  readonly reflectionStrategy: ReflectionStrategy
  /** Recorded streaming preference (see {@link AgentRunner.streamEnabled}). */
  readonly streamEnabled: boolean
  /** The resolved compaction strategy, or `undefined` when none is declared (EC-4). */
  readonly compaction?: TranscriptCompactionStrategy
}

export class AgentRunner {
  private readonly compiled: CompiledAgentOptions
  private readonly agentName: string
  /** The resolved terminal-decision strategy (parity with `delegate()`). */
  readonly loopStrategy: LoopStrategy
  /** The resolved between-round reflection (default or `.reflection(custom)` override). */
  readonly reflectionStrategy: ReflectionStrategy
  /**
   * Recorded streaming preference. The reflective loop currently always streams via
   * the SDK `Run.stream()`; a non-streaming collect mode is future work — the flag is
   * captured + exposed here, not yet branched on (honest per G10: documented, not a
   * silent no-op).
   */
  readonly streamEnabled: boolean
  /**
   * V4-F: the resolved compaction strategy (from `@Compaction` or `.compaction()`),
   * or `undefined` when neither is declared — compaction is opt-in (EC-4). CALLABLE
   * by the app (ADR D1: `runner.compaction?.compact(messages, { summarize })`); the
   * reflective loop does NOT auto-invoke it (the SDK owns per-turn context).
   */
  readonly compaction?: TranscriptCompactionStrategy

  constructor(state: AgentRunnerState) {
    this.compiled = state.compiled
    this.agentName = state.agentName
    this.loopStrategy = state.loopStrategy
    this.reflectionStrategy = state.reflectionStrategy
    this.streamEnabled = state.streamEnabled
    this.compaction = state.compaction
  }

  /** Start a fluent builder for `AgentClass`. */
  static builder(AgentClass: Function): AgentRunnerBuilder {
    return new AgentRunnerBuilder(AgentClass)
  }

  /**
   * V4-D-stream: stream the agent's events LIVE across the reflective loop, returning
   * the aggregated {@link DelegationResult} as the generator's return value. This is the
   * on-ramp for streaming-first apps (SSE) — `runReflectiveLoopStream` yields every
   * round's events before the loop terminates. `streamEnabled` is honored: when the
   * builder set `.stream(false)`, callers should use {@link run} instead.
   */
  stream(
    message: string,
    opts: AgentRunnerRunOptions,
  ): AsyncGenerator<StreamEvent, DelegationResult> {
    // V4-J: per-run tool override replaces compiled.tools for this call only.
    const tools = opts.tools ? [...opts.tools] : this.compiled.tools
    // Re-resolve the ceiling per call (zod fail-loud on `< 1`); preserve the strategy name.
    const loop =
      opts.maxIterations != null
        ? resolveLoopStrategy(this.loopStrategy.name, opts.maxIterations)
        : this.loopStrategy
    // V4-L.2 + V4-L.3 (Axis-A SWAP): the per-request overrides forwarded to Agent.create.
    // `model` resolves against compiled.model in the adapter (single resolution site).
    const streamFactory = createSdkAgentStream(this.compiled, tools, opts.apiKey, {
      model: opts.model,
      cwd: opts.cwd,
      plugins: opts.plugins,
      providers: opts.providers,
      agents: opts.agents,
      budgetTracker: opts.budgetTracker,
      conversationStorage: opts.conversationStorage,
      sdkTools: opts.sdkTools, // V4-Q: pre-built SDK tools forwarded raw
    })
    const sessionId = opts.sessionId ?? `runner-${crypto.randomUUID()}`
    return runReflectiveLoopStream(streamFactory, message, sessionId, {
      loop,
      reflection: this.reflectionStrategy,
      budget: opts.budget,
      agentName: this.agentName,
      signal: opts.signal,
      retry: opts.retry, // V4-P: per-round transient retry (opt-in)
    })
  }

  /** Run the agent to a terminal result via the shared reflective loop (collect mode). */
  async run(message: string, opts: AgentRunnerRunOptions): Promise<DelegationResult> {
    const gen = this.stream(message, opts)
    let res = await gen.next()
    while (!res.done) res = await gen.next()
    return res.value
  }
}

/** Fluent builder — accumulates config; `build()` is the compile boundary. */
export class AgentRunnerBuilder {
  private reflectionOverride?: ReflectionStrategy
  private streamEnabled = true
  private compactionOverride?: { name: string; keepTokens?: number }

  constructor(private readonly AgentClass: Function) {}

  /** Override the default reflection strategy (OCP — plan Drawback #2). No arg ⇒ keep default. */
  reflection(strategy?: ReflectionStrategy): this {
    if (strategy) this.reflectionOverride = strategy
    return this
  }

  /** Record the streaming preference (see {@link AgentRunner.streamEnabled}). */
  stream(enabled = true): this {
    this.streamEnabled = enabled
    return this
  }

  /**
   * V4-F: declare the compaction strategy (e.g. `.compaction('token-budget', { keepTokens: 8000 })`).
   * Resolved + validated at {@link build} (EC-5 — fail-fast there, not here). This builder
   * call WINS over a `@Compaction` decorator on the same agent (EC-1 — explicit override).
   */
  compaction(name: string, options: { keepTokens?: number } = {}): this {
    this.compactionOverride = { name, keepTokens: options.keepTokens }
    return this
  }

  /** Walk + compile + resolve strategies — the compile→execute boundary (no I/O). */
  build(): AgentRunner {
    const walk = walkAgentMetadata(this.AgentClass, [])
    const toolboxInstances = new Map(
      walk.toolboxes.map((tb) => [tb.class, new (tb.class as new () => object)()]),
    )
    const compiled = compileAgent(walk, toolboxInstances)
    const loopStrategy = resolveLoopStrategy(walk.mainLoop.strategy, walk.mainLoop.maxIterations)
    const reflectionStrategy =
      this.reflectionOverride ??
      (walk.mainLoop.strategy === 'plan-act-reflect'
        ? ladderReflectionStrategy
        : noopReflectionStrategy)
    // V4-F: builder override WINS over the @Compaction decorator (EC-1); undefined when
    // neither declares it (EC-4 — opt-in). resolveCompactionStrategy fails fast (EC-5/EC-2).
    const compactionDecl = this.compactionOverride ?? walk.compaction
    const compaction = compactionDecl
      ? resolveCompactionStrategy(compactionDecl.name, { keepTokens: compactionDecl.keepTokens })
      : undefined
    return new AgentRunner({
      compiled,
      agentName: walk.agentConfig.name,
      loopStrategy,
      reflectionStrategy,
      streamEnabled: this.streamEnabled,
      compaction,
    })
  }
}
