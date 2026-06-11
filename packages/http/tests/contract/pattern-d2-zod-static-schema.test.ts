import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { resolveDtoSchema } from '../../src/bridge/dto-zod.js'

describe('Pattern D2 — Zod static-schema contract', () => {
  it('test_pattern_d2_class_without_schema_returns_undefined', () => {
    class PlainDto {}
    expect(resolveDtoSchema(PlainDto)).toBeUndefined()
  })

  it('test_pattern_d2_class_with_schema_resolves', () => {
    const schema = z.object({ name: z.string() })
    class CatDto {
      static schema = schema
    }
    expect(resolveDtoSchema(CatDto)).toBe(schema)
  })
})
