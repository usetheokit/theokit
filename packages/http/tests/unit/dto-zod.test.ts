import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { resolveDtoSchema } from '../../src/bridge/dto-zod.js'

describe('T3.1 — DTO Zod resolution (Pattern D2)', () => {
  it('test_resolve_with_schema_returns_zod', () => {
    const schema = z.object({ name: z.string() })
    class CreateCatDto {
      static readonly schema = schema
      name = 'CreateCatDto'
    }
    expect(resolveDtoSchema(CreateCatDto)).toBe(schema)
  })

  it('test_resolve_without_schema_returns_undefined', () => {
    class PlainDto {
      name = 'PlainDto'
    }
    expect(resolveDtoSchema(PlainDto)).toBeUndefined()
  })

  it('test_resolve_non_function_returns_undefined', () => {
    expect(resolveDtoSchema('not a class')).toBeUndefined()
    expect(resolveDtoSchema(42)).toBeUndefined()
    expect(resolveDtoSchema(null)).toBeUndefined()
    expect(resolveDtoSchema(undefined)).toBeUndefined()
  })

  it('test_resolve_non_zod_static_returns_undefined', () => {
    // static schema exists but isn't Zod-shaped (no safeParse)
    class BadDto {
      static readonly schema = { parse: () => 'nope' }
      name = 'BadDto'
    }
    expect(resolveDtoSchema(BadDto)).toBeUndefined()
  })
})
