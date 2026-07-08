import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineAction } from '../../packages/theo/src/server/define/define-action.js'

describe('defineAction', () => {
  it('should return the action config unchanged (same reference)', () => {
    const config = {
      input: z.object({ name: z.string() }),
      handler: ({ input }: { input: { name: string } }) => ({ id: '1', name: input.name }),
    }
    const result = defineAction(config)
    expect(result).toBe(config)
  })

  it('should preserve input schema', () => {
    const schema = z.object({ email: z.email() })
    const config = {
      input: schema,
      handler: ({ input: _input }: { input: { email: string } }) => ({ ok: true }),
    }
    const result = defineAction(config)
    expect(result.input).toBe(schema)
  })

  it('should accept complex nested input', () => {
    const config = {
      input: z.object({
        user: z.object({
          name: z.string(),
          address: z.object({ city: z.string() }),
        }),
      }),
      handler: () => ({ ok: true }),
    }
    const result = defineAction(config)
    expect(result).toBe(config)
  })

  // T1.2 (G3): accept field per ADR D1 — opt-in JSON vs FormData encoding
  it('should preserve accept field when set to form', () => {
    const config = {
      input: z.object({ avatar: z.string() }),
      accept: 'form' as const,
      handler: () => ({ ok: true }),
    }
    const result = defineAction(config)
    expect(result.accept).toBe('form')
  })

  it('should leave accept undefined when omitted (runtime defaults to json elsewhere)', () => {
    const config = {
      input: z.object({ name: z.string() }),
      handler: () => ({ ok: true }),
    }
    const result = defineAction(config)
    expect(result.accept).toBeUndefined()
  })

  it('should preserve accept field when explicitly set to json', () => {
    const config = {
      input: z.object({ name: z.string() }),
      accept: 'json' as const,
      handler: () => ({ ok: true }),
    }
    const result = defineAction(config)
    expect(result.accept).toBe('json')
  })
})
