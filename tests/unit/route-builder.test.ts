/**
 * M31 Phase 3 — `route()` fluent builder. `.build()` MUST emit a `RouteConfig` identical to the
 * legacy `defineRoute({...})` (identity-shape delegation), and infer the handler ctx from schemas.
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import { z } from 'zod'

import { route, defineRoute } from '../../packages/theo/src/server/define/index.js'

describe('route() builder — identity-shape delegation', () => {
  it('emits a RouteConfig structurally identical to defineRoute({...})', async () => {
    const body = z.object({ text: z.string() })
    const params = z.object({ id: z.string() })

    const built = route()
      .params(params)
      .body(body)
      .handler(({ params: p, body: b }) => ({ id: p.id, text: b.text }))
      .build()
    const legacy = defineRoute({
      params,
      body,
      handler: ({ params: p, body: b }) => ({ id: p.id, text: b.text }),
    })

    expect(built.params).toBe(legacy.params)
    expect(built.body).toBe(legacy.body)
    const ctx = {
      query: undefined,
      body: { text: 'hi' },
      params: { id: '7' },
      request: new Request('http://x/'),
      ctx: undefined,
    }
    expect(await built.handler(ctx)).toEqual(await legacy.handler(ctx))
  })

  it('infers handler ctx query/body/params from the schemas', () => {
    route()
      .query(z.object({ q: z.string() }))
      .body(z.object({ n: z.number() }))
      .params(z.object({ id: z.string() }))
      .handler((ctx) => {
        expectTypeOf(ctx.query).toEqualTypeOf<{ q: string }>()
        expectTypeOf(ctx.body).toEqualTypeOf<{ n: number }>()
        expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>()
        return null
      })
      .build()
  })

  it('carries optional response/status/csrf into the config', () => {
    const built = route()
      .status(201)
      .csrf(false)
      .response(z.object({ ok: z.boolean() }))
      .handler(() => ({ ok: true }))
      .build()
    expect(built.status).toBe(201)
    expect(built.csrf).toBe(false)
    expect(built.response).toBeDefined()
  })

  it('a no-input route (handler only) matches defineRoute({ handler })', async () => {
    const built = route()
      .handler(() => ({ status: 'ok' }))
      .build()
    expect(await built.handler({} as never)).toEqual({ status: 'ok' })
  })
})
