/**
 * M31 Phase 3 — `action()` fluent builder. `.build()` MUST emit an `ActionConfig` identical to the
 * legacy `defineAction({...})` (identity-shape delegation), inferring `ctx.input` from the schema.
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import { z } from 'zod'

import { action } from '../../packages/theo/src/server/define/index.js'
import { defineAction } from '../../packages/theo/src/server/define/define-action.js'

describe('action() builder — identity-shape delegation', () => {
  it('emits an ActionConfig structurally identical to defineAction({...})', async () => {
    const input = z.object({ email: z.string() })
    const built = action()
      .input(input)
      .handler(({ input: i }) => `created:${i.email}`)
      .build()
    const legacy = defineAction({
      input,
      handler: ({ input: i }) => `created:${i.email}`,
    })

    expect(built.input).toBe(legacy.input)
    const ctx = { input: { email: 'a@b.c' }, ctx: undefined }
    expect(await built.handler(ctx)).toEqual(await legacy.handler(ctx))
  })

  it('infers ctx.input from the Zod schema', () => {
    action()
      .input(z.object({ n: z.number(), flag: z.boolean() }))
      .handler(({ input }) => {
        expectTypeOf(input).toEqualTypeOf<{ n: number; flag: boolean }>()
        return null
      })
      .build()
  })

  it('carries accept + csrf into the config', () => {
    const built = action()
      .input(z.object({ x: z.string() }))
      .accept('form')
      .csrf(false)
      .handler(() => 'ok')
      .build()
    expect(built.accept).toBe('form')
    expect(built.csrf).toBe(false)
  })
})
