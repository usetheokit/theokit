import type { SystemPromptResolver } from '@theokit/sdk'
import type { z } from 'zod'

/** Configuration stored by @Agent() decorator. */
export interface AgentOptions {
  /** Unique agent name (kebab-case). */
  name: string
  /** HTTP route prefix (e.g., '/api/agents/support'). */
  route: string
  /** LLM model identifier (e.g., 'claude-sonnet-4-5-20250929'). */
  model?: string
  /** Enable SSE streaming (default: true). */
  stream?: boolean
  /** Maximum loop iterations before forcing a terminal response. */
  maxIterations?: number
  /** Timeout in milliseconds for the entire agent run. */
  timeoutMs?: number
  /**
   * System prompt for the agent. Either a static string OR a
   * {@link SystemPromptResolver} computed per request (V4-L.1, Axis-B) — the SDK
   * invokes the resolver each send with the run's `SystemPromptContext` (cwd, etc.).
   */
  systemPrompt?: string | SystemPromptResolver
}

/** Configuration stored by @MainLoop() decorator. */
export interface MainLoopOptions {
  /** Execution strategy. */
  strategy?: 'simple-chat' | 'plan-act-reflect' | 'react'
  /** Maximum iterations for this loop. */
  maxIterations?: number
  /** Timeout in milliseconds. */
  timeoutMs?: number
}

/** Internal representation of a resolved @MainLoop. */
export interface MainLoopMeta {
  propertyKey: string | symbol
  strategy: 'simple-chat' | 'plan-act-reflect' | 'react'
  maxIterations?: number
  timeoutMs?: number
}

/** Configuration stored by @Toolbox() decorator. */
export interface ToolboxOptions {
  /** Namespace prefix for all tools in this toolbox (e.g., 'support'). */
  namespace?: string
}

/** Configuration stored by @Tool() decorator. */
export interface ToolOptions {
  /** Tool name (surfaced to LLM). */
  name: string
  /** LLM-facing description. */
  description: string
  /** Zod input schema — compiled to JSON Schema via defineTool(). */
  input: z.ZodType
  /** Risk level (informational — feeds manifest + UI). */
  risk?: 'low' | 'medium' | 'high'
}

/** Budget configuration for @Budget() decorator. */
export interface BudgetOptions {
  /** Maximum cost in USD for this scope. */
  maxCostUsd: number
  /** Rolling window for budget tracking. */
  window?: 'daily' | 'monthly'
}

/** Approval configuration for @RequiresApproval() decorator. */
export interface ApprovalOptions {
  /** Reason shown to the approver. */
  reason: string
}

/** Policy handler function type. */
export type PolicyHandler = (user: { roles: string[] }) => boolean
