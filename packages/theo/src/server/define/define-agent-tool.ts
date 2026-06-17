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
 *   dispatcher (or the `streamAgentRun` adapter) sees as a tool failure and
 *   surfaces as an `error` AgentEvent on the SSE wire (ADR D3).
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
export interface CustomTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (input: Record<string, unknown>) => string | Promise<string>
}

/**
 * Spec accepted by {@link defineAgentTool}. `inputSchema` is a Zod 3 schema
 * rooted in `z.object(...)`. The `handler` argument type is inferred via
 * `z.infer<T>`.
 *
 * @public
 */
export interface DefineAgentToolSpec<T extends z.ZodType> {
  /** Tool name surfaced to the LLM. Must match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`. */
  name: string
  /** Description surfaced to the LLM. Required — drives tool-selection accuracy. */
  description: string
  /** Zod schema describing the input. Must be `z.object(...)` at the root. */
  inputSchema: T
  /** Handler invoked with the parsed input. */
  handler: (input: z.infer<T>) => string | Promise<string>
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
export function defineAgentTool<T extends z.ZodType>(spec: DefineAgentToolSpec<T>): CustomTool {
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
    handler: async (input: Record<string, unknown>): Promise<string> => {
      const parsed = spec.inputSchema.parse(input)
      return await spec.handler(parsed)
    },
  }
}
