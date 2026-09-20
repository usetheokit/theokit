/**
 * The hook pipeline's middleware stage, which nothing exercised.
 *
 * `executeWebRequest` has TWO paths to the handler. The no-hooks path calls
 * `runWebMiddleware` at web-handler.ts:585 and several files cover it. The hook path
 * reaches it through `runHandlerStage` at web-handler.ts:672 — and a whole-suite coverage
 * run on 2026-09-19 reported lines 672-675 uncovered across all 5202 tests.
 *
 * The gap is a combination rather than a feature: the middleware tests pass no hooks and the
 * hook tests pass no middleware, so the arm where both are present was reachable by nobody.
 * B-003 made that arm the one that hands the route to a middleware as its downstream, which
 * is why it is worth a test of its own rather than a line in an existing file.
 */
import { describe, expect, it } from 'vitest'

import { defineRoute } from '../../packages/theo/src/server/define/define-route.js'
import type { WebOnRequestHook } from '../../packages/theo/src/server/plugin-types.js'
import { executeWebRequest } from '../../packages/theo/src/server/web-handler.js'

const routes = {
  GET: defineRoute({
    handler() {
      return { from: 'the route' }
    },
  }),
}

describe('the hook pipeline runs user middleware (B-003)', () => {
  it('test_a_middleware_wraps_the_route_when_hooks_are_also_installed', async () => {
    const order: string[] = []
    const onRequest: WebOnRequestHook = () => {
      order.push('onRequest')
    }

    const response = await executeWebRequest(new Request('http://x/'), routes, {
      hooks: { onRequest: [onRequest] },
      middleware: [
        async (_request, _context, next) => {
          order.push('before')
          // The capability under test: the route is the downstream, so a middleware on the
          // HOOK path can read what the handler produced instead of only replacing it.
          const downstream = await next?.()
          order.push('after')
          if (!(downstream instanceof Response)) return undefined
          const wrapped = new Response(await downstream.text(), downstream)
          wrapped.headers.set('x-wrapped-by-middleware', 'yes')
          return wrapped
        },
      ],
    })

    expect(order, 'the middleware must run inside the hook pipeline, around the route').toEqual([
      'onRequest',
      'before',
      'after',
    ])
    expect(
      response.headers.get('x-wrapped-by-middleware'),
      'the response the caller receives is not the one the middleware returned',
    ).toBe('yes')
    expect(await response.json(), "the route's own body must survive the wrap").toEqual({
      from: 'the route',
    })
  })

  it('test_a_middleware_short_circuit_on_the_hook_path_skips_the_route', async () => {
    // The other side of lines 673-675: a middleware that answers without calling `next` must
    // stop the route from running at all, on the hook path exactly as on the plain one.
    let handlerRan = false
    const counted = {
      GET: defineRoute({
        handler() {
          handlerRan = true
          return { from: 'the route' }
        },
      }),
    }

    const response = await executeWebRequest(new Request('http://x/'), counted, {
      hooks: { onRequest: [() => undefined] },
      middleware: [() => new Response('served by the middleware', { status: 418 })],
    })

    expect(handlerRan, 'the middleware short-circuited and the route ran anyway').toBe(false)
    expect(response.status).toBe(418)
    expect(await response.text()).toBe('served by the middleware')
  })
})
