/**
 * In-house Zod → OpenAPI 3.x Schema converter (build-time only).
 *
 * Per G2 plan v1.1 ADR D1 + EC-1: installed zod is 3.x (no native
 * `.toJSONSchema()`). This module is the PRIMARY conversion path.
 * Algorithm modelled on encore's `pkg/clientgen/openapi/schema.go`:
 * recursive descent + seen-map for cycle detection (named refs).
 *
 * Pure function: no I/O, no module loading. Caller extracts the Zod
 * schemas from `defineRoute({body, query, params})` and passes them
 * here. Returned `OpenApiSchema` is a structural subset of the OpenAPI
 * 3.0/3.1 Schema Object — fields populated as needed.
 *
 * NEVER ship to runtime — devDep-shaped artifact.
 *
 * Unsupported Zod constructs (z.function(), z.promise()) throw a
 * `ZodToOpenApiError` with a descriptive message so the caller can
 * surface the offending route + advise the user.
 */
import type { z } from 'zod'

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
  $ref?: string
  // OpenAPI 3.1 (JSON Schema 2020-12) allows `type: [..., 'null']`; for now
  // we stick with 3.0-compatible `nullable: true`. Caller can transform at
  // emit time if specVersion === '3.1.0'.
}

export interface ConvertCtx {
  /** Seen-map: zod schema reference → component name (for $ref cycle detection). */
  seen: Map<z.ZodType, string>
  /** Output bucket for named component schemas. */
  components: Record<string, OpenApiSchema>
}

export interface ConvertOptions {
  /**
   * Optional context carried across recursive calls. Pass the SAME ctx to
   * every `zodToOpenApiSchema` invocation in one emit pass so cycle
   * detection works across multiple routes.
   */
  ctx?: ConvertCtx
  /**
   * If provided, the schema is registered under `components.schemas[name]`
   * and the returned value is `{ $ref: '#/components/schemas/<name>' }`.
   * Use this for top-level recursive types where the consumer (e.g.,
   * OpenAPI document builder) wants named schemas instead of inlined ones.
   */
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
    // Top-level named schema — register placeholder BEFORE recursing, then
    // patch the slot with the computed body. This avoids infinite recursion
    // for self-referential types (encore schema.go:289 pattern).
    if (Object.prototype.hasOwnProperty.call(ctx.components, name)) {
      return { $ref: `#/components/schemas/${name}` }
    }
    ctx.seen.set(schema, name)
    ctx.components[name] = {} // placeholder
    const body = convert(schema, ctx)
    ctx.components[name] = body
    return { $ref: `#/components/schemas/${name}` }
  }

  return convert(schema, ctx)
}

// eslint-disable-next-line complexity -- switch-based dispatch on Zod typeName; splitting hides intent
function convert(schema: z.ZodType, ctx: ConvertCtx): OpenApiSchema {
  // Cycle: if we've seen this exact schema reference before, emit $ref.
  const existing = ctx.seen.get(schema)
  if (existing !== undefined) {
    return { $ref: `#/components/schemas/${existing}` }
  }

  const def = (schema as unknown as { _def: { typeName?: string } })._def
  const typeName = def.typeName ?? ''

  switch (typeName) {
    case 'ZodString':
      return convertString(schema)
    case 'ZodNumber':
      return convertNumber(schema)
    case 'ZodBoolean':
      return { type: 'boolean' }
    case 'ZodLiteral':
      return convertLiteral(schema)
    case 'ZodEnum':
      return convertEnum(schema)
    case 'ZodArray':
      return convertArray(schema, ctx)
    case 'ZodObject':
      return convertObject(schema, ctx)
    case 'ZodUnion':
      return convertUnion(schema, ctx)
    case 'ZodDiscriminatedUnion':
      return convertDiscriminatedUnion(schema, ctx)
    case 'ZodOptional':
      // Optional-as-property is handled at object level; here we unwrap.
      return convert((schema as unknown as { _def: { innerType: z.ZodType } })._def.innerType, ctx)
    case 'ZodNullable': {
      const inner = convert(
        (schema as unknown as { _def: { innerType: z.ZodType } })._def.innerType,
        ctx,
      )
      return { ...inner, nullable: true }
    }
    case 'ZodEffects':
    case 'ZodTransform':
      // Transforms change runtime output, but the WIRE shape is the input.
      return convert((schema as unknown as { _def: { schema: z.ZodType } })._def.schema, ctx)
    case 'ZodDefault':
      return convert((schema as unknown as { _def: { innerType: z.ZodType } })._def.innerType, ctx)
    case 'ZodLazy': {
      const getter = (schema as unknown as { _def: { getter: () => z.ZodType } })._def.getter
      return convert(getter(), ctx)
    }
    case 'ZodRecord': {
      const valueType = (schema as unknown as { _def: { valueType: z.ZodType } })._def.valueType
      return { type: 'object', additionalProperties: convert(valueType, ctx) }
    }
    case 'ZodAny':
    case 'ZodUnknown':
      return {} // no constraint
    case 'ZodNull':
      return { type: 'null' }
    case 'ZodFunction':
      throw new ZodToOpenApiError(
        'Unsupported Zod type: z.function() cannot be represented in OpenAPI Schema. Remove from the route schema.',
      )
    case 'ZodPromise':
      throw new ZodToOpenApiError(
        'Unsupported Zod type: z.promise() cannot be represented in OpenAPI Schema. Unwrap the value before passing to defineRoute.',
      )
    default:
      throw new ZodToOpenApiError(
        `Unsupported Zod type: ${typeName || '(unknown)'}. Open an issue if this construct should be supported.`,
      )
  }
}

interface StringCheck {
  kind: string
}

function convertString(schema: z.ZodType): OpenApiSchema {
  const def = (schema as unknown as { _def: { checks?: StringCheck[] } })._def
  const checks = def.checks ?? []
  const out: OpenApiSchema = { type: 'string' }
  for (const c of checks) {
    if (c.kind === 'email') out.format = 'email'
    else if (c.kind === 'uuid') out.format = 'uuid'
    else if (c.kind === 'url') out.format = 'uri'
    else if (c.kind === 'datetime') out.format = 'date-time'
  }
  return out
}

interface NumberCheck {
  kind: string
}

function convertNumber(schema: z.ZodType): OpenApiSchema {
  const def = (schema as unknown as { _def: { checks?: NumberCheck[] } })._def
  const checks = def.checks ?? []
  const isInt = checks.some((c) => c.kind === 'int')
  return { type: isInt ? 'integer' : 'number' }
}

function convertLiteral(schema: z.ZodType): OpenApiSchema {
  const value = (schema as unknown as { _def: { value: unknown } })._def.value
  const typed = literalTypeOf(value)
  if (typed === null) {
    // Null literal
    return { type: 'null', enum: [null] }
  }
  return { type: typed, enum: [value] }
}

function literalTypeOf(value: unknown): OpenApiSchema['type'] | null {
  if (value === null) return null
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string' // fallback for symbol/etc.
}

function convertEnum(schema: z.ZodType): OpenApiSchema {
  const values = (schema as unknown as { _def: { values: readonly string[] } })._def.values
  return { type: 'string', enum: [...values] }
}

function convertArray(schema: z.ZodType, ctx: ConvertCtx): OpenApiSchema {
  const inner = (schema as unknown as { _def: { type: z.ZodType } })._def.type
  return { type: 'array', items: convert(inner, ctx) }
}

function convertObject(schema: z.ZodType, ctx: ConvertCtx): OpenApiSchema {
  const shape = (schema as unknown as { shape: Record<string, z.ZodType> }).shape
  const properties: Record<string, OpenApiSchema> = {}
  const required: string[] = []
  for (const [key, child] of Object.entries(shape)) {
    properties[key] = convert(child, ctx)
    const childDef = (child as unknown as { _def: { typeName?: string } })._def
    const isOptional = childDef.typeName === 'ZodOptional' || childDef.typeName === 'ZodDefault'
    if (!isOptional) required.push(key)
  }
  const out: OpenApiSchema = {
    type: 'object',
    properties,
    additionalProperties: false,
  }
  if (required.length > 0) out.required = required
  return out
}

function convertUnion(schema: z.ZodType, ctx: ConvertCtx): OpenApiSchema {
  const options = (schema as unknown as { _def: { options: z.ZodType[] } })._def.options
  return { oneOf: options.map((o) => convert(o, ctx)) }
}

function convertDiscriminatedUnion(schema: z.ZodType, ctx: ConvertCtx): OpenApiSchema {
  const def = (
    schema as unknown as {
      _def: { discriminator: string; options: z.ZodType[] }
    }
  )._def
  return {
    oneOf: def.options.map((o) => convert(o, ctx)),
    discriminator: { propertyName: def.discriminator },
  }
}
