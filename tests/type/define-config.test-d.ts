import { describe, it, expectTypeOf } from 'vitest'
import type { TheoConfig } from 'theokit'
import { defineConfig } from '../../packages/theo/src/config/define-config.js'

describe('defineConfig type inference', () => {
  it('should accept partial TheoConfig', () => {
    const config = defineConfig({ port: 4000 })
    expectTypeOf(config).toExtend<Partial<TheoConfig>>()
  })

  it('should accept empty config', () => {
    const config = defineConfig({})
    expectTypeOf(config).toExtend<Partial<TheoConfig>>()
  })

  it('should reject invalid property types at compile time', () => {
    // @ts-expect-error — port must be number
    defineConfig({ port: 'abc' })
  })
})
