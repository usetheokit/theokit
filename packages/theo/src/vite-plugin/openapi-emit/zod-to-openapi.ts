/**
 * Zod → OpenAPI 3.0 Schema converter (build-time only).
 *
 * Uses Zod v4's native `z.toJSONSchema()` and post-processes
 * the JSON Schema output into OpenAPI 3.0 format:
 *   - Removes `$schema` (invalid in OpenAPI 3.0)
 *   - Converts `type: ["string", "null"]` → `{ type: "string", nullable: true }`
 *   - Recursively normalizes nested schemas
 *
 * NEVER ship to runtime — devDep-shaped artifact.
 */
import { z } from 'zod'

export interface OpenApiSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null'
  format?: string
  items?: OpenApiSchema
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  additionalProperties?: boolean | OpenApiSchema
  oneOf?: OpenApiSchema[]
  anyOf?: OpenApiSchema[]
  allOf?: OpenApiSchema[]
  discriminator?: { propertyName: string; mapping?: Record<string, string> }
  enum?: unknown[]
  nullable?: boolean
  description?: string
  default?: unknown
  $ref?: string
}

export interface ConvertCtx {
  seen: Map<z.ZodType, string>
  components: Record<string, OpenApiSchema>
}

export interface ConvertOptions {
  ctx?: ConvertCtx
  name?: string
}

export class ZodToOpenApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZodToOpenApiError'
  }
}

export function zodToOpenApiSchema(schema: z.ZodType, options: ConvertOptions = {}): OpenApiSchema {
  const ctx: ConvertCtx = options.ctx ?? { seen: new Map(), components: {} }

  const name = options.name
  if (name !== undefined) {
    if (Object.prototype.hasOwnProperty.call(ctx.components, name)) {
      return { $ref: `#/components/schemas/${name}` }
    }
    ctx.seen.set(schema, name)
    ctx.components[name] = {}
    const body = convertSchema(schema, ctx)
    ctx.components[name] = body
    return { $ref: `#/components/schemas/${name}` }
  }

  return convertSchema(schema, ctx)
}

interface ZodInternalDef {
  type?: string
  discriminator?: string
  in?: z.ZodType
}

/** Read zod v4's internal schema def (the `.def` getter) without a hard `any`. */
function zodDef(schema: z.ZodType): ZodInternalDef | undefined {
  return (schema as unknown as { def?: ZodInternalDef }).def
}

function convertSchema(schema: z.ZodType, ctx: ConvertCtx): OpenApiSchema {
  const existing = ctx.seen.get(schema)
  if (existing !== undefined) {
    return { $ref: `#/components/schemas/${existing}` }
  }

  const def = zodDef(schema)
  // Fail loud on schema kinds that have no OpenAPI representation (rather than
  // swallowing the zod throw into `{}`). z.function() is the canonical case.
  if (def?.type === 'function') {
    throw new ZodToOpenApiError(
      'z.function() cannot be represented in an OpenAPI schema (functions are not serializable).',
    )
  }

  // A transform / pipe (`z.string().transform(...)`) has no JSON-Schema of its
  // own — zod throws. The wire shape is the INPUT (transforms run post-parse),
  // so emit the input schema. This avoids the global `io: 'input'` mode, which
  // would also flip object `additionalProperties` semantics.
  if (def?.type === 'pipe' && def.in !== undefined) {
    return convertSchema(def.in, ctx)
  }

  try {
    const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>
    const out = toOpenApi3(jsonSchema)
    // zod v4 emits a discriminated union as `oneOf` but drops the discriminator
    // key; re-attach it from the zod def so OpenAPI consumers can branch.
    if (def?.type === 'union' && def.discriminator !== undefined && out.oneOf !== undefined) {
      out.discriminator = { propertyName: def.discriminator }
    }
    return out
  } catch (err) {
    if (err instanceof ZodToOpenApiError) throw err
    return {}
  }
}

/** JS safe-integer bounds zod v4 attaches to `.int()` — noise for OpenAPI, stripped. */
const SAFE_INT_MIN = Number.MIN_SAFE_INTEGER
const SAFE_INT_MAX = Number.MAX_SAFE_INTEGER

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Drop zod-v4 noise keys: redundant `pattern` when `format` is set; JS safe-integer sentinel bounds. */
function isNoiseKey(key: string, value: unknown, isInteger: boolean, hasFormat: boolean): boolean {
  if (key === 'pattern' && hasFormat) return true
  if (isInteger && key === 'minimum' && value === SAFE_INT_MIN) return true
  if (isInteger && key === 'maximum' && value === SAFE_INT_MAX) return true
  return false
}

/** Recursively normalize one JSON-Schema value (properties/items/*Of/additionalProperties). */
function normalizeValue(key: string, value: unknown): unknown {
  if (key === 'properties' && isRecord(value)) {
    const props: Record<string, unknown> = {}
    for (const [pk, pv] of Object.entries(value)) props[pk] = isRecord(pv) ? toOpenApi3(pv) : pv
    return props
  }
  if (key === 'items' && isRecord(value)) return toOpenApi3(value)
  if ((key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(value)) {
    const arr: unknown[] = value
    return arr.map((v) => (isRecord(v) ? toOpenApi3(v) : v))
  }
  if (key === 'additionalProperties' && isRecord(value)) return toOpenApi3(value)
  return value
}

/** Convert zod v4's `anyOf` (used for `.nullable()` + `z.union()`) to OpenAPI 3.0 shape. */
function convertAnyOf(branches: unknown[], rest: Record<string, unknown>): OpenApiSchema {
  const records = branches.filter(isRecord)
  const hasNull = records.some((b) => b.type === 'null')
  const nonNull = records.filter((b) => b.type !== 'null')
  if (hasNull && nonNull.length === 1) {
    return { ...toOpenApi3(nonNull[0]), nullable: true }
  }
  const result: OpenApiSchema = { oneOf: nonNull.map((b) => toOpenApi3(b)) }
  if (hasNull) result.nullable = true
  for (const [k, v] of Object.entries(rest))
    if (k !== 'anyOf') (result as Record<string, unknown>)[k] = v
  return result
}

/**
 * Post-process JSON Schema (draft-2020-12) → OpenAPI 3.0:
 *   - strip `$schema`/`$defs`
 *   - `.nullable()`/union `anyOf` → `nullable: true` / `oneOf`
 *   - `type: ["string","null"]` → `{ type: "string", nullable: true }`
 *   - drop zod-v4 noise (redundant pattern, safe-integer bounds)
 *   - recurse into nested schemas
 */
function toOpenApi3(js: Record<string, unknown>): OpenApiSchema {
  const { $schema: _, $defs: _defs, ...rest } = js
  if (Array.isArray(rest.anyOf)) return convertAnyOf(rest.anyOf, rest)

  const isInteger = rest.type === 'integer'
  const hasFormat = typeof rest.format === 'string'
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(rest)) {
    if (isNoiseKey(key, value, isInteger, hasFormat)) continue
    // `const` is JSON-Schema / OpenAPI-3.1 only; `enum: [x]` is the 3.0-and-3.1
    // compatible spelling. zod v4 emits `const` for literals (discriminator tags).
    if (key === 'const') {
      out.enum = [value]
      continue
    }
    if (key === 'type' && Array.isArray(value)) {
      const types = value.filter((t): t is string => typeof t === 'string')
      const nonNull = types.filter((t) => t !== 'null')
      out.type = nonNull.length === 1 ? nonNull[0] : nonNull
      if (types.includes('null')) out.nullable = true
    } else {
      out[key] = normalizeValue(key, value)
    }
  }

  return out
}
