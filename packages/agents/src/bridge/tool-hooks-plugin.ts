/**
 * M10 (theokit-ai-first) — createToolHooksPlugin: `beforeToolCall` / `afterToolCall` observability.
 *
 * ADR-0040 § D2: a HOME/BOUNDARY plugin over the SDK's OWN `pre_tool_call` / `post_tool_call` /
 * `pre_llm_call` / `post_llm_call` / `pre_user_send` hooks (mirrors {@link createHitlPlugin}). It
 * calls no LLM, dispatches no tool, runs no second loop — the SDK owns the run. `beforeToolCall`
 * may VETO a call; `afterToolCall` observes the result.
 *
 * M19 — `processInput` completes the input side of the processor pipeline, wired to the SDK
 * `pre_user_send` hook. NOTE (honest ceiling): the SDK does NOT let a plugin mutate the raw
 * prompt/stream; `pre_user_send` lets a handler INJECT derived context (`recalledContext`) BEFORE
 * the model. So `processInput` receives the prompt and returns an optional string, which the SDK
 * injects as a `<memory-context>` block ahead of the prompt. The api-error side of M19 lives in
 * `./api-error-handler` (a sibling factory — the SDK owns retry and exposes no error hook).
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
  /**
   * M19 — pre-process the user input BEFORE the model runs (SDK `pre_user_send`). Receives the
   * prompt; return a string to INJECT as derived context ahead of it (the SDK wraps it in a
   * `<memory-context>` block), or `undefined` to inject nothing. The SDK does not expose raw-prompt
   * mutation to plugins, so this is additive, not a rewrite of the caller's stream.
   */
  processInput?: (ctx: ProcessInputContext) => string | undefined | Promise<string | undefined>
}

/** Context of the input seam (mirrors the SDK `PreUserSendContext`). */
export interface ProcessInputContext {
  prompt: string
  agentId: string
  runId: string
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
  /** M19 — the user prompt, present on the `pre_user_send` seam. */
  prompt?: string
}
export interface ToolHooksPluginContext {
  on(hook: string, handler: (ctx: ToolHookRawContext) => unknown): void
}
export interface ToolHooksPlugin {
  name: string
  /** SDK `BasePlugin.version` — required by the `@theokit/sdk` Plugin contract. */
  version: string
  /**
   * SDK Plugin discriminator. MUST be `'general'` — the SDK's `isCodePlugin()` gate filters out any
   * plugin object lacking `kind: 'general'` (a `register()`-only object is silently dropped and its
   * hooks NEVER fire). Regression guard for the M10/M19 latent E2E bug.
   */
  kind: 'general'
  register(ctx: ToolHooksPluginContext): void
}

/**
 * Build the tool-hooks plugin. Registers ONLY the hooks provided (inert when none) so it adds no
 * overhead unless used. The returned object is a structural `@theokit/sdk` `Plugin`.
 */
export function createToolHooksPlugin(hooks: ToolHooks): ToolHooksPlugin {
  return {
    name: 'theokit-tool-hooks',
    version: '1.0.0',
    // `kind: 'general'` is load-bearing — without it the SDK's isCodePlugin() drops this plugin and
    // no hook fires (M10/M19 latent bug, proven via a real OpenRouter run).
    kind: 'general',
    register(ctx) {
      const { beforeToolCall, afterToolCall, beforeLLMCall, afterLLMCall, processInput } = hooks
      if (beforeToolCall) {
        ctx.on('pre_tool_call', (c) => beforeToolCall({ name: c.name ?? '', args: c.args ?? {} }))
      }
      if (afterToolCall) {
        ctx.on('post_tool_call', (c) => afterToolCall({ name: c.name ?? '', result: c.result }))
      }
      if (beforeLLMCall) {
        ctx.on('pre_llm_call', (c) =>
          beforeLLMCall({ agentId: c.agentId, runId: c.runId, iteration: c.iteration }),
        )
      }
      if (afterLLMCall) {
        ctx.on('post_llm_call', (c) =>
          afterLLMCall({ agentId: c.agentId, runId: c.runId, iteration: c.iteration }),
        )
      }
      if (processInput) {
        // M19 — map the returned string to the SDK's `pre_user_send` result ({ recalledContext }).
        ctx.on('pre_user_send', async (c) => {
          const injected = await processInput({
            prompt: c.prompt ?? '',
            agentId: c.agentId,
            runId: c.runId,
          })
          return injected !== undefined && injected.length > 0
            ? { recalledContext: injected }
            : undefined
        })
      }
    },
  }
}
