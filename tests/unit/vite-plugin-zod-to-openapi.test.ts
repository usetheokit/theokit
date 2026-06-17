/**
 * Zod → OpenAPI Schema conversion (build-time only).
 *
 * Installed zod is v4 (`z.toJSONSchema()` native). The converter delegates to
 * `z.toJSONSchema()` and normalizes the draft-2020-12 output to OpenAPI 3.0/3.1
 * (nullable/oneOf/const→enum/discriminator/etc. — see zod-to-openapi.ts).
 *
 * Pure function — no I/O, no module loading. Caller is responsible for
 * extracting the Zod schemas from `defineRoute()` config objects.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  ZodToOpenApiError,
  zodToOpenApiSchema,
  type ConvertCtx,
  type OpenApiSchema,
} from '../../packages/theo/src/vite-plugin/openapi-emit/zod-to-openapi.js'

describe('zodToOpenApiSchema — primitives', () => {
  it('z.string() → { type: "string" }', () => {
    expect(zodToOpenApiSchema(z.string())).toEqual({ type: 'string' })
  })

  it('z.number() → { type: "number" }', () => {
    expect(zodToOpenApiSchema(z.number())).toEqual({ type: 'number' })
  })

  it('z.number().int() → { type: "integer" }', () => {
    const r = zodToOpenApiSchema(z.number().int())
    expect(r).toEqual({ type: 'integer' })
  })

  it('z.boolean() → { type: "boolean" }', () => {
    expect(zodToOpenApiSchema(z.boolean())).toEqual({ type: 'boolean' })
  })

  it('z.email() → { type: "string", format: "email" }', () => {
    expect(zodToOpenApiSchema(z.email())).toEqual({
      type: 'string',
      format: 'email',
    })
  })

  it('z.uuid() → { type: "string", format: "uuid" }', () => {
    expect(zodToOpenApiSchema(z.uuid())).toEqual({
      type: 'string',
      format: 'uuid',
    })
  })
})

describe('zodToOpenApiSchema — composites', () => {
  it('z.array(z.string()) → { type: "array", items: { type: "string" } }', () => {
    expect(zodToOpenApiSchema(z.array(z.string()))).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
  })

  it('z.object({name: z.string()}) → object with required name', () => {
    expect(zodToOpenApiSchema(z.object({ name: z.string() }))).toEqual({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    })
  })

  it('z.object with optional drops field from required[]', () => {
    expect(zodToOpenApiSchema(z.object({ name: z.string(), age: z.number().optional() }))).toEqual({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'number' } },
      required: ['name'],
      additionalProperties: false,
    })
  })

  it('z.nullable wraps type with `nullable: true` (3.x compat shape)', () => {
    const r = zodToOpenApiSchema(z.string().nullable()) as { type: string; nullable?: boolean }
    expect(r.type).toBe('string')
    expect(r.nullable).toBe(true)
  })
})

describe('zodToOpenApiSchema — unions', () => {
  it('z.union of primitives → oneOf', () => {
    const r = zodToOpenApiSchema(z.union([z.string(), z.number()])) as {
      oneOf: Array<{ type: string }>
    }
    expect(r.oneOf).toEqual([{ type: 'string' }, { type: 'number' }])
  })

  it('discriminated union → oneOf + discriminator + types tagged', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), a: z.string() }),
      z.object({ kind: z.literal('b'), b: z.number() }),
    ])
    const r = zodToOpenApiSchema(schema) as {
      oneOf: unknown[]
      discriminator?: { propertyName: string }
    }
    expect(r.oneOf).toHaveLength(2)
    expect(r.discriminator?.propertyName).toBe('kind')
  })
})

describe('zodToOpenApiSchema — recursive (seen-map cycle detection)', () => {
  it('z.lazy recursive type emits $ref on second occurrence', () => {
    interface TreeNode {
      value: string
      next?: TreeNode
    }
    const Tree: z.ZodType<TreeNode> = z.lazy(() =>
      z.object({ value: z.string(), next: Tree.optional() }),
    )
    // Use a named context so the second visit produces $ref to the named slot.
    const ctx: ConvertCtx = {
      seen: new Map<z.ZodType, string>(),
      components: {} as Record<string, OpenApiSchema>,
    }
    const r = zodToOpenApiSchema(Tree, { ctx, name: 'TreeNode' }) as { $ref?: string }
    // First call should register the schema under components AND return $ref.
    expect(r.$ref).toBe('#/components/schemas/TreeNode')
    expect(ctx.components.TreeNode).toBeDefined()
  })
})

describe('zodToOpenApiSchema — unsupported types', () => {
  it('z.function() throws ZodToOpenApiError with descriptive message', () => {
    // z.function() is a ZodType at the type level, so no @ts-expect-error
    // needed; the rejection is runtime via the switch's default arm.
    expect(() => zodToOpenApiSchema(z.function() as unknown as z.ZodType)).toThrow(
      ZodToOpenApiError,
    )
    expect(() => zodToOpenApiSchema(z.function() as unknown as z.ZodType)).toThrow(/z\.function/i)
  })
})

describe('zodToOpenApiSchema — transforms (z.ZodEffects)', () => {
  it('z.string().transform(...) → emits underlying source schema (transforms are post-parse)', () => {
    // Transform changes runtime output but the wire shape is the input
    const r = zodToOpenApiSchema(z.string().transform((s) => s.length))
    expect(r).toEqual({ type: 'string' })
  })
})
