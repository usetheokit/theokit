/**
 * M82 — the typed shape of `AgentBuilder.create().hooks({...})`.
 *
 * ## Why this type lives here
 *
 * Until M82 the signature was `Readonly<Record<string, unknown>>`: any key was accepted and every
 * handler received `ctx: unknown`. A consumer that wanted types had to declare its own — and that is
 * exactly what agent-builder did, with a local alias of five handlers, four of them carrying
 * `ctx: unknown` because there was nowhere to import the contexts from.
 *
 * It is the same class M81 closed with `discoverSubagents`: framework knowledge reimplemented in the
 * app because the framework did not publish it. The type is born where the knowledge lives.
 *
 * ## About `transform_tool_result`
 *
 * This is the ONLY tool-stage channel whose return value the SDK applies — `#runTransform` folds the
 * returned value in; `#runFireAndForget`, used by `post_tool_call`, discards it. Since M82 its
 * context carries `toolCalls`, so a scoped policy (by tool name) can ACT on the result rather than
 * merely observe it.
 */
import type {
  PostAssistantReplyContext,
  PostToolCallContext,
  PreToolCallContext,
  PreToolCallDecision,
  PreUserSendContext,
  PreUserSendResult,
  SessionLifecycleContext,
  ToolResultTransformContext,
  TransformContext,
} from '@theokit/sdk'

/**
 * Lifecycle handlers keyed by `HookName`.
 *
 * Every field is optional: an agent registers only the events it cares about. `.hooks()` accepts the
 * UNION of this type with the earlier loose shape (M82's ADR-4), so no implicit index signature is
 * needed for the value to pass at the call site — the narrowing is gradual, not a break.
 */
export interface HookHandlers {
  /**
   * Runs BEFORE the tool. Returning `{ block: true, message }` VETOES the call — the only hook with
   * veto power.
   */
  pre_tool_call?: (
    ctx: PreToolCallContext,
  ) => Promise<PreToolCallDecision | undefined> | PreToolCallDecision | undefined
  /**
   * Runs AFTER the tool, with `{name, args, result}`. Fire-and-forget: the return value is
   * **discarded** by the SDK. To ACT on the result use {@link transform_tool_result}.
   */
  post_tool_call?: (ctx: PostToolCallContext) => Promise<void> | void
  /**
   * Folds the turn's tool results before they go up to the model. Since M82 the context brings
   * `toolCalls` — plural, because the seam receives the turn's BATCH; correlate by
   * `toolUseId === id`.
   */
  transform_tool_result?: <T>(results: T, ctx: ToolResultTransformContext) => Promise<T> | T
  /** Folds the model's text before it is consumed. No tool call involved. */
  transform_llm_output?: (output: string, ctx: TransformContext) => Promise<string> | string
  on_session_start?: (ctx: SessionLifecycleContext) => Promise<void> | void
  on_session_end?: (ctx: SessionLifecycleContext) => Promise<void> | void
  pre_user_send?: (
    ctx: PreUserSendContext,
  ) => Promise<PreUserSendResult | undefined> | PreUserSendResult | undefined
  post_assistant_reply?: (ctx: PostAssistantReplyContext) => Promise<void> | void
}
