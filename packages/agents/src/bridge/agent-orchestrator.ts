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
import {
  ladderReflectionStrategy,
  noopReflectionStrategy,
  resolveLoopStrategy,
} from '../loop/index.js'
import { runReflectiveLoop } from '../loop/run-reflective-loop.js'

import { compileAgent, type CompiledTool } from './agent-compiler.js'
import { type DelegationResult, DelegationError } from './delegation-types.js'
import { createSdkAgentStream } from './sdk-adapter.js'
import { walkAgentMetadata } from './walk-agent-metadata.js'

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
export async function delegate(
  SubAgentClass: Function,
  message: string,
  opts: DelegateOptions = {},
): Promise<DelegationResult> {
  const apiKey = requireApiKey(opts, SubAgentClass.name)

  // 1. Walk + compile sub-agent (EC-1: auto-instantiate toolboxes)
  const walk = walkAgentMetadata(SubAgentClass, [])
  const toolboxInstances = new Map(
    walk.toolboxes.map((tb) => [tb.class, new (tb.class as new () => object)()]),
  )
  const compiled = compileAgent(walk, toolboxInstances)

  // 2. Merge parent tools + clamp budget (D4)
  const allTools = mergeTools(opts.parentTools ?? [], compiled.tools)
  const budget = Math.min(opts.budget ?? Infinity, opts.parentBudgetRemaining ?? Infinity)

  // 3. Build the stream factory (the model call stays in the SDK — ADR 0031) + session
  const streamFactory = createSdkAgentStream(compiled, allTools, apiKey, {
    model: walk.agentConfig.model,
  })
  const sessionId = opts.sessionId ?? `sub-${crypto.randomUUID()}`

  // 4. Resolve the @MainLoop strategy + reflection, then run the shared reflective loop.
  const loopStrategy = resolveLoopStrategy(walk.mainLoop.strategy, walk.mainLoop.maxIterations)
  const reflection =
    loopStrategy.name === 'plan-act-reflect' ? ladderReflectionStrategy : noopReflectionStrategy
  return runReflectiveLoop(streamFactory, message, sessionId, {
    loop: loopStrategy,
    reflection,
    budget,
    agentName: SubAgentClass.name,
    signal: opts.signal,
  })
}
