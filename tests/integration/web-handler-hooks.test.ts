/**
 * T5a.2 Phase G slice 1/N — plugin lifecycle hooks integration tests.
 *
 * Verifies `executeWebRequest(request, routeModule, { hooks: {...} })`
 * threads `WebPluginContext` through the canonical 4-hook lifecycle:
 *   onRequest → preHandler → handler → onResponse, with onError catching
 *   handler throws AND hook throws.
 *
 * Lifecycle invariants verified:
 *   1. Hook order (onRequest BEFORE handler, onResponse AFTER handler).
 *   2. Short-circuit semantic: setting `ctx.response` in onRequest/preHandler
 *      skips the handler (subsequent hooks still observe).
 *   3. `ctx.responseHeaders` is mutable + merged into final Response;
 *      handler-set headers win on conflict; hook Set-Cookie appended.
 *   4. `ctx.ctx[key] = value` persists across hooks (request-scoped state).
 *   5. onError fires on handler throw with envelope-shaped error response.
 *   6. EC-9 — onError hook throw doesn't recurse (swallowed).
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase G.
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { defineRoute } from '../../packages/theo/src/server/define/define-route.js'
import { executeWebRequest } from '../../packages/theo/src/server/web-handler.js'
import type {
  WebOnErrorHook,
  WebOnRequestHook,
  WebOnResponseHook,
  WebPreHandlerHook,
} from '../../packages/theo/src/server/plugin-types.js'

const echoRoutes = {
  GET: defineRoute({
    query: z.object({}).optional(),
    handler() {
      return { ok: true }
    },
  }),
  POST: defineRoute({
    body: z.object({ name: z.string() }),
    handler({ body }) {
      const typed = body as { name: string }
      return { greeting: `hello, ${typed.name}` }
    },
  }),
}

const throwingRoute = {
  GET: defineRoute({
    handler() {
      throw new Error('handler boom')
    },
  }),
}

describe('executeWebRequest + hooks lifecycle (T5a.2 Phase G slice 1/N)', () => {
  it('runs onRequest → preHandler → handler → onResponse in canonical order', async () => {
    const order: string[] = []
    const hooks = {
      onRequest: [
        ((ctx) => {
          order.push(`onRequest:${ctx.requestId}`)
        }) as WebOnRequestHook,
      ],
      preHandler: [
        ((ctx) => {
          order.push(`preHandler:${ctx.requestId}`)
        }) as WebPreHandlerHook,
      ],
      onResponse: [
        ((ctx) => {
          order.push(`onResponse:${ctx.response?.status}`)
        }) as WebOnResponseHook,
      ],
    }
    const request = new Request('http://example.com/api', { method: 'GET' })
    const response = await executeWebRequest(request, echoRoutes, { hooks, requestId: 'req-42' })
    expect(response.status).toBe(200)
    expect(order).toEqual(['onRequest:req-42', 'preHandler:req-42', 'onResponse:200'])
  })

  it('onRequest short-circuit: setting ctx.response skips handler + preHandler', async () => {
    const order: string[] = []
    const hooks = {
      onRequest: [
        ((ctx) => {
          order.push('onRequest')
          ctx.response = new Response(JSON.stringify({ shortCircuit: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }) as WebOnRequestHook,
      ],
      preHandler: [
        (() => {
          order.push('preHandler')
        }) as WebPreHandlerHook,
      ],
      onResponse: [
        ((ctx) => {
          order.push(`onResponse:${ctx.response?.status}`)
        }) as WebOnResponseHook,
      ],
    }
    // Use POST + body that would NORMALLY parse to verify the body parse
    // is also skipped on onRequest short-circuit.
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alice' }),
    })
    const response = await executeWebRequest(request, echoRoutes, { hooks })
    const body = (await response.json()) as { shortCircuit?: boolean; greeting?: string }
    // Short-circuit body, NOT handler greeting
    expect(body.shortCircuit).toBe(true)
    expect(body.greeting).toBeUndefined()
    // Handler skipped; preHandler also skipped (subsequent onRequest hooks
    // would also skip — both are pre-handler-lifecycle)
    expect(order).toEqual(['onRequest', 'onResponse:200'])
  })

  it('preHandler short-circuit: setting ctx.response skips handler (onRequest still ran)', async () => {
    const order: string[] = []
    const hooks = {
      onRequest: [
        (() => {
          order.push('onRequest')
        }) as WebOnRequestHook,
      ],
      preHandler: [
        ((ctx) => {
          order.push('preHandler')
          ctx.response = new Response('blocked', { status: 403 })
        }) as WebPreHandlerHook,
      ],
      onResponse: [
        ((ctx) => {
          order.push(`onResponse:${ctx.response?.status}`)
        }) as WebOnResponseHook,
      ],
    }
    const request = new Request('http://example.com/api', { method: 'GET' })
    const response = await executeWebRequest(request, echoRoutes, { hooks })
    expect(response.status).toBe(403)
    expect(await response.text()).toBe('blocked')
    expect(order).toEqual(['onRequest', 'preHandler', 'onResponse:403'])
  })

  it('responseHeaders set by hooks are merged into the final Response', async () => {
    const hooks = {
      onRequest: [
        ((ctx) => {
          ctx.responseHeaders.set('x-from-onrequest', 'true')
          ctx.responseHeaders.append('Set-Cookie', 'cookie-from-hook=abc; Path=/')
        }) as WebOnRequestHook,
      ],
    }
    const request = new Request('http://example.com/api', { method: 'GET' })
    const response = await executeWebRequest(request, echoRoutes, { hooks })
    expect(response.status).toBe(200)
    expect(response.headers.get('x-from-onrequest')).toBe('true')
    const setCookies = response.headers.getSetCookie()
    expect(setCookies).toHaveLength(1)
    expect(setCookies[0]).toContain('cookie-from-hook=abc')
  })

  it('handler-set headers win on conflict with hook headers', async () => {
    const routeWithHandlerHeader = {
      GET: defineRoute({
        handler() {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-source': 'handler-set',
            },
          })
        },
      }),
    }
    const hooks = {
      onRequest: [
        ((ctx) => {
          ctx.responseHeaders.set('x-source', 'hook-set') // should LOSE to handler
        }) as WebOnRequestHook,
      ],
    }
    const request = new Request('http://example.com/api', { method: 'GET' })
    const response = await executeWebRequest(request, routeWithHandlerHeader, { hooks })
    expect(response.headers.get('x-source')).toBe('handler-set')
  })

  it('ctx.ctx[key] persists across hooks (request-scoped state)', async () => {
    let preHandlerSawIt = false
    const hooks = {
      onRequest: [
        ((ctx) => {
          ctx.ctx.userId = 'u-99'
        }) as WebOnRequestHook,
      ],
      preHandler: [
        ((ctx) => {
          preHandlerSawIt = ctx.ctx.userId === 'u-99'
        }) as WebPreHandlerHook,
      ],
    }
    const request = new Request('http://example.com/api', { method: 'GET' })
    await executeWebRequest(request, echoRoutes, { hooks })
    expect(preHandlerSawIt).toBe(true)
  })

  it('handler throw → onError fires with envelope-shaped error response', async () => {
    const errors: { code?: string; message?: string }[] = []
    const hooks = {
      onError: [
        (async (ctx) => {
          const body = (await ctx.response?.json()) as { code?: string; message?: string }
          errors.push(body)
        }) as WebOnErrorHook,
      ],
    }
    const request = new Request('http://example.com/api', { method: 'GET' })
    const response = await executeWebRequest(request, throwingRoute, { hooks })
    expect(response.status).toBe(500)
    expect(errors).toHaveLength(1)
    expect(errors[0].code).toBe('INTERNAL_SERVER_ERROR')
    expect(errors[0].message).toBe('handler boom')
  })

  it('EC-9: onError hook throw is swallowed (no recursion)', async () => {
    const hooks = {
      onError: [
        ((_ctx) => {
          throw new Error('onError hook misbehaves')
        }) as WebOnErrorHook,
      ],
    }
    const request = new Request('http://example.com/api', { method: 'GET' })
    // Should NOT throw — the error response still returns; the hook
    // exception is silenced internally.
    const response = await executeWebRequest(request, throwingRoute, { hooks })
    expect(response.status).toBe(500)
  })

  it('requestId defaults to a fresh UUID when not provided', async () => {
    const ids: string[] = []
    const hooks = {
      onRequest: [
        ((ctx) => {
          ids.push(ctx.requestId)
        }) as WebOnRequestHook,
      ],
    }
    const request = new Request('http://example.com/api', { method: 'GET' })
    await executeWebRequest(request, echoRoutes, { hooks })
    await executeWebRequest(request, echoRoutes, { hooks })
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    // Distinct UUIDs per call
    expect(ids[0]).not.toBe(ids[1])
  })

  it('default no-hooks path preserves Phase A behavior (zero overhead)', async () => {
    // Sanity check: omitting `hooks` keeps the response identical to the
    // Phase A path (no hookCtx allocated, no merge step). Behavior parity
    // with the existing 8/8 GREEN T1.2 tests.
    const request = new Request('http://example.com/api', { method: 'GET' })
    const response = await executeWebRequest(request, echoRoutes)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})
