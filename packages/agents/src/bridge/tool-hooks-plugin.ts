/**
 * M10 (theokit-ai-first) — createToolHooksPlugin: `beforeToolCall` / `afterToolCall` observability.
 *
 * ADR-0040 § D2: a HOME/BOUNDARY plugin over the SDK's OWN `pre_tool_call` / `post_tool_call`
 * hooks (mirrors {@link createHitlPlugin}). It calls no LLM, dispatches no tool, runs no second
 * loop — the SDK owns the run. `beforeToolCall` may VETO a call; `afterToolCall` observes the
 * result. The processor pipeline's remaining lifecycle hooks (LLM request/response) live in the
 * SDK; this ships the two tool-boundary hooks the framework can wire today.
 */

/** A tool call about to run (mirrored from the SDK `pre_tool_call` context — type-only). */
export interface BeforeToolCallContext {
  name: string
  args: Record<string, unknown>
}
/** A veto returned from `beforeToolCall` — blocks the tool; the SDK surfaces `message` to the model. */
export interface ToolCallVeto {
  block: true
  message: string
}
/** A completed tool call (mirrored from the SDK `post_tool_call` context — type-only). */
export interface AfterToolCallContext {
  name: string
  result: unknown
}

export interface ToolHooks {
  /** Observe (and optionally VETO) every tool call before it runs. Return a veto or nothing. */
  beforeToolCall?: (
    ctx: BeforeToolCallContext,
  ) => ToolCallVeto | undefined | Promise<ToolCallVeto | undefined>
  /** Observe every tool call's result after it runs. */
  afterToolCall?: (ctx: AfterToolCallContext) => void | Promise<void>
  /**
   * M10 — observe every LLM turn BEFORE it runs (SDK `pre_llm_call`). Observability only — the
   * SDK's LLM-call context carries `{ agentId, runId, iteration }`, not the mutable request body.
   */
  beforeLLMCall?: (ctx: LLMCallContext) => void | Promise<void>
  /** M10 — observe every LLM turn AFTER it completes (SDK `post_llm_call`). Observability only. */
  afterLLMCall?: (ctx: LLMCallContext) => void | Promise<void>
}

/** Context of an LLM turn (mirrors the SDK `LlmCallContext` for `pre_llm_call`/`post_llm_call`). */
export interface LLMCallContext {
  agentId: string
  runId: string
  /** 0-based iteration index of the current turn, when available. */
  iteration?: number
}

/**
 * Minimal SDK hook context (type-only — no runtime import, keeps the SDK peer optional). Tool hooks
 * carry `name`/`args`/`result`; LLM hooks carry `iteration`. All optional so one shape covers both.
 */
export interface ToolHookRawContext {
  agentId: string
  runId: string
  name?: string
  args?: Record<string, unknown>
  result?: unknown
  iteration?: number
}
export interface ToolHooksPluginContext {
  on(hook: string, handler: (ctx: ToolHookRawContext) => unknown): void
}
export interface ToolHooksPlugin {
  name: string
  register(ctx: ToolHooksPluginContext): void
}

/**
 * Build the tool-hooks plugin. Registers ONLY the hooks provided (inert when none) so it adds no
 * overhead unless used. The returned object is a structural `@theokit/sdk` `Plugin`.
 */
export function createToolHooksPlugin(hooks: ToolHooks): ToolHooksPlugin {
  return {
    name: 'theokit-tool-hooks',
    register(ctx) {
      const { beforeToolCall, afterToolCall, beforeLLMCall, afterLLMCall } = hooks
      if (beforeToolCall) {
        ctx.on('pre_tool_call', (c) => beforeToolCall({ name: c.name ?? '', args: c.args ?? {} }))
      }
      if (afterToolCall) {
        ctx.on('post_tool_call', (c) => afterToolCall({ name: c.name ?? '', result: c.result }))
      }
      if (beforeLLMCall) {
        ctx.on('pre_llm_call', (c) => beforeLLMCall({ agentId: c.agentId, runId: c.runId, iteration: c.iteration }))
      }
      if (afterLLMCall) {
        ctx.on('post_llm_call', (c) => afterLLMCall({ agentId: c.agentId, runId: c.runId, iteration: c.iteration }))
      }
    },
  }
}
