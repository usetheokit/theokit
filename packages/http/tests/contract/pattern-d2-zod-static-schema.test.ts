import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { resolveDtoSchema } from '../../src/bridge/dto-zod.js'

// Bun lacks emitDecoratorMetadata support (same as esbuild). Tests using
// decorator syntax require SWC compilation provided by vitest. Skip on Bun.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

describe.skipIf(!isVitest)('Pattern D2 — Zod static-schema contract', () => {
  it('test_pattern_d2_class_without_schema_returns_undefined', () => {
    class PlainDto {
      name = 'PlainDto'
    }
    expect(resolveDtoSchema(PlainDto)).toBeUndefined()
  })

  it('test_pattern_d2_class_with_schema_resolves', () => {
    const schema = z.object({ name: z.string() })
    class CatDto {
      static readonly schema = schema
      name = 'CatDto'
    }
    expect(resolveDtoSchema(CatDto)).toBe(schema)
  })
})
