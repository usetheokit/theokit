import { z } from 'zod'

/**
 * Item #4 — `defineAgentTool`
 *
 * Sugar over the `@theokit/sdk` `CustomTool` contract. Takes a Zod schema +
 * handler and produces a structurally-compatible `CustomTool` that
 * `Agent.create({ tools: [...] })` accepts.
 *
 * Uses Zod v4's native `z.toJSONSchema()` to convert the input schema to
 * JSON Schema for LLM providers.
 *
 * Handler error propagation:
 *   `defineAgentTool` parses the input via the Zod schema BEFORE calling the
 *   user handler. Invalid input throws a `ZodError`, which the SDK's tool-
 *   dispatcher treats as a tool failure and surfaces to the model as a tool
 *   error (the SDK owns the wire; ADR D3).
 */

/**
 * Local mirror of the SDK's `CustomTool` interface. We don't `import type`
 * from `@theokit/sdk` because the SDK is an optional peer (consumers who
 * never call `defineAgentTool` shouldn't need it installed). The shape is
 * the wire contract; any structurally-matching object is accepted by
 * `Agent.create({ tools })`.
 *
 * @public
 */
/**
 * M48 — the tool-handler run context, a standalone mirror of `@theokit/sdk`'s tool `ctx` (kept in
 * sync by the `tests/type/custom-tool-mirror.test-d.ts` type gate). `context` (M7) is the object
 * supplied once at agent/run level; `messages` (SE12) is a read-only transcript projection of the
 * current turn; `threadId` (#119) is the run's session identity — so a stateful tool shared across
 * sessions can scope its state per session instead of leaking it. Standalone (no `@theokit/sdk`
 * import) because the SDK is an optional peer.
 */
export interface ToolHandlerContext {
  signal?: AbortSignal
  context?: unknown
  messages?: readonly ToolContextMessage[]
  threadId?: string
}

/** SE12 — a read-only, text-only projection of a turn message (mirror of the SDK type). */
export interface ToolContextMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CustomTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /**
   * Returns `string` (theokit's `defineAgentTool` maps every result to the model-visible string).
   * The SDK's `CustomTool` handler return is WIDER (`string | ToolResultContentBlock[]`, SE7); a
   * `string`-returning handler is a valid subtype the SDK accepts — the type gate asserts
   * `mirror ⊆ SDK` for the return (covariant) and `mirror === SDK` for the `ctx` param (contravariant,
   * to catch #119 `ctx.threadId` drift). See `tests/type/custom-tool-mirror.test-d.ts`.
   */
  handler: (input: Record<string, unknown>, ctx?: ToolHandlerContext) => string | Promise<string>
  /** M18 — optional per-target formatters for the app's UI/transcript (ignored by the SDK wire). */
  transform?: ToolTransform
}

/**
 * M18 — per-target formatters. `display` shapes the rich handler result for the UI; `transcript`
 * shapes it for a saved transcript. Applied by {@link applyTransform}, never by the model wire.
 */
export interface ToolTransform<R = unknown> {
  display?: (result: R) => unknown
  transcript?: (result: R) => unknown
}

/**
 * Spec accepted by {@link defineAgentTool}. `inputSchema` is a Zod 3 schema
 * rooted in `z.object(...)`. The `handler` argument type is inferred via
 * `z.infer<T>`.
 *
 * @public
 */
export interface DefineAgentToolSpec<T extends z.ZodType, R = string> {
  /** Tool name surfaced to the LLM. Must match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`. */
  name: string
  /** Description surfaced to the LLM. Required — drives tool-selection accuracy. */
  description: string
  /** Zod schema describing the input. Must be `z.object(...)` at the root. */
  inputSchema: T
  /**
   * Handler invoked with the parsed input and, optionally, the run `ctx` (M7). `ctx.context`
   * is the object supplied once at the agent level (`defineAgent({ context })`) or per-run —
   * read it for shared config like `projectRoot` instead of baking it into the factory.
   * `ctx.signal` is the abort signal. Optional so existing one-arg handlers keep working.
   *
   * M18 — the handler may return RICH data `R`, not just a string. Without a `toModelOutput` the
   * result is JSON-serialized for the model (#464); provide one when the model should see a
   * different shape than the app does.
   */
  handler: (input: z.infer<T>, ctx?: ToolHandlerContext) => R | Promise<R>
  /**
   * M18 — map the rich handler result `R` to the string the model sees.
   *
   * Optional. Without it a non-string result is JSON-serialized (#464); this is for when the shape
   * the model should see differs from the shape the app wants — a summary line instead of the whole
   * record. The docblock said "required (in practice)" and that parenthesis was the defect: the
   * type never said it, only the first live tool call did.
   */
  toModelOutput?: (result: R) => string
  /** M18 — per-target formatters (`display` / `transcript`) for the app, applied by {@link applyTransform}. */
  transform?: ToolTransform<R>
}

/**
 * The string the model sees when the tool declares no `toModelOutput`.
 *
 * A non-string result used to throw, asking for a `toModelOutput` (#464). The message was right and
 * the moment was the worst available: the first time the MODEL calls the tool, inside an agent run,
 * with a provider key and tokens already spent. And returning an object is the natural shape — a
 * tool answering `{ id, status, note }` serves a model better than one concatenating a string by
 * hand — so it was the common path, not an edge.
 *
 * Requiring it in the TYPE was the other candidate, and it keeps the ceremony: every consumer's
 * correction was the same single line, `.toModelOutput((r) => JSON.stringify(r))`. A default that
 * every caller overrides identically is a default on the wrong side. `toModelOutput` still wins
 * whenever the shape matters — this only decides what happens when nobody said.
 *
 * The throw survives for exactly the results no default can serialize, and says which one it hit.
 * Asking for a `toModelOutput` there would be advice that does not help: it cannot rescue a cycle.
 */
function toModelString(toolName: string, result: unknown): string {
  if (typeof result === 'string') return result

  // Checked on the INPUT, not on `JSON.stringify`'s return. TypeScript types that as `string` and
  // it is not — a function, a symbol or `undefined` yields `undefined` — so a guard on the output
  // reads as dead code to a type-aware linter and invites deletion, which would put the crash back
  // in the consumer's agent run. These three are the whole set JSON cannot represent at the top
  // level.
  if (result === undefined || typeof result === 'function' || typeof result === 'symbol') {
    throw new Error(
      `defineAgentTool(${JSON.stringify(toolName)}): the handler result could not be serialized for the model — JSON has no representation for ${typeof result}. Return a string, or add toModelOutput to map it.`,
    )
  }

  try {
    return JSON.stringify(result)
  } catch (cause) {
    // Circular structures and BigInt both land here.
    throw new Error(
      `defineAgentTool(${JSON.stringify(toolName)}): the handler result could not be serialized for the model (${cause instanceof Error ? cause.message : String(cause)}). Return a string, or add toModelOutput to map it.`,
      { cause },
    )
  }
}

const TOOL_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/

function isZodObject(schema: z.ZodType): boolean {
  // Refinements (`.refine`), transforms (`.transform`), and defaults wrap the
  // underlying schema — walk the chain until we hit a ZodObject (or give up).
  // Supports both zod 4 (`instanceof z.ZodObject`, `def.type === 'object'`,
  // wrappers via `def.innerType` / pipe via `def.in`) and zod 3
  // (`_def.typeName === 'ZodObject'`, wrappers via `_def.schema`/`_def.innerType`).
  let current: unknown = schema
  for (let depth = 0; depth < 10; depth++) {
    if (current instanceof z.ZodObject) return true
    const z4 = (current as { def?: { type?: string; innerType?: unknown; in?: unknown } }).def
    if (z4?.type === 'object') return true
    const z3 = (current as { _def?: { typeName?: string; schema?: unknown; innerType?: unknown } })
      ._def
    if (z3?.typeName === 'ZodObject') return true
    const next = z4?.innerType ?? z4?.in ?? z3?.schema ?? z3?.innerType
    if (next !== undefined) {
      current = next
      continue
    }
    return false
  }
  return false
}

/**
 * Build a {@link CustomTool} from a Zod 3 schema + handler.
 *
 * Behavior:
 * - Validates `name` matches the LLM tool-name regex.
 * - Requires `inputSchema` to be a `ZodObject` (Anthropic + SDK contract).
 * - Warns (not throws) if `description` is empty — empty descriptions
 *   degrade LLM tool selection.
 * - Converts the Zod schema to JSON Schema 7 inline (no `$ref`s — LLMs handle
 *   inline schemas more reliably).
 * - Strips the top-level `$schema` field (Anthropic rejects schemas with
 *   `$schema` at root in some provider modes).
 * - Wraps the handler to parse the input via the Zod schema BEFORE invoking
 *   the user code — bad LLM-supplied input throws `ZodError`, which the SDK
 *   converts to `tool_result(isError)`.
 *
 * @public
 */
export function defineAgentTool<T extends z.ZodType, R = string>(
  spec: DefineAgentToolSpec<T, R>,
): CustomTool {
  if (!TOOL_NAME_REGEX.test(spec.name)) {
    throw new Error(
      `defineAgentTool: name must match ${TOOL_NAME_REGEX.source}. Got: ${JSON.stringify(spec.name)}`,
    )
  }
  if (!isZodObject(spec.inputSchema)) {
    throw new Error('defineAgentTool: inputSchema must be a ZodObject (z.object({...}))')
  }
  if (spec.description.length === 0) {
    console.warn(
      `defineAgentTool(${JSON.stringify(spec.name)}): empty description degrades LLM tool selection — provide a one-sentence summary.`,
    )
  }

  // Zod v4 native JSON Schema conversion — replaces zod-to-json-schema dep.
  // Strip $schema (Anthropic + some providers reject it).
  const { $schema: _$schema, ...inputSchema } = z.toJSONSchema(spec.inputSchema) as Record<
    string,
    unknown
  > & {
    $schema?: unknown
  }

  return {
    name: spec.name,
    description: spec.description,
    inputSchema,
    handler: async (input: Record<string, unknown>, ctx?: ToolHandlerContext): Promise<string> => {
      const parsed = spec.inputSchema.parse(input)
      // M7 — forward the run ctx so the handler can read `ctx.context` (e.g. projectRoot).
      const result = await spec.handler(parsed, ctx)
      // M18 — shape the (possibly rich) result into the model-visible string.
      if (spec.toModelOutput) return spec.toModelOutput(result)
      return toModelString(spec.name, result)
    },
    // M18 — carry the per-target formatters for the app (ignored by the SDK wire).
    ...(spec.transform !== undefined ? { transform: spec.transform as ToolTransform } : {}),
  }
}

/**
 * M18 — apply a tool's `transform` for a target (`display` / `transcript`). Returns the formatted
 * value, or the raw `result` when the tool declares no transform for that target.
 */
export function applyTransform(
  tool: CustomTool,
  result: unknown,
  target: 'display' | 'transcript',
): unknown {
  const fn = tool.transform?.[target]
  return fn ? fn(result) : result
}
