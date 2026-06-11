import { describe, it, expect } from 'vitest'
import { defineObservabilityAdapter } from '../../src/server/observability/define-adapter.js'
import { createObservabilityPlugin } from '../../src/server/observability/middleware.js'

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
      counter: () => { counterCalled = true },
      histogram: () => {},
      log: (_level, msg) => { logMessage = msg },
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
          end() { events.push('end') },
        }
      },
      counter: (name) => events.push(`counter:${name}`),
      histogram: () => {},
      log: () => {},
      flush: async () => {},
      shutdown: async () => {},
    })

    const plugin = createObservabilityPlugin(adapter)

    await plugin.onRequest({ requestId: 'e2e', request: { method: 'POST', url: '/api/data' } })
    await plugin.onResponse({
      requestId: 'e2e',
      request: { method: 'POST', url: '/api/data' },
      response: { statusCode: 201 },
    })

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
          end() { events.push('end') },
        }
      },
      counter: (name) => events.push(`counter:${name}`),
      histogram: () => {},
      log: () => {},
      flush: async () => {},
      shutdown: async () => {},
    })

    const plugin = createObservabilityPlugin(adapter)

    await plugin.onRequest({ requestId: 'err1', request: { method: 'GET', url: '/fail' } })
    await plugin.onError({
      requestId: 'err1',
      request: { method: 'GET', url: '/fail' },
      error: new Error('boom'),
    })

    expect(events).toContain('span:http.request')
    expect(events).toContain('attr:error')
    expect(events).toContain('status:error')
    expect(events).toContain('end')
    expect(events).toContain('counter:http.errors')
  })
})
