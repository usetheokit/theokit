/**
 * M31 Phase 1 — `tool()`, the fluent builder that replaces `defineAgentTool({...})`.
 *
 * Pure type-state (tRPC `UnsetMarker` technique, mirroring `agent-builder.ts`). The runtime is a
 * plain accumulator; `.build()` delegates to the internal {@link defineAgentTool}, so the emitted
 * `CustomTool` is byte-for-byte the legacy shape — the SDK/agent compile path is UNCHANGED
 * (identity-shape delegation, blueprint §2).
 *
 * PURE metadata (G2 / sdk-runtime.md): a tool describes a capability; it NEVER calls an LLM.
 *
 *   tool('read')
 *     .describe('Read a UTF-8 file')
 *     .input(z.object({ path: z.string() }))
 *     .execute(async ({ path }, ctx) => readFile(resolveInProject(ctx, path)))
 *     .build()
 */
import type { z } from 'zod'

import { defineAgentTool, type CustomTool, type ToolTransform } from './define-agent-tool.js'

/** A required-but-unset builder field. Branded so no ordinary value satisfies it (tRPC UnsetMarker). */
type UnsetMarker = 'theokit.unset' & { readonly __brand: 'theokit.unset' }

/** Compile-error carrier: `.execute()` called before `.input()`. */
interface MissingInputError {
  readonly __theokitError: 'call .input(schema) before .execute(handler)'
}
/** Compile-error carrier: `.build()` called before both `.input()` and `.execute()` are set. */
interface IncompleteToolError {
  readonly __theokitError: 'a tool needs .input(schema) and .execute(handler) before .build()'
}

/** The run context a tool handler receives (M7). */
interface ToolCtx {
  signal?: AbortSignal
  context?: unknown
}

/**
 * The fluent tool builder. Each method returns a NEW builder type with the relevant type parameter
 * advanced. `TInput` tracks the Zod schema (drives `execute` input inference); `R` tracks the
 * handler result; `THandlerSet` gates `.build()`.
 */
export interface ToolBuilder<
  TName extends string = string,
  TInput extends z.ZodType | UnsetMarker = UnsetMarker,
  R = string,
  THandlerSet extends boolean = false,
> {
  /** Set the LLM-facing description. Optional; an empty description warns at build (LLM selection). */
  describe(description: string): ToolBuilder<TName, TInput, R, THandlerSet>
  /** Set the Zod input schema (must be `z.object(...)` at the root). Required before `.execute()`. */
  input<S extends z.ZodType>(schema: S): ToolBuilder<TName, S, R, THandlerSet>
  /**
   * Set the handler. COMPILE ERROR when `.input()` was not called first — the parameter type
   * collapses to {@link MissingInputError}. The `input` argument is inferred via `z.infer<TInput>`.
   */
  execute<R2>(
    handler: TInput extends z.ZodType
      ? (input: z.infer<TInput>, ctx?: ToolCtx) => R2 | Promise<R2>
      : MissingInputError,
  ): ToolBuilder<TName, TInput, R2, true>
  /** M18 — map a rich handler result to the model-visible string. */
  toModelOutput(fn: (result: R) => string): ToolBuilder<TName, TInput, R, THandlerSet>
  /** M18 — per-target formatters (`display` / `transcript`) for the app UI/transcript. */
  transform(t: ToolTransform<R>): ToolBuilder<TName, TInput, R, THandlerSet>
  /**
   * Resolve to the `CustomTool` — the SAME value `defineAgentTool({...})` returns. COMPILE ERROR
   * when `.input()` or `.execute()` was never called.
   */
  build(
    ...guard: THandlerSet extends true
      ? TInput extends z.ZodType
        ? []
        : [error: IncompleteToolError]
      : [error: IncompleteToolError]
  ): CustomTool
}

interface ToolSpecAccumulator {
  name: string
  description?: string
  inputSchema?: z.ZodType
  handler?: (input: unknown, ctx?: ToolCtx) => unknown
  toModelOutput?: (result: unknown) => string
  transform?: ToolTransform
}

/**
 * Build the runtime accumulator. The public method signatures carry the type-state generics + the
 * compile-time guards; the runtime cannot track generics, so the object is bridged to the typed
 * interface once here (the single, documented type-state impl seam — same technique as agent-builder).
 */
function makeToolBuilder(spec: ToolSpecAccumulator): ToolBuilder {
  const runtime = {
    describe: (description: string) => makeToolBuilder({ ...spec, description }),
    input: (schema: z.ZodType) => makeToolBuilder({ ...spec, inputSchema: schema }),
    execute: (handler: (input: unknown, ctx?: ToolCtx) => unknown) =>
      makeToolBuilder({ ...spec, handler }),
    toModelOutput: (fn: (result: unknown) => string) =>
      makeToolBuilder({ ...spec, toModelOutput: fn }),
    transform: (t: ToolTransform) => makeToolBuilder({ ...spec, transform: t }),
    build: (): CustomTool => {
      // Fail-fast: the type-state guards make these unreachable from typed callers, but an untyped
      // (JS) caller could skip them — surface a clear error instead of a confusing downstream one.
      if (spec.inputSchema === undefined) {
        throw new Error(`tool(${JSON.stringify(spec.name)}): call .input(schema) before .build()`)
      }
      if (spec.handler === undefined) {
        throw new Error(
          `tool(${JSON.stringify(spec.name)}): call .execute(handler) before .build()`,
        )
      }
      return defineAgentTool({
        name: spec.name,
        description: spec.description ?? '',
        inputSchema: spec.inputSchema,
        handler: spec.handler,
        ...(spec.toModelOutput !== undefined ? { toModelOutput: spec.toModelOutput } : {}),
        ...(spec.transform !== undefined ? { transform: spec.transform } : {}),
      })
    },
  }
  return runtime as unknown as ToolBuilder
}

/**
 * Start a fluent tool definition. Chain `.input()` + `.execute()` (both required), optionally
 * `.describe()` / `.toModelOutput()` / `.transform()`, then `.build()` for the `CustomTool`.
 */
export function tool<TName extends string>(name: TName): ToolBuilder<TName> {
  return makeToolBuilder({ name })
}
