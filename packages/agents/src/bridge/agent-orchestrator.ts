/**
 * Multi-agent orchestration runtime.
 *
 * Provides `delegate()` — a function that lets a parent agent invoke a
 * sub-agent and receive its result. Handles budget clamping (D4),
 * tool sharing, and toolbox auto-instantiation (EC-1).
 */
import type { CompiledTool } from './agent-compiler.js'
import { compileAgent } from './agent-compiler.js'
import { createSdkAgentStream } from './sdk-adapter.js'
import { walkAgentMetadata } from './walk-agent-metadata.js'

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
}

export interface DelegationResult {
  response: string
  toolCalls: { name: string; input: unknown; output: string }[]
  cost: number
  tokens: number
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly actualCost: number,
    public readonly budgetLimit: number,
  ) {
    super(
      `Agent "${agentName}" exceeded budget: $${actualCost.toFixed(4)} > $${budgetLimit.toFixed(4)}`,
    )
    this.name = 'BudgetExceededError'
  }
}

export class DelegationError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly cause: unknown,
  ) {
    super(
      `Delegation to agent "${agentName}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
    this.name = 'DelegationError'
  }
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

/**
 * Delegate a task to a sub-agent and collect its result.
 *
 * - Budget clamping: `min(parentBudgetRemaining, budget)` (D4)
 * - Tool sharing: parent tools merged with sub-agent tools (sub wins on collision)
 * - Toolbox auto-instantiation: sub-agent toolboxes instantiated without DI (EC-1)
 * - Session isolation: each delegation gets a unique session ID (EC-4)
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

  // 4. Create stream + collect (EC-4: randomUUID for session isolation)
  const streamFactory = createSdkAgentStream(compiled, allTools, apiKey, walk.agentConfig.model)
  const sessionId = opts.sessionId ?? `sub-${crypto.randomUUID()}`

  const acc: StreamAccumulator = { response: '', toolCalls: [], cost: 0, tokens: 0 }

  try {
    for await (const event of streamFactory(message, sessionId)) {
      processStreamEvent(event, acc, budget, SubAgentClass.name)
    }
  } catch (err) {
    if (err instanceof BudgetExceededError || err instanceof DelegationError) throw err
    throw new DelegationError(SubAgentClass.name, err)
  }

  // 5. Budget enforcement (post-run check)
  if (Number.isFinite(budget) && acc.cost > budget) {
    throw new BudgetExceededError(SubAgentClass.name, acc.cost, budget)
  }

  return acc
}
