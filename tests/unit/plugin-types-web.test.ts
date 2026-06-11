/**
 * T5a.2 Phase F slice 1/3 — Web-Standards plugin types tests.
 *
 * Verifies the new Web-shaped plugin type surface (`WebPluginContext`,
 * `WebTheoApp`, `WebTheoPlugin`, `defineWebPlugin`) compiles cleanly and
 * exhibits the documented behavior. Type-level tests live in the imports
 * (they fail typecheck if signatures regress).
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase F.
 */
import { describe, it, expect } from 'vitest'

import {
  defineWebPlugin,
  type WebHookByName,
  type WebOnErrorHook,
  type WebOnRequestHook,
  type WebOnResponseHook,
  type WebPluginContext,
  type WebPluginErrorContext,
  type WebPreHandlerHook,
  type WebTheoApp,
  type WebTheoPlugin,
} from '../../packages/theo/src/server/plugin-types.js'

describe('defineWebPlugin (T5a.2 Phase F slice 1/3 — Web shape)', () => {
  it('returns the plugin unchanged (identity function)', () => {
    const plugin: WebTheoPlugin = {
      name: 'test-plugin',
      register() {
        /* noop */
      },
    }
    expect(defineWebPlugin(plugin)).toBe(plugin)
  })

  it('plugin register receives a WebTheoApp instance with addHook + decorateRequest', async () => {
    const observed: { hooks: string[]; decorations: Record<string, unknown> } = {
      hooks: [],
      decorations: {},
    }
    // Build a minimal in-memory WebTheoApp facade for the contract test.
    const app: WebTheoApp = {
      addHook(name, _fn) {
        observed.hooks.push(name)
      },
      decorateRequest(key, value) {
        observed.decorations[key] = value
      },
    }

    const plugin = defineWebPlugin({
      name: 'wires-everything',
      register(targetApp) {
        targetApp.addHook('onRequest', (ctx) => {
          // Type-level: ctx is WebPluginContext (has responseHeaders)
          ctx.responseHeaders.set('x-traced', 'true')
        })
        targetApp.addHook('preHandler', () => {
          /* noop */
        })
        targetApp.addHook('onResponse', () => {
          /* noop */
        })
        targetApp.addHook('onError', (ctx) => {
          // Type-level: ctx is WebPluginErrorContext (has error)
          expect(ctx.error).toBeDefined()
        })
        targetApp.decorateRequest('userId', 'u-123')
      },
    })
    await plugin.register(app)
    expect(observed.hooks).toEqual(['onRequest', 'preHandler', 'onResponse', 'onError'])
    expect(observed.decorations).toEqual({ userId: 'u-123' })
  })
})

describe('WebPluginContext type contract (T5a.2 Phase F slice 1/3)', () => {
  it('compiles with all canonical fields populated', () => {
    // This test is primarily a type-compile check; a runtime assertion
    // verifies the shape exists at runtime too.
    const ctx: WebPluginContext = {
      request: new Request('http://example.com', { method: 'GET' }),
      responseHeaders: new Headers(),
      ctx: {},
      requestId: 'req-1',
    }
    expect(ctx.request).toBeInstanceOf(Request)
    expect(ctx.responseHeaders).toBeInstanceOf(Headers)
    expect(ctx.ctx).toEqual({})
    expect(ctx.requestId).toBe('req-1')
    // response is optional (undefined during onRequest/preHandler)
    expect(ctx.response).toBeUndefined()
  })

  it('response field populated during onResponse / onError flows', () => {
    const ctx: WebPluginContext = {
      request: new Request('http://example.com', { method: 'GET' }),
      responseHeaders: new Headers(),
      response: new Response('hello', { status: 200 }),
      ctx: {},
      requestId: 'req-2',
    }
    expect(ctx.response).toBeInstanceOf(Response)
    expect(ctx.response?.status).toBe(200)
  })

  it('error context extends plugin context with error field', () => {
    const errorCtx: WebPluginErrorContext = {
      request: new Request('http://example.com', { method: 'GET' }),
      responseHeaders: new Headers(),
      ctx: {},
      requestId: 'req-err',
      error: new Error('boom'),
    }
    expect(errorCtx.error).toBeInstanceOf(Error)
  })
})

describe('WebHookByName type discriminator (T5a.2 Phase F slice 1/3)', () => {
  it("maps 'onRequest' → WebOnRequestHook", () => {
    const hook: WebHookByName<'onRequest'> = (ctx) => {
      // Touch ctx.requestId to verify the field exists on the type
      expect(typeof ctx.requestId).toBe('string')
    }
    // Type alias parity check — both should be the same function type
    const sameAsAlias: WebOnRequestHook = hook
    expect(typeof sameAsAlias).toBe('function')
  })

  it("maps 'preHandler' → WebPreHandlerHook", () => {
    const hook: WebHookByName<'preHandler'> = () => {
      /* noop */
    }
    const sameAsAlias: WebPreHandlerHook = hook
    expect(typeof sameAsAlias).toBe('function')
  })

  it("maps 'onResponse' → WebOnResponseHook", () => {
    const hook: WebHookByName<'onResponse'> = () => {
      /* noop */
    }
    const sameAsAlias: WebOnResponseHook = hook
    expect(typeof sameAsAlias).toBe('function')
  })

  it("maps 'onError' → WebOnErrorHook (receives WebPluginErrorContext)", () => {
    const hook: WebHookByName<'onError'> = (ctx) => {
      expect(ctx.error).toBeDefined() // error field only on error context
    }
    const sameAsAlias: WebOnErrorHook = hook
    expect(typeof sameAsAlias).toBe('function')
  })
})
