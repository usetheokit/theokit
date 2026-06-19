import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { executeWebRequest } from '../../packages/theo/src/server/web-handler.js'

/**
 * T3.1 — executeWebRequest must resolve route params from opts.params (the
 * matchRoute result) instead of the previously-hardcoded `{}`. Backward compat:
 * when opts.params is omitted, behavior is unchanged.
 */
function userRoute() {
  return {
    GET: {
      params: z.object({ id: z.string() }),
      handler: ({ params }: { params: unknown }) => ({ seen: (params as { id: string }).id }),
    },
  }
}

describe('executeWebRequest route params (T3.1)', () => {
  it('test_web_handler_receives_resolved_params', async () => {
    const res = await executeWebRequest(new Request('http://x/users/42'), userRoute(), {
      params: { id: '42' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ seen: '42' })
  })

  it('test_web_handler_validates_params_via_zod', async () => {
    const route = {
      GET: {
        params: z.object({ id: z.coerce.number().int() }),
        handler: () => ({ ok: true }),
      },
    }
    const res = await executeWebRequest(new Request('http://x/users/abc'), route, {
      params: { id: 'abc' },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    const body = await res.json()
    expect(JSON.stringify(body)).toMatch(/validation|params/i)
  })

  it('test_web_handler_params_default_empty_preserves_compat', async () => {
    // No opts.params → paramsRaw {} → a route requiring params fails validation (prior behavior).
    const res = await executeWebRequest(new Request('http://x/users/42'), userRoute())
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('test_web_handler_catchall_param_preserves_slashes', async () => {
    const route = {
      GET: {
        params: z.object({ path: z.string() }),
        handler: ({ params }: { params: unknown }) => ({ path: (params as { path: string }).path }),
      },
    }
    const res = await executeWebRequest(new Request('http://x/docs/a/b/c'), route, {
      params: { path: 'a/b/c' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ path: 'a/b/c' })
  })
})

import { CSRF_PROTECTED_METHODS } from '../../packages/theo/src/server/web-handler.js'

/**
 * T3.2 — the Web path must run a middleware chain (the no-hooks branch ran
 * none). Order: CSRF gate fires BEFORE user middleware (EC-3). Short-circuit
 * returns the middleware Response verbatim (Set-Cookie preserved, EC-11).
 */
describe('executeWebRequest middleware chain (T3.2)', () => {
  it('test_web_middleware_runs_before_handler', async () => {
    const route = {
      GET: {
        handler: ({ context }: { context: Record<string, unknown> }) => ({ user: context.user }),
      },
    }
    const res = await executeWebRequest(new Request('http://x/me'), route, {
      middleware: [
        (_req, ctx) => {
          ctx.user = 'alice'
        },
      ],
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: 'alice' })
  })

  it('test_web_middleware_can_short_circuit', async () => {
    let handlerCalled = false
    const route = {
      GET: {
        handler: () => {
          handlerCalled = true
          return { ok: true }
        },
      },
    }
    const res = await executeWebRequest(new Request('http://x/admin'), route, {
      middleware: [() => new Response('forbidden', { status: 403 })],
    })
    expect(res.status).toBe(403)
    expect(handlerCalled).toBe(false)
  })

  it('test_web_middleware_shortcircuit_preserves_set_cookie', async () => {
    const route = { GET: { handler: () => ({ ok: true }) } }
    const res = await executeWebRequest(new Request('http://x/login'), route, {
      middleware: [
        () =>
          new Response('redirecting', {
            status: 302,
            headers: { 'set-cookie': 'sid=abc; HttpOnly', location: '/' },
          }),
      ],
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('set-cookie')).toBe('sid=abc; HttpOnly')
  })

  it('test_web_no_middleware_is_zero_overhead', async () => {
    // Without opts.middleware, behavior is unchanged (handler runs directly).
    const route = { GET: { handler: () => ({ ok: true }) } }
    const res = await executeWebRequest(new Request('http://x/'), route)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('test_web_csrf_runs_before_user_middleware', async () => {
    // CSRF strict + protected method without token → CSRF blocks BEFORE middleware.
    expect(CSRF_PROTECTED_METHODS.has('POST')).toBe(true)
    let middlewareRan = false
    const route = {
      POST: {
        handler: () => ({ ok: true }),
      },
    }
    const res = await executeWebRequest(new Request('http://x/write', { method: 'POST' }), route, {
      csrfMode: 'strict',
      middleware: [
        () => {
          middlewareRan = true
        },
      ],
    })
    expect(res.status).toBeGreaterThanOrEqual(400) // CSRF rejected
    expect(middlewareRan).toBe(false) // middleware never ran — CSRF gate is first
  })
})

import { runWebMiddleware } from '../../packages/theo/src/server/http/web-middleware-runner.js'

/**
 * EC-12 — direct coverage of the Web middleware runner contract (ctx mutation +
 * ordered short-circuit). Full cross-runner parity with the Node defineMiddleware
 * contract is part of the deferred Node->Web convergence (D4), not this slice.
 */
describe('runWebMiddleware contract (EC-12)', () => {
  it('test_runner_runs_in_order_and_mutates_context', async () => {
    const order: number[] = []
    const ctx: Record<string, unknown> = {}
    const res = await runWebMiddleware(
      new Request('http://x/'),
      [
        (_r, c) => {
          order.push(1)
          c.a = 1
        },
        (_r, c) => {
          order.push(2)
          c.b = 2
        },
      ],
      ctx,
    )
    expect(res).toBeUndefined() // no short-circuit → handler should run
    expect(order).toEqual([1, 2])
    expect(ctx).toEqual({ a: 1, b: 2 })
  })

  it('test_runner_short_circuits_and_skips_rest', async () => {
    const order: number[] = []
    const res = await runWebMiddleware(
      new Request('http://x/'),
      [
        () => {
          order.push(1)
          return new Response('stop', { status: 401 })
        },
        () => {
          order.push(2)
        },
      ],
      {},
    )
    expect(res?.status).toBe(401)
    expect(order).toEqual([1]) // second middleware never ran
  })
})
