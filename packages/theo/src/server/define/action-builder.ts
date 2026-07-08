/**
 * M31 Phase 3 — `action()`, the fluent builder that replaces `defineAction({...})`.
 *
 * Pure type-state (mirrors `route-builder.ts`). `.input()` (required) sets the Zod schema whose
 * `z.infer<>` types the handler's `ctx.input`; `.handler()` (required) closes the chain. `.build()`
 * delegates to the internal {@link defineAction} (identity) — the action-execute path is UNCHANGED.
 *
 *   export const createUser = action()
 *     .input(z.object({ email: z.string().email() }))
 *     .handler(({ input }) => createUser(input.email))
 *     .build()
 */
import type { z } from 'zod'

import { defineAction, type ActionConfig, type ActionAccept } from './define-action.js'

/** Compile-error carrier: `.execute`/`.build()` reached before `.input()`. */
interface MissingInputError {
  readonly __theokitError: 'call .input(schema) before .handler(fn)'
}
/** Compile-error carrier: `.build()` before both `.input()` and `.handler()` are set. */
interface IncompleteActionError {
  readonly __theokitError: 'an action needs .input(schema) and .handler(fn) before .build()'
}

/** A required-but-unset field. Branded so no ordinary value satisfies it (tRPC UnsetMarker). */
type UnsetMarker = 'theokit.unset' & { readonly __brand: 'theokit.unset' }

/**
 * The fluent action builder. `TInput` tracks the Zod schema (drives `ctx.input` inference);
 * `THandlerSet` gates `.build()`.
 */
export interface ActionBuilder<
  TInput extends z.ZodType | UnsetMarker = UnsetMarker,
  TCtx = unknown,
  THandlerSet extends boolean = false,
> {
  /** Set the Zod input schema. Required — every action declares its input contract (zod-is-SSOT). */
  input<S extends z.ZodType>(schema: S): ActionBuilder<S, TCtx, THandlerSet>
  /** Wire-protocol accept mode (`'json'` default, `'form'` for FormData multipart). */
  accept(mode: ActionAccept): ActionBuilder<TInput, TCtx, THandlerSet>
  /** Opt out of CSRF enforcement for this action. */
  csrf(disabled: false): ActionBuilder<TInput, TCtx, THandlerSet>
  /**
   * Set the handler. COMPILE ERROR before `.input()` — the param type collapses to
   * {@link MissingInputError}. `ctx.input` is inferred via `z.infer<TInput>`.
   */
  handler(
    fn: TInput extends z.ZodType
      ? (ctx: { input: z.infer<TInput>; ctx: TCtx }) => unknown
      : MissingInputError,
  ): ActionBuilder<TInput, TCtx, true>
  /**
   * Resolve to the `ActionConfig` — the SAME value `defineAction({...})` returns. COMPILE ERROR when
   * `.input()` or `.handler()` was never called.
   */
  build(
    ...guard: THandlerSet extends true
      ? TInput extends z.ZodType
        ? []
        : [error: IncompleteActionError]
      : [error: IncompleteActionError]
  ): ActionConfig<TInput extends z.ZodType ? TInput : z.ZodType, TCtx>
}

type AnyActionConfig = ActionConfig<z.ZodType>

interface ActionSpecAccumulator {
  input?: z.ZodType
  accept?: ActionAccept
  csrf?: false
  handler?: AnyActionConfig['handler']
}

function makeActionBuilder(spec: ActionSpecAccumulator): ActionBuilder {
  const runtime = {
    input: (schema: z.ZodType) => makeActionBuilder({ ...spec, input: schema }),
    accept: (mode: ActionAccept) => makeActionBuilder({ ...spec, accept: mode }),
    csrf: (disabled: false) => makeActionBuilder({ ...spec, csrf: disabled }),
    handler: (fn: AnyActionConfig['handler']) => makeActionBuilder({ ...spec, handler: fn }),
    build: (): AnyActionConfig => {
      // Fail-fast for untyped (JS) callers — the type-state guards make this unreachable from TS.
      if (spec.input === undefined) {
        throw new Error('action(): call .input(schema) before .build()')
      }
      if (spec.handler === undefined) {
        throw new Error('action(): call .handler(fn) before .build()')
      }
      const config: AnyActionConfig = {
        input: spec.input,
        handler: spec.handler,
        ...(spec.accept !== undefined ? { accept: spec.accept } : {}),
        ...(spec.csrf !== undefined ? { csrf: spec.csrf } : {}),
      }
      return defineAction(config)
    },
  }
  return runtime as unknown as ActionBuilder
}

/**
 * Start a fluent action definition. Chain `.input()` (required), optionally `.accept()` / `.csrf()`,
 * then `.handler()` (required) and `.build()` for the `ActionConfig`.
 */
export function action(): ActionBuilder {
  return makeActionBuilder({})
}
