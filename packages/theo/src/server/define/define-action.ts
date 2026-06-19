import type { z } from 'zod'

/**
 * Action wire-protocol accept mode per plan g3-server-actions-and-useaction
 * v1.2 ADR D1. Default behavior (when omitted) is `'json'`. `'form'` opts the
 * action into FormData multipart parsing for progressive-enhancement forms;
 * the runtime in `server/http/action-execute.ts` will coerce FormData entries
 * against the `input` schema via `formDataToObject` (Astro pattern).
 */
export type ActionAccept = 'form' | 'json'

export interface ActionConfig<TInput extends z.ZodType, TCtx = unknown> {
  /**
   * Zod input schema. Required: every action declares its input contract via
   * Zod (architecture rule: zod-is-SSOT). The shape becomes the handler's
   * typed `input` parameter via `z.infer<TInput>`.
   */
  input: TInput
  /**
   * Wire-protocol accept mode. Defaults to `'json'` when omitted. Setting
   * `'form'` switches the runtime to FormData multipart parsing — the input
   * schema MUST be `z.object(...)` so field-by-field coercion can drive
   * boolean string / number / array coercion (Astro pattern).
   */
  accept?: ActionAccept
  /**
   * Opt OUT of CSRF enforcement for this action. Default (omitted) keeps the
   * multi-header CSRF gate active. Set `false` for endpoints intentionally
   * callable without the `X-Theo-Action` header (e.g. public webhooks). The
   * runtime in `server/http/action-execute.ts` reads this flag.
   */
  csrf?: false
  handler: (ctx: { input: z.infer<TInput>; ctx: TCtx }) => unknown
}

/**
 * Define a typed server action.
 *
 * Identity function — provides type inference for action handlers. The
 * runtime that consumes the config (validation + invocation + serialization)
 * lives in `server/http/action-execute.ts`.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 1 / T1.2: the new
 * `accept?: 'form' | 'json'` field is the only contract change vs the
 * pre-G3 identity. Existing callsites (`defineAction({input, handler})`)
 * continue to compile — `accept` is opt-in.
 */
export function defineAction<TInput extends z.ZodType, TCtx = unknown>(
  config: ActionConfig<TInput, TCtx>,
): ActionConfig<TInput, TCtx> {
  return config
}
