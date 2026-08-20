import { describe, it, expect } from 'vitest'
import { defineObservabilityAdapter } from '../../src/server/observability/define-adapter.js'
import { createObservabilityPlugin } from '../../src/server/observability/middleware.js'

/**
 * Drive the plugin the way the runner does. `createObservabilityPlugin` returns
 * a `TheoPlugin` — hooks reached through `register`, over the real
 * `PluginContext` — so these end-to-end tests exercise the same surface a boot
 * does rather than a private shape (usetheokit/theokit#353).
 */
function driveHooks(plugin: { register: (app: never) => void }) {
  const hooks = new Map<string, ((ctx: never) => void | Promise<void>)[]>()
  const app = {
    addHook(name: string, fn: (ctx: never) => void | Promise<void>) {
      const list = hooks.get(name) ?? []
      list.push(fn)
      hooks.set(name, list)
    },
    decorateRequest() {},
  }
  plugin.register(app as never)
  return async (name: string, ctx: unknown) => {
    for (const fn of hooks.get(name) ?? []) await fn(ctx as never)
  }
}

function hookContext(requestId: string, method: string, path: string, statusCode = 200) {
  return {
    requestId,
    request: new Request(`http://localhost${path}`, { method }),
    response: { statusCode } as unknown,
    ctx: {},
  }
}

describe('T30.6 — defineObservabilityAdapter() + E2E', () => {
  it('defineObservabilityAdapter creates a valid adapter', () => {
    const adapter = defineObservabilityAdapter({
      name: 'my-backend',
      startSpan: () => ({ setAttribute() {}, setStatus() {}, end() {} }),
      counter: () => {},
      histogram: () => {},
      log: () => {},
      flush: async () => {},
      shutdown: async () => {},
    })

    expect(adapter.name).toBe('my-backend')
    const span = adapter.startSpan('test')
    expect(typeof span.end).toBe('function')
  })

  it('custom adapter methods are callable', () => {
    let counterCalled = false
    let logMessage = ''

    const adapter = defineObservabilityAdapter({
      name: 'test',
      startSpan: () => ({ setAttribute() {}, setStatus() {}, end() {} }),
      counter: () => {
        counterCalled = true
      },
      histogram: () => {},
      log: (_level, msg) => {
        logMessage = msg
      },
      flush: async () => {},
      shutdown: async () => {},
    })

    adapter.counter('test', 1)
    expect(counterCalled).toBe(true)

    adapter.log('info', 'hello')
    expect(logMessage).toBe('hello')
  })

  it('E2E: full pipeline — request through middleware emits to custom adapter', async () => {
    const events: string[] = []

    const adapter = defineObservabilityAdapter({
      name: 'test-e2e',
      startSpan: (name) => {
        events.push(`span:${name}`)
        return {
          setAttribute() {},
          setStatus() {},
          end() {
            events.push('end')
          },
        }
      },
      counter: (name) => events.push(`counter:${name}`),
      histogram: () => {},
      log: () => {},
      flush: async () => {},
      shutdown: async () => {},
    })

    const fire = driveHooks(createObservabilityPlugin(adapter))

    const ctx = hookContext('e2e', 'POST', '/api/data', 201)
    await fire('onRequest', ctx)
    await fire('onResponse', ctx)

    expect(events).toContain('span:http.request')
    expect(events).toContain('end')
    expect(events).toContain('counter:http.requests')
  })

  it('E2E: error pipeline — error through middleware emits error to adapter', async () => {
    const events: string[] = []

    const adapter = defineObservabilityAdapter({
      name: 'test-error',
      startSpan: (name) => {
        events.push(`span:${name}`)
        return {
          setAttribute: (k) => events.push(`attr:${k}`),
          setStatus: (s) => events.push(`status:${s}`),
          end() {
            events.push('end')
          },
        }
      },
      counter: (name) => events.push(`counter:${name}`),
      histogram: () => {},
      log: () => {},
      flush: async () => {},
      shutdown: async () => {},
    })

    const fire = driveHooks(createObservabilityPlugin(adapter))

    const ctx = hookContext('err1', 'GET', '/fail')
    await fire('onRequest', ctx)
    await fire('onError', { ...ctx, error: new Error('boom') })

    expect(events).toContain('span:http.request')
    expect(events).toContain('attr:error')
    expect(events).toContain('status:error')
    expect(events).toContain('end')
    expect(events).toContain('counter:http.errors')
  })
})
