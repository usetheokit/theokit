/**
 * T5a.2 Phase G slice 2/N — WebPluginRunner tests.
 *
 * Verifies the Web-shaped plugin runner mirrors the IncomingMessage
 * PluginRunner's C1 invariants (T3.1 — sibling-isolated decoration
 * scopes via Object.create(parent), Fastify pattern). Also verifies
 * `getHooks()` returns hook arrays in the shape executeWebRequest's
 * opts.hooks consumes directly — the Phase G slice 1/N landing zone.
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase G.
 */
import { describe, it, expect } from 'vitest'

import { DuplicatePluginError } from '../../packages/theo/src/server/plugins/plugin-runner.js'
import { WebPluginRunner } from '../../packages/theo/src/server/plugins/web-plugin-runner.js'
import { defineWebPlugin } from '../../packages/theo/src/server/plugin-types.js'
import { executeWebRequest } from '../../packages/theo/src/server/web-handler.js'
import { defineRoute } from '../../packages/theo/src/server/define/define-route.js'

describe('WebPluginRunner.register (T5a.2 Phase G slice 2/N — C1 invariants mirror)', () => {
  it('registers a plugin and tracks it via has()', async () => {
    const runner = new WebPluginRunner()
    expect(runner.has('test')).toBe(false)
    await runner.register(
      defineWebPlugin({
        name: 'test',
        register() {
          /* noop */
        },
      }),
    )
    expect(runner.has('test')).toBe(true)
  })

  it('throws DuplicatePluginError on second register with same name', async () => {
    const runner = new WebPluginRunner()
    const plugin = defineWebPlugin({
      name: 'duplicated',
      register() {
        /* noop */
      },
    })
    await runner.register(plugin)
    await expect(runner.register(plugin)).rejects.toThrow(DuplicatePluginError)
  })

  it('rolls back partial registration when plugin.register throws (T1.1 BDD)', async () => {
    const runner = new WebPluginRunner()
    const plugin = defineWebPlugin({
      name: 'misbehaves',
      register() {
        throw new Error('register boom')
      },
    })
    await expect(runner.register(plugin)).rejects.toThrow('register boom')
    // Rolled back — not in the registry
    expect(runner.has('misbehaves')).toBe(false)
    // Can register again without DuplicatePluginError
    const fixed = defineWebPlugin({
      name: 'misbehaves',
      register() {
        /* noop */
      },
    })
    await expect(runner.register(fixed)).resolves.toBeUndefined()
  })

  it('hooks registered via app.addHook flow into getHooks() arrays', async () => {
    const runner = new WebPluginRunner()
    await runner.register(
      defineWebPlugin({
        name: 'hook-plugin',
        register(app) {
          app.addHook('onRequest', () => {
            /* noop */
          })
          app.addHook('onRequest', () => {
            /* noop */
          })
          app.addHook('preHandler', () => {
            /* noop */
          })
          app.addHook('onResponse', () => {
            /* noop */
          })
          app.addHook('onError', () => {
            /* noop */
          })
        },
      }),
    )
    const hooks = runner.getHooks()
    expect(hooks.onRequest).toHaveLength(2)
    expect(hooks.preHandler).toHaveLength(1)
    expect(hooks.onResponse).toHaveLength(1)
    expect(hooks.onError).toHaveLength(1)
  })

  it('C1 sibling isolation: two plugins decorating same key get isolated scopes', async () => {
    const runner = new WebPluginRunner()
    await runner.register(
      defineWebPlugin({
        name: 'pluginA',
        register(app) {
          app.decorateRequest('user', { id: 1, source: 'A' })
        },
      }),
    )
    await runner.register(
      defineWebPlugin({
        name: 'pluginB',
        register(app) {
          app.decorateRequest('user', { id: 2, source: 'B' })
        },
      }),
    )
    // Both registrations succeed (no DuplicateDecorationError — that legacy
    // class is @deprecated post-T3.1).
    const scopeA = runner.getPluginScope('pluginA') as unknown as {
      decorations: { user: { id: number; source: string } }
    }
    const scopeB = runner.getPluginScope('pluginB') as unknown as {
      decorations: { user: { id: number; source: string } }
    }
    expect(scopeA.decorations.user.id).toBe(1)
    expect(scopeA.decorations.user.source).toBe('A')
    expect(scopeB.decorations.user.id).toBe(2)
    expect(scopeB.decorations.user.source).toBe('B')
  })

  it('applyDecorations applies ALL plugin scopes to ctx (last-writer-wins)', async () => {
    const runner = new WebPluginRunner()
    await runner.register(
      defineWebPlugin({
        name: 'first',
        register(app) {
          app.decorateRequest('shared', 'from-first')
          app.decorateRequest('only-first', 'first-only')
        },
      }),
    )
    await runner.register(
      defineWebPlugin({
        name: 'second',
        register(app) {
          app.decorateRequest('shared', 'from-second')
          app.decorateRequest('only-second', 'second-only')
        },
      }),
    )
    const ctx: Record<string, unknown> = {}
    runner.applyDecorations(ctx)
    expect(ctx.shared).toBe('from-second') // last writer (second) wins
    expect(ctx['only-first']).toBe('first-only')
    expect(ctx['only-second']).toBe('second-only')
  })

  it('decorateRequest throws TypeError for non-string keys (T3.1 validation)', async () => {
    const runner = new WebPluginRunner()
    await expect(
      runner.register(
        defineWebPlugin({
          name: 'bad-key',
          register(app) {
            ;(
              app as unknown as { decorateRequest: (k: unknown, v: unknown) => void }
            ).decorateRequest(42, 'value')
          },
        }),
      ),
    ).rejects.toThrow(/invalid|key|string/i)
  })

  it('parent scope decorations stay untouched by plugin decorate calls', async () => {
    const runner = new WebPluginRunner()
    await runner.register(
      defineWebPlugin({
        name: 'plugin',
        register(app) {
          app.decorateRequest('plugin-key', 'value')
        },
      }),
    )
    // Parent decorations remain empty (T3.1 invariant: plugins decorate
    // ONLY through child scopes; parent is not mutated).
    expect(runner.getParentDecorations().size).toBe(0)
  })
})

describe('WebPluginRunner.getHooks() integration with executeWebRequest (Phase G end-to-end)', () => {
  it('plugin-registered hooks fire during executeWebRequest lifecycle', async () => {
    const order: string[] = []
    const runner = new WebPluginRunner()
    await runner.register(
      defineWebPlugin({
        name: 'lifecycle-tracker',
        register(app) {
          app.addHook('onRequest', () => {
            order.push('onRequest')
          })
          app.addHook('preHandler', () => {
            order.push('preHandler')
          })
          app.addHook('onResponse', (ctx) => {
            order.push(`onResponse:${ctx.response?.status}`)
          })
        },
      }),
    )
    const routes = {
      GET: defineRoute({
        handler() {
          return { ok: true }
        },
      }),
    }
    const request = new Request('http://example.com/api', { method: 'GET' })
    const response = await executeWebRequest(request, routes, { hooks: runner.getHooks() })
    expect(response.status).toBe(200)
    expect(order).toEqual(['onRequest', 'preHandler', 'onResponse:200'])
  })

  it('multiple plugins compose into a single hook chain via getHooks()', async () => {
    const order: string[] = []
    const runner = new WebPluginRunner()
    await runner.register(
      defineWebPlugin({
        name: 'plugin-a',
        register(app) {
          app.addHook('onRequest', () => {
            order.push('a.onRequest')
          })
        },
      }),
    )
    await runner.register(
      defineWebPlugin({
        name: 'plugin-b',
        register(app) {
          app.addHook('onRequest', () => {
            order.push('b.onRequest')
          })
        },
      }),
    )
    const routes = {
      GET: defineRoute({
        handler() {
          return { ok: true }
        },
      }),
    }
    const request = new Request('http://example.com/api', { method: 'GET' })
    await executeWebRequest(request, routes, { hooks: runner.getHooks() })
    expect(order).toEqual(['a.onRequest', 'b.onRequest']) // registration order preserved
  })

  it('plugin onRequest short-circuits handler via ctx.response (e2e)', async () => {
    const runner = new WebPluginRunner()
    await runner.register(
      defineWebPlugin({
        name: 'auth-gate',
        register(app) {
          app.addHook('onRequest', (ctx) => {
            if (ctx.request.headers.get('authorization') === null) {
              ctx.response = new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), {
                status: 401,
                headers: { 'content-type': 'application/json' },
              })
            }
          })
        },
      }),
    )
    const routes = {
      GET: defineRoute({
        handler() {
          return { secretData: 'should-not-leak' }
        },
      }),
    }
    const request = new Request('http://example.com/api', { method: 'GET' })
    const response = await executeWebRequest(request, routes, { hooks: runner.getHooks() })
    expect(response.status).toBe(401)
    const body = (await response.json()) as { code?: string; secretData?: string }
    expect(body.code).toBe('UNAUTHORIZED')
    expect(body.secretData).toBeUndefined()
  })
})
