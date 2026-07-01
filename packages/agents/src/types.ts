import type { SystemPromptResolver } from '@theokit/sdk'
import type { z } from 'zod'

/**
 * Provider-agnostic extended-thinking knob (M1 reasoning-visibility). The common set autocompletes;
 * `(string & {})` accepts provider-specific values forward-compat (mirrors `AgentRunErrorCode`) — the
 * SDK validates the value against the model's catalog. Defined in this leaf module so every layer
 * (`@Agent` config, compiler, runner, sdk-adapter) imports it without an import cycle.
 */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | (string & {})

/** Configuration stored by @Agent() decorator. */
export interface AgentOptions {
  /** Unique agent name (kebab-case). */
  name: string
  /** HTTP route prefix (e.g., '/api/agents/support'). */
  route: string
  /** LLM model identifier (e.g., 'claude-sonnet-4-5-20250929'). */
  model?: string
  /** Extended-thinking effort; mapped to the SDK `ModelSelection.params` so the provider reasons. */
  reasoningEffort?: ReasoningEffort
  /**
   * Opt-in (default false): convert inline `<think>…</think>` in the text stream into `thinking`
   * events (M2) — for models that emit reasoning as inline tags (qwen/deepseek) rather than via a
   * native reasoning param. Off by default since a code assistant may emit literal `<think>` in text.
   */
  parseThinkTags?: boolean
  /**
   * Opt-in (default false): strip a leaked Hermes `<function=…></tool_call>` tool-call dialect out of
   * the visible text (theocode#32) — for models (qwen/qwen3-coder) that intermittently emit tool calls
   * as text instead of native `tool_calls`. Off by default since a code assistant may emit a literal
   * `<function=` in answer/code text. Sibling of {@link parseThinkTags}.
   */
  stripToolDialect?: boolean
  /**
   * Opt-in (default false): recover a leaked Hermes `<function=…></tool_call>` tool-call dialect so the
   * call actually EXECUTES (theokit#58 follow-up). Where {@link stripToolDialect} only hides the leaked
   * block from the visible text, this enables the SDK's `extractToolCallsFromContent` on the chat route,
   * so a `chat_completions` finish with ZERO native `tool_calls` has its text scanned for the dialect and
   * any recovered calls are dispatched by the loop. For models (qwen/qwen3-coder via OpenRouter) that
   * leak tool calls as text. Off by default (a code assistant may print a literal `<function=`); fail-open.
   * Has effect only when {@link AgentOptions} routes a provider via `providers.routes`. Sibling of
   * {@link stripToolDialect} — typically enabled together.
   */
  recoverLeakedToolCalls?: boolean
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
