/**
 * AgentExecutionContext — extends http-decorators' ExecutionContext with agent-specific methods.
 *
 * Per ADR D2 (LSP): any guard that accepts ExecutionContext works unchanged with
 * AgentExecutionContext. Agent-specific guards can narrow via isAgentContext().
 */
import type { ExecutionContext } from '@theokit/http'

import type { AgentOptions, ToolOptions } from '../types.js'

export interface AgentRunInfo {
  id: string
  startedAt: Date
}

export interface AgentExecutionContext extends ExecutionContext {
  /** The agent's scalar configuration. */
  getAgent(): AgentOptions
  /** The current run information. */
  getRun(): AgentRunInfo
  /** The tool being called, or null if in the main agent handler. */
  getToolCall(): ToolOptions | null
  /** Type guard — always true for AgentExecutionContext. */
  isAgentContext(): true
}

/** Create an AgentExecutionContext from a base ExecutionContext + agent state. */
export function createAgentExecutionContext(
  base: ExecutionContext,
  agent: AgentOptions,
  run: AgentRunInfo,
  toolCall?: ToolOptions,
): AgentExecutionContext {
  return {
    getRequest: () => base.getRequest(),
    getUrl: () => base.getUrl(),
    getClass: () => base.getClass(),
    getMethodName: () => base.getMethodName(),
    getAgent: () => agent,
    getRun: () => run,
    getToolCall: () => toolCall ?? null,
    isAgentContext: () => true as const,
  }
}

/** Narrow an ExecutionContext to AgentExecutionContext if it is one. */
export function isAgentContext(ctx: ExecutionContext): ctx is AgentExecutionContext {
  return 'isAgentContext' in ctx && (ctx as AgentExecutionContext).isAgentContext()
}
