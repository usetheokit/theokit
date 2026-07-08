/**
 * M31 Phase 3 — `websocket()` + `middleware()` fluent builders. `.build()` emits the same value the
 * legacy `defineWebSocket({...})` / `defineMiddleware(fn)` returns (identity-shape delegation).
 */
import { describe, it, expect } from 'vitest'

import { websocket, middleware } from '../../packages/theo/src/server/define/index.js'
import { defineWebSocket } from '../../packages/theo/src/server/define/define-websocket.js'
import { defineMiddleware } from '../../packages/theo/src/server/define/define-middleware.js'

describe('websocket() builder', () => {
  it('emits a WebSocketHandler with the lifecycle hooks set', () => {
    const onOpen = (): void => {}
    const onMessage = (): void => {}
    const built = websocket().onOpen(onOpen).onMessage(onMessage).build()
    const legacy = defineWebSocket({ onOpen, onMessage })
    expect(built.onOpen).toBe(legacy.onOpen)
    expect(built.onMessage).toBe(legacy.onMessage)
    expect(built.onClose).toBeUndefined()
  })

  it('an empty websocket() builds a handler with no hooks', () => {
    const built = websocket().build()
    expect(built).toEqual({})
  })
})

describe('middleware() builder', () => {
  it('emits the MiddlewareHandler function from .handle()', async () => {
    const fn = async (
      request: Request,
      next: (req: Request) => Promise<Response>,
    ): Promise<Response> => {
      const res = await next(request)
      res.headers.set('x-mw', '1')
      return res
    }
    const built = middleware().handle(fn).build()
    const legacy = defineMiddleware(fn)
    expect(built).toBe(legacy)

    const res = await built(new Request('http://x/'), async () => new Response('ok'))
    expect(res.headers.get('x-mw')).toBe('1')
  })

  it('build() before .handle() throws at runtime (fail-fast for JS callers)', () => {
    // The type-state guard blocks this at compile time; assert the runtime fail-fast too.
    const b = middleware() as unknown as { build: () => unknown }
    expect(() => b.build()).toThrow(/call \.handle/)
  })
})
