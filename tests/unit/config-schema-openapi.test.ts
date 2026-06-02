/**
 * T1.2 — `openapi` block in theoConfigSchema.
 *
 * Per G2 plan v1.1: the block is OPTIONAL (apps without it skip emit).
 * When present, all inner fields have defaults so `openapi: {}` is valid
 * and yields a fully-populated config.
 *
 * Tests assert: omission, defaults, enum rejection.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { theoConfigSchema } from '../../packages/theo/src/config/schema.js'

describe('theoConfigSchema — openapi block', () => {
  it('default config omits openapi block (undefined when not provided)', () => {
    const parsed = theoConfigSchema.parse({})
    expect(parsed.openapi).toBeUndefined()
  })

  it('openapi.servers defaults to [{url:"http://localhost:3000", description:"Local development"}]', () => {
    const parsed = theoConfigSchema.parse({ openapi: {} })
    expect(parsed.openapi).toBeDefined()
    expect(parsed.openapi?.servers).toEqual([
      { url: 'http://localhost:3000', description: 'Local development' },
    ])
  })

  it('openapi.specVersion defaults to "3.1.0"', () => {
    const parsed = theoConfigSchema.parse({ openapi: {} })
    expect(parsed.openapi?.specVersion).toBe('3.1.0')
  })

  it('openapi.title defaults to "TheoKit App" and version to "0.0.0" and outDir to ".theo"', () => {
    const parsed = theoConfigSchema.parse({ openapi: {} })
    expect(parsed.openapi?.title).toBe('TheoKit App')
    expect(parsed.openapi?.version).toBe('0.0.0')
    expect(parsed.openapi?.outDir).toBe('.theo')
  })

  it('openapi.specVersion rejects values not in ["3.1.0","3.0.3"] via ZodError', () => {
    expect(() => theoConfigSchema.parse({ openapi: { specVersion: '2.0.0' } })).toThrow(z.ZodError)
  })

  it('openapi.servers[].url rejects non-URL strings via ZodError', () => {
    expect(() => theoConfigSchema.parse({ openapi: { servers: [{ url: 'not-a-url' }] } })).toThrow(
      z.ZodError,
    )
  })

  it('openapi block accepts overrides over defaults', () => {
    const parsed = theoConfigSchema.parse({
      openapi: {
        servers: [{ url: 'https://api.example.com', description: 'prod' }],
        specVersion: '3.0.3',
        title: 'My App',
        version: '1.2.3',
        outDir: 'dist/openapi',
      },
    })
    expect(parsed.openapi?.servers).toEqual([
      { url: 'https://api.example.com', description: 'prod' },
    ])
    expect(parsed.openapi?.specVersion).toBe('3.0.3')
    expect(parsed.openapi?.title).toBe('My App')
    expect(parsed.openapi?.version).toBe('1.2.3')
    expect(parsed.openapi?.outDir).toBe('dist/openapi')
  })
})
