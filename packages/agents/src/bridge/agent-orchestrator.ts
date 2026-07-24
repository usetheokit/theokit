/**
 * Multi-agent orchestration runtime.
 *
 * Provides `delegate()` — a function that lets a parent agent invoke a
 * sub-agent and receive its result. Handles budget clamping (D4), tool sharing,
 * toolbox auto-instantiation (EC-1), and routes the resolved `@MainLoop` strategy
 * through `runReflectiveLoop` — the SAME driver `AgentRunner.run()` uses, so both
 * on-ramps are one runtime (ADR D4). `simple-chat` ⇒ `shouldContinue:()=>false`
 * ⇒ exactly one round; `react`/`plan-act-reflect` ⇒ multi-round reflective loop.
 */
import type {
  AgentDefinition,
  BudgetTracker,
  CustomTool,
  PluginsSettings,
  ProviderRoutingSettings,
} from '@theokit/sdk'
import type { RetryOptions } from '@theokit/sdk/retry'

import {
  ladderReflectionStrategy,
  noopReflectionStrategy,
  type ReflectionStrategy,
  resolveLoopStrategy,
} from '../loop/index.js'
import { type RoundStreamFactory, runReflectiveLoop } from '../loop/run-reflective-loop.js'
import type { MainLoopMeta } from '../types.js'

import type { CompiledAgentOptions, CompiledTool } from './agent-compiler.js'
import { type DelegationResult, DelegationError } from './delegation-types.js'
import { createSdkAgentStream } from './sdk-adapter.js'

// Re-export the delegation value types for backward compatibility — they moved
// to delegation-types.js to break the orchestrator↔loop import cycle (G1).
export { BudgetExceededError, type DelegationResult, DelegationError } from './delegation-types.js'

export interface DelegateOptions {
  /** Max USD for this sub-agent call. */
  budget?: number
  /** Parent's remaining budget (for clamping). */
  parentBudgetRemaining?: number
  /** Parent's tools (for sharing — sub-agent inherits these). */
  parentTools?: CompiledTool[]
  /** LLM API key (inherited from parent). */
  apiKey?: string
  /** Session ID override (default: crypto.randomUUID for isolation). */
  sessionId?: string
  /** Cancellation — aborts stop the reflective loop from re-entering. */
  signal?: AbortSignal
  // V4-T: per-run config parity with `AgentRunnerRunOptions` — a sub-agent inherits the parent's
  // runtime config (all optional; absent ⇒ today's behavior). Each field is already accepted by
  // `createSdkAgentStream`'s `RuntimeOverrides` / the loop's `RunReflectiveLoopConfig`.
  /** Per-run model override (`?? SubAgent @Agent model`). */
  model?: string
  /** Per-run working directory → `Agent.create({ local: { cwd } })`. */
  cwd?: string
  /** Per-run plugins (e.g. a read-only permission gate for an explore sub-agent). */
  plugins?: PluginsSettings
  /** Per-run provider routing (e.g. OpenRouter). */
  providers?: ProviderRoutingSettings
  /** Per-run sub-agent definitions. */
  agents?: Record<string, AgentDefinition>
  /** Per-run SDK budget tracker (inner tool-loop cap). */
  budgetTracker?: BudgetTracker
  /** Per-run pre-built SDK tools forwarded raw (V4-Q). */
  sdkTools?: readonly CustomTool[]
  /** Per-round transient retry (V4-P). */
  retry?: RetryOptions
  /** Custom between-round reflection (default: ladder for `plan-act-reflect`, else noop). */
  reflection?: ReflectionStrategy
  /** Per-run loop-ceiling override (`?? SubAgent @MainLoop maxIterations`). */
  maxIterations?: number
  // M12 — delegation observability hooks (ADR-0040 § D2). Observability over the EXISTING
  // primitive; no new orchestration engine. `abortSignal` propagation already lives in `signal`.
  /**
   * Called BEFORE the sub-agent runs. Returns the input the sub-agent will receive — return
   * `ctx.input` unchanged, or a rewritten string (e.g. inject a persona). A transform, not a veto.
   */
  onDelegationStart?: (ctx: { subAgent: string; input: string }) => string | Promise<string>
  /**
   * Called AFTER the sub-agent completes. Returns the result the supervisor sees — return
   * `ctx.result` unchanged, or a transformed one (e.g. redact, score, re-wrap).
   */
  onDelegationComplete?: (ctx: {
    subAgent: string
    result: DelegationResult
  }) => DelegationResult | Promise<DelegationResult>
  /**
   * Injected stream factory (parity with `AgentRunnerRunOptions.streamFactory`) — drives the loop
   * directly instead of the SDK adapter (tests / custom transport). Absent ⇒ `createSdkAgentStream`.
   */
  streamFactory?: RoundStreamFactory
}

/** Validate API key and throw DelegationError if missing. */
function requireApiKey(opts: DelegateOptions, agentName: string): string {
  const apiKey = opts.apiKey ?? ''
  if (!apiKey) {
    throw new DelegationError(agentName, 'No API key provided. Pass apiKey in DelegateOptions.')
  }
  return apiKey
}

/** Merge parent tools with sub-agent tools (sub wins on collision). */
function mergeTools(parentTools: CompiledTool[], subTools: CompiledTool[]): CompiledTool[] {
  const subToolNames = new Set(subTools.map((t) => t.name))
  const inherited = parentTools.filter((t) => !subToolNames.has(t.name))
  return [...inherited, ...subTools]
}

/**
 * Delegate a task to a sub-agent and collect its result.
 *
 * - Budget clamping: `min(parentBudgetRemaining, budget)` (D4)
 * - Tool sharing: parent tools merged with sub-agent tools (sub wins on collision)
 * - Toolbox auto-instantiation: sub-agent toolboxes instantiated without DI (EC-1)
 * - Session isolation: each delegation gets a unique session ID (EC-4)
 * - `@MainLoop` strategy runtime: routes through `runReflectiveLoop` (the same loop
 *   `AgentRunner.run` uses — one runtime for both on-ramps, ADR D4). The runtime
 *   metric (`THEO_AGENT_MAINLOOP_RUNTIME_APPLIED`) + typed-error + cumulative budget
 *   all live in the shared driver, so they fire identically on both paths.
 */
/**
 * What `delegate` needs from a sub-agent: a name and already-compiled options (built by
 * `applyCapabilities`). Compatible with {@link AgentRunnerSpec} — one spec drives both on-ramps.
 */
export interface SubAgentSpec {
  readonly name: string
  readonly compiled: CompiledAgentOptions
  /** Loop strategy (`@MainLoop({ strategy })`); absent ⇒ the same `'simple-chat'` default. */
  readonly strategy?: MainLoopMeta['strategy']
  /** Loop ceiling (`@MainLoop({ maxIterations })`); a per-run override still wins. */
  readonly maxIterations?: number
}

export async function delegate(
  spec: SubAgentSpec,
  message: string,
  opts: DelegateOptions = {},
): Promise<DelegationResult> {
  const apiKey = requireApiKey(opts, spec.name)

  // M12 — onDelegationStart: let the supervisor rewrite the input before the sub-agent runs.
  const effectiveMessage = opts.onDelegationStart
    ? await opts.onDelegationStart({ subAgent: spec.name, input: message })
    : message

  const { compiled } = spec

  // 2. Merge parent tools + clamp budget (D4)
  const allTools = mergeTools(opts.parentTools ?? [], compiled.tools)
  const budget = Math.min(opts.budget ?? Infinity, opts.parentBudgetRemaining ?? Infinity)

  // 3. Build the stream factory (the model call stays in the SDK — ADR 0031) + session.
  // V4-T: forward the per-run config (parity with AgentRunner.stream); model opt wins over the
  // decorator; absent fields ⇒ no key (byte-identical to the pre-V4-T `{ model }`-only override).
  // M12 — an injected factory (tests / custom transport) wins; absent ⇒ the SDK adapter.
  const streamFactory =
    opts.streamFactory ??
    createSdkAgentStream(compiled, allTools, apiKey, {
      model: opts.model ?? compiled.model,
      cwd: opts.cwd,
      plugins: opts.plugins,
      providers: opts.providers,
      agents: opts.agents,
      budgetTracker: opts.budgetTracker,
      sdkTools: opts.sdkTools,
    })
  const sessionId = opts.sessionId ?? `sub-${crypto.randomUUID()}`

  // 4. Resolve the @MainLoop strategy + reflection, then run the shared reflective loop.
  // V4-T: per-run maxIterations override (parity with AgentRunner.stream); absent ⇒ decorator ceiling.
  const loopStrategy = resolveLoopStrategy(
    spec.strategy ?? 'simple-chat',
    opts.maxIterations ?? spec.maxIterations,
  )
  // V4-T: a custom reflection wins; absent ⇒ the strategy-derived default (ladder/noop).
  const reflection =
    opts.reflection ??
    (loopStrategy.name === 'plan-act-reflect' ? ladderReflectionStrategy : noopReflectionStrategy)
  const result = await runReflectiveLoop(streamFactory, effectiveMessage, sessionId, {
    loop: loopStrategy,
    reflection,
    budget,
    agentName: spec.name,
    signal: opts.signal,
    retry: opts.retry, // V4-T: per-round transient retry (V4-P) on the delegate path
  })

  // M12 — onDelegationComplete: let the supervisor transform the result before it returns.
  if (opts.onDelegationComplete) {
    return await opts.onDelegationComplete({ subAgent: spec.name, result })
  }
  return result
}
