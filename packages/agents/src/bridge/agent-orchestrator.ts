/**
 * Multi-agent orchestration runtime.
 *
 * Provides `delegate()` — a function that lets a parent agent invoke a
 * sub-agent and receive its result. Handles budget clamping (D4), tool sharing,
 * toolbox auto-instantiation (EC-1), and (T2.2) routes the resolved `@MainLoop`
 * strategy to the multi-round reflective loop — `simple-chat` keeps the
 * single-shot path; `react`/`plan-act-reflect` drive `runReflectiveLoop`.
 */
import {
  ladderReflectionStrategy,
  type LoopStrategy,
  noopReflectionStrategy,
  resolveLoopStrategy,
} from '../loop/index.js'
import { type RoundStreamFactory, runReflectiveLoop } from '../loop/run-reflective-loop.js'

import type { CompiledTool } from './agent-compiler.js'
import { compileAgent } from './agent-compiler.js'
import { BudgetExceededError, type DelegationResult, DelegationError } from './delegation-types.js'
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

/** Safely coerce unknown to string. */
function asString(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  return fallback
}

/** Safely coerce unknown to number. */
function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number') return value
  return fallback
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

/** Mutable accumulator for stream event processing. */
interface StreamAccumulator {
  response: string
  toolCalls: { name: string; input: unknown; output: string }[]
  cost: number
  tokens: number
}

/** Process a single stream event into the accumulator. Throws on budget exceeded or error. */
function processStreamEvent(
  event: { type: string; [key: string]: unknown },
  acc: StreamAccumulator,
  budget: number,
  agentName: string,
): void {
  if (event.type === 'text_delta' && typeof event.content === 'string') {
    acc.response += event.content
    return
  }
  if (event.type === 'tool_result') {
    acc.toolCalls.push({
      name: asString(event.toolName, 'unknown'),
      input: event.input ?? {},
      output: asString(event.output, ''),
    })
    return
  }
  if (event.type === 'done') {
    acc.cost = asNumber(event.cost, 0)
    const usage = event.usage as { totalTokens?: number } | undefined
    acc.tokens = usage?.totalTokens ?? 0
    if (Number.isFinite(budget) && acc.cost > budget) {
      throw new BudgetExceededError(agentName, acc.cost, budget)
    }
    return
  }
  if (event.type === 'error') {
    throw new DelegationError(
      agentName,
      asString((event as { message?: unknown }).message, 'Unknown agent error'),
    )
  }
}

/** Shared run context for the strategy dispatch paths. */
interface RunContext {
  readonly streamFactory: RoundStreamFactory
  readonly message: string
  readonly sessionId: string
  readonly budget: number
  readonly agentName: string
  readonly signal?: AbortSignal
}

/** Multi-round reflective path (`react`/`plan-act-reflect`) — T2.2. */
async function runReflective(
  ctx: RunContext,
  loopStrategy: LoopStrategy,
): Promise<DelegationResult> {
  const reflection =
    loopStrategy.name === 'plan-act-reflect' ? ladderReflectionStrategy : noopReflectionStrategy
  // The runtime metric (THEO_AGENT_MAINLOOP_RUNTIME_APPLIED) fires inside
  // runReflectiveLoop — the shared driver — so both on-ramps emit it (G10).
  const result = await runReflectiveLoop(ctx.streamFactory, ctx.message, ctx.sessionId, {
    loop: loopStrategy,
    reflection,
    budget: ctx.budget,
    agentName: ctx.agentName,
    signal: ctx.signal,
  })
  if (Number.isFinite(ctx.budget) && result.cost > ctx.budget) {
    throw new BudgetExceededError(ctx.agentName, result.cost, ctx.budget)
  }
  return result
}

/** Single-shot path (`simple-chat`) — unchanged behavior (EC-2 backward-compat). */
async function runSingleShot(ctx: RunContext): Promise<DelegationResult> {
  const acc: StreamAccumulator = { response: '', toolCalls: [], cost: 0, tokens: 0 }
  try {
    for await (const event of ctx.streamFactory(ctx.message, ctx.sessionId)) {
      processStreamEvent(event, acc, ctx.budget, ctx.agentName)
    }
  } catch (err) {
    if (err instanceof BudgetExceededError || err instanceof DelegationError) throw err
    throw new DelegationError(ctx.agentName, err)
  }
  if (Number.isFinite(ctx.budget) && acc.cost > ctx.budget) {
    throw new BudgetExceededError(ctx.agentName, acc.cost, ctx.budget)
  }
  return acc
}

/**
 * Delegate a task to a sub-agent and collect its result.
 *
 * - Budget clamping: `min(parentBudgetRemaining, budget)` (D4)
 * - Tool sharing: parent tools merged with sub-agent tools (sub wins on collision)
 * - Toolbox auto-instantiation: sub-agent toolboxes instantiated without DI (EC-1)
 * - Session isolation: each delegation gets a unique session ID (EC-4)
 * - `@MainLoop` strategy runtime (T2.2): `simple-chat` ⇒ single-shot; otherwise
 *   the multi-round reflective loop (closes V4-A's metadata-only gap)
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

  // 2. Merge parent tools
  const allTools = mergeTools(opts.parentTools ?? [], compiled.tools)

  // 3. Budget clamping (D4)
  const budget = Math.min(opts.budget ?? Infinity, opts.parentBudgetRemaining ?? Infinity)

  // 4. Create stream + session (EC-4: randomUUID for session isolation)
  const streamFactory = createSdkAgentStream(compiled, allTools, apiKey, walk.agentConfig.model)
  const sessionId = opts.sessionId ?? `sub-${crypto.randomUUID()}`

  // 5. Resolve the @MainLoop strategy and dispatch (T2.2 — closes the metadata-only gap):
  //    simple-chat ⇒ single-shot (unchanged); react/plan-act-reflect ⇒ reflective loop.
  const ctx: RunContext = {
    streamFactory,
    message,
    sessionId,
    budget,
    agentName: SubAgentClass.name,
    signal: opts.signal,
  }
  const loopStrategy = resolveLoopStrategy(walk.mainLoop.strategy, walk.mainLoop.maxIterations)
  return loopStrategy.name === 'simple-chat' ? runSingleShot(ctx) : runReflective(ctx, loopStrategy)
}
