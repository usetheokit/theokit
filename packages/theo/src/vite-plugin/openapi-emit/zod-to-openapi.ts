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

function convertSchema(schema: z.ZodType, ctx: ConvertCtx): OpenApiSchema {
  const existing = ctx.seen.get(schema)
  if (existing !== undefined) {
    return { $ref: `#/components/schemas/${existing}` }
  }

  try {
    const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>
    return toOpenApi3(jsonSchema)
  } catch {
    return {}
  }
}

/**
 * Post-process JSON Schema (draft-2020-12) → OpenAPI 3.0.
 * Handles:
 *   - $schema removal
 *   - nullable conversion
 *   - Recursive normalization of properties/items/anyOf/oneOf/allOf
 */
function toOpenApi3(js: Record<string, unknown>): OpenApiSchema {
  const { $schema: _, $defs: _defs, ...rest } = js
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(rest)) {
    if (key === 'type' && Array.isArray(value)) {
      const types = value as string[]
      const hasNull = types.includes('null')
      const nonNull = types.filter((t: string) => t !== 'null')
      out.type = nonNull.length === 1 ? nonNull[0] : nonNull
      if (hasNull) out.nullable = true
    } else if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, OpenApiSchema> = {}
      for (const [pk, pv] of Object.entries(value as Record<string, unknown>)) {
        props[pk] = pv && typeof pv === 'object' ? toOpenApi3(pv as Record<string, unknown>) : (pv as OpenApiSchema)
      }
      out.properties = props
    } else if (key === 'items' && value && typeof value === 'object') {
      out.items = toOpenApi3(value as Record<string, unknown>)
    } else if ((key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(value)) {
      out[key] = (value as Record<string, unknown>[]).map((v) => toOpenApi3(v))
    } else if (key === 'additionalProperties' && value && typeof value === 'object') {
      out.additionalProperties = toOpenApi3(value as Record<string, unknown>)
    } else {
      out[key] = value
    }
  }

  return out as OpenApiSchema
}
