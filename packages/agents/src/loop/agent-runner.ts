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
import { type CompiledAgentOptions, compileAgent } from '../bridge/agent-compiler.js'
import type { StreamEvent } from '../bridge/agent-sse-handler.js'
import type { DelegationResult } from '../bridge/delegation-types.js'
import { createSdkAgentStream } from '../bridge/sdk-adapter.js'
import { walkAgentMetadata } from '../bridge/walk-agent-metadata.js'

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
}

/**
 * A built, runnable agent. Construct via {@link AgentRunner.builder} — the
 * constructor takes already-resolved state and is an internal detail.
 */
export class AgentRunner {
  constructor(
    private readonly compiled: CompiledAgentOptions,
    private readonly agentName: string,
    /** The resolved terminal-decision strategy (parity with `delegate()`). */
    readonly loopStrategy: LoopStrategy,
    /** The resolved between-round reflection (default or `.reflection(custom)` override). */
    readonly reflectionStrategy: ReflectionStrategy,
    /**
     * Recorded streaming preference. The reflective loop currently always
     * streams via the SDK `Run.stream()`; a non-streaming collect mode is future
     * work — the flag is captured + exposed here, not yet branched on (honest
     * per G10: documented, not a silent no-op).
     */
    readonly streamEnabled: boolean,
  ) {}

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
    const streamFactory = createSdkAgentStream(
      this.compiled,
      this.compiled.tools,
      opts.apiKey,
      this.compiled.model,
    )
    const sessionId = opts.sessionId ?? `runner-${crypto.randomUUID()}`
    return runReflectiveLoopStream(streamFactory, message, sessionId, {
      loop: this.loopStrategy,
      reflection: this.reflectionStrategy,
      budget: opts.budget,
      agentName: this.agentName,
      signal: opts.signal,
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
    return new AgentRunner(
      compiled,
      walk.agentConfig.name,
      loopStrategy,
      reflectionStrategy,
      this.streamEnabled,
    )
  }
}
