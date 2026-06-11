/**
 * RED tests for T1.3 sub-B — server/http/form-data-to-object.ts
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 1 / T1.3 + Astro
 * server.ts:323-397 pattern. FormData → ZodObject coercion driven by the
 * declared schema (boolean string, number coercion, array via getAll, etc.).
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { formDataToObject } from '../../packages/theo/src/server/http/form-data-to-object.js'

function fd(entries: Array<[string, string]>): FormData {
  const f = new FormData()
  for (const [k, v] of entries) f.append(k, v)
  return f
}

describe('formDataToObject — string fields', () => {
  it('should extract a single string field', () => {
    const schema = z.object({ name: z.string() })
    const r = formDataToObject(fd([['name', 'Alice']]), schema)
    expect(r).toEqual({ name: 'Alice' })
  })

  it('should leave missing optional string as undefined', () => {
    const schema = z.object({ name: z.string().optional() })
    const r = formDataToObject(fd([]), schema)
    expect(r.name).toBeUndefined()
  })
})

describe('formDataToObject — boolean coercion', () => {
  it('should coerce "true" to true', () => {
    const schema = z.object({ flag: z.boolean() })
    expect(formDataToObject(fd([['flag', 'true']]), schema)).toEqual({ flag: true })
  })

  it('should coerce "false" to false', () => {
    const schema = z.object({ flag: z.boolean() })
    expect(formDataToObject(fd([['flag', 'false']]), schema)).toEqual({ flag: false })
  })

  it('should treat presence (any non-true/false value) as true', () => {
    const schema = z.object({ flag: z.boolean() })
    expect(formDataToObject(fd([['flag', 'on']]), schema)).toEqual({ flag: true })
  })
})

describe('formDataToObject — number coercion', () => {
  it('should coerce numeric string to number', () => {
    const schema = z.object({ age: z.number() })
    expect(formDataToObject(fd([['age', '42']]), schema)).toEqual({ age: 42 })
  })

  it('should coerce decimal string to number', () => {
    const schema = z.object({ price: z.number() })
    expect(formDataToObject(fd([['price', '19.99']]), schema)).toEqual({ price: 19.99 })
  })
})

describe('formDataToObject — array via getAll', () => {
  it('should extract repeated keys as string array', () => {
    const schema = z.object({ tags: z.array(z.string()) })
    const r = formDataToObject(
      fd([
        ['tags', 'a'],
        ['tags', 'b'],
        ['tags', 'c'],
      ]),
      schema,
    )
    expect(r).toEqual({ tags: ['a', 'b', 'c'] })
  })

  it('should coerce array-of-numbers via Number()', () => {
    const schema = z.object({ ids: z.array(z.number()) })
    const r = formDataToObject(
      fd([
        ['ids', '1'],
        ['ids', '2'],
        ['ids', '3'],
      ]),
      schema,
    )
    expect(r).toEqual({ ids: [1, 2, 3] })
  })

  it('should handle empty array (no matching keys)', () => {
    const schema = z.object({ tags: z.array(z.string()) })
    const r = formDataToObject(fd([]), schema)
    expect(r).toEqual({ tags: [] })
  })
})

describe('formDataToObject — default values', () => {
  it('should apply default when field missing', () => {
    const schema = z.object({
      role: z.string().default('user'),
    })
    const r = formDataToObject(fd([]), schema)
    expect(r).toEqual({ role: 'user' })
  })

  it('should preserve provided value over default', () => {
    const schema = z.object({
      role: z.string().default('user'),
    })
    const r = formDataToObject(fd([['role', 'admin']]), schema)
    expect(r).toEqual({ role: 'admin' })
  })
})

describe('formDataToObject — nested objects', () => {
  it('should recurse into nested objects via dot-prefix', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        age: z.number(),
      }),
    })
    const r = formDataToObject(
      fd([
        ['user.name', 'Bob'],
        ['user.age', '30'],
      ]),
      schema,
    )
    expect(r).toEqual({ user: { name: 'Bob', age: 30 } })
  })

  it('should handle deeply nested objects (3+ levels)', () => {
    const schema = z.object({
      user: z.object({
        address: z.object({
          city: z.string(),
          zip: z.string(),
        }),
      }),
    })
    const r = formDataToObject(
      fd([
        ['user.address.city', 'SP'],
        ['user.address.zip', '01000-000'],
      ]),
      schema,
    )
    expect(r).toEqual({
      user: { address: { city: 'SP', zip: '01000-000' } },
    })
  })
})

describe('formDataToObject — optional / nullable wrappers', () => {
  it('should unwrap optional and return undefined when missing', () => {
    const schema = z.object({ name: z.string().optional() })
    expect(formDataToObject(fd([]), schema).name).toBeUndefined()
  })

  it('should unwrap nullable and return null when missing', () => {
    const schema = z.object({ name: z.string().nullable() })
    expect(formDataToObject(fd([]), schema).name).toBeNull()
  })

  it('should preserve value through optional wrapper', () => {
    const schema = z.object({ name: z.string().optional() })
    expect(formDataToObject(fd([['name', 'X']]), schema).name).toBe('X')
  })
})
