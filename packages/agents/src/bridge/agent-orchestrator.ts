/**
 * Multi-agent orchestration runtime.
 *
 * Provides `delegate()` — a function that lets a parent agent invoke a
 * sub-agent and receive its result. Handles budget clamping (D4),
 * tool sharing, and toolbox auto-instantiation (EC-1).
 */
import { walkAgentMetadata } from './walk-agent-metadata.js'
import { compileAgent } from './agent-compiler.js'
import { createRealAgentStream } from './llm-runner.js'
import type { StreamEvent } from './agent-sse-handler.js'
import type { CompiledTool } from './agent-compiler.js'

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
    super(`Agent "${agentName}" exceeded budget: $${actualCost.toFixed(4)} > $${budgetLimit.toFixed(4)}`)
    this.name = 'BudgetExceededError'
  }
}

export class DelegationError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly cause: unknown,
  ) {
    super(`Delegation to agent "${agentName}" failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'DelegationError'
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
  // SECURITY: API key flows as string — accepted risk for v1.
  // Key is never logged or serialized. Future: SecretString wrapper.
  const apiKey = opts.apiKey ?? ''
  if (!apiKey) {
    throw new DelegationError(
      SubAgentClass.name,
      'No API key provided. Pass apiKey in DelegateOptions.',
    )
  }

  // 1. Walk + compile sub-agent (EC-1: auto-instantiate toolboxes)
  const walk = walkAgentMetadata(SubAgentClass, [])
  const toolboxInstances = new Map(
    walk.toolboxes.map((tb) => [tb.class, new (tb.class as new () => object)()]),
  )
  const compiled = compileAgent(walk, toolboxInstances)

  // 2. Merge parent tools (parent tools + sub-agent tools, sub wins on collision)
  const parentTools = opts.parentTools ?? []
  const subToolNames = new Set(compiled.tools.map((t) => t.name))
  const inherited = parentTools.filter((t) => !subToolNames.has(t.name))
  const allTools = [...inherited, ...compiled.tools]

  // 3. Budget clamping (D4)
  const budget = Math.min(opts.budget ?? Infinity, opts.parentBudgetRemaining ?? Infinity)

  // 4. Create stream + collect (EC-4: randomUUID for session isolation)
  const streamFactory = createRealAgentStream(walk, allTools, apiKey, walk.agentConfig.model)
  const sessionId = opts.sessionId ?? `sub-${crypto.randomUUID()}`

  let response = ''
  const toolCalls: { name: string; input: unknown; output: string }[] = []
  let cost = 0
  let tokens = 0

  try {
    const iter = streamFactory(message, sessionId)
    for await (const event of iter as AsyncIterable<StreamEvent & { content?: string; toolName?: string; input?: unknown; output?: string; cost?: number; usage?: { totalTokens?: number } }>) {
      if (event.type === 'text_delta' && event.content) {
        response += event.content
      }
      if (event.type === 'tool_result') {
        toolCalls.push({
          name: (event.toolName as string) ?? 'unknown',
          input: event.input ?? {},
          output: (event.output as string) ?? '',
        })
      }
      if (event.type === 'done') {
        cost = (event.cost as number) ?? 0
        tokens = event.usage?.totalTokens ?? 0
        // Security: mid-stream budget enforcement — abort immediately on exceeded
        if (Number.isFinite(budget) && cost > budget) {
          throw new BudgetExceededError(SubAgentClass.name, cost, budget)
        }
      }
      if (event.type === 'error') {
        throw new DelegationError(SubAgentClass.name, (event as { message?: string }).message ?? 'Unknown agent error')
      }
    }
  } catch (err) {
    if (err instanceof BudgetExceededError || err instanceof DelegationError) throw err
    throw new DelegationError(SubAgentClass.name, err)
  }

  // 5. Budget enforcement (post-run check)
  if (Number.isFinite(budget) && cost > budget) {
    throw new BudgetExceededError(SubAgentClass.name, cost, budget)
  }

  return { response, toolCalls, cost, tokens }
}
