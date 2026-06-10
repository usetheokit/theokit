import { describe, it, expect } from 'vitest'
import { createObservabilityPlugin } from '../../src/server/observability/middleware.js'
import type { ObservabilityAdapter, SpanHandle } from '../../src/server/observability/adapters/types.js'

function createMockAdapter() {
  const spans: { name: string; attrs: Record<string, unknown>; status?: string; ended: boolean }[] = []
  const counters: { name: string; value: number; attrs: Record<string, unknown> }[] = []

  const adapter: ObservabilityAdapter = {
    name: 'mock',
    startSpan(name, attrs) {
      const span = { name, attrs: { ...attrs } as Record<string, unknown>, ended: false, status: undefined as string | undefined }
      const handle: SpanHandle = {
        setAttribute(k, v) { span.attrs[k] = v },
        setStatus(s) { span.status = s },
        end() { span.ended = true; spans.push(span) },
      }
      return handle
    },
    counter(name, value, attrs) { counters.push({ name, value, attrs: { ...attrs } as Record<string, unknown> }) },
    histogram() {},
    log() {},
    flush: async () => {},
    shutdown: async () => {},
  }

  return { adapter, spans, counters }
}

describe('T30.5 — Auto-instrumentation middleware', () => {
  it('creates span with method + path on request', async () => {
    const { adapter, spans } = createMockAdapter()
    const plugin = createObservabilityPlugin(adapter)

    const ctx = { requestId: 'r1', request: { method: 'GET', url: '/api/test' } }
    await plugin.onRequest(ctx)
    await plugin.onResponse({ ...ctx, response: { statusCode: 200 } })

    expect(spans).toHaveLength(1)
    expect(spans[0].attrs.method).toBe('GET')
    expect(spans[0].attrs.path).toBe('/api/test')
    expect(spans[0].attrs.status).toBe(200)
    expect(spans[0].status).toBe('ok')
    expect(spans[0].ended).toBe(true)
  })

  it('increments http.requests counter on response', async () => {
    const { adapter, counters } = createMockAdapter()
    const plugin = createObservabilityPlugin(adapter)

    await plugin.onRequest({ requestId: 'r1', request: { method: 'POST', url: '/api/data' } })
    await plugin.onResponse({ requestId: 'r1', request: { method: 'POST', url: '/api/data' }, response: { statusCode: 201 } })

    expect(counters.some(c => c.name === 'http.requests' && c.value === 1)).toBe(true)
  })

  it('onError sets span status to error', async () => {
    const { adapter, spans } = createMockAdapter()
    const plugin = createObservabilityPlugin(adapter)

    await plugin.onRequest({ requestId: 'r1', request: { method: 'GET', url: '/fail' } })
    await plugin.onError({
      requestId: 'r1',
      request: { method: 'GET', url: '/fail' },
      error: new Error('internal error'),
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].status).toBe('error')
    expect(spans[0].attrs.error).toBe(true)
  })

  it('increments http.errors counter on error', async () => {
    const { adapter, counters } = createMockAdapter()
    const plugin = createObservabilityPlugin(adapter)

    await plugin.onRequest({ requestId: 'r1', request: { method: 'GET', url: '/fail' } })
    await plugin.onError({
      requestId: 'r1',
      request: { method: 'GET', url: '/fail' },
      error: new Error('boom'),
    })

    expect(counters.some(c => c.name === 'http.errors')).toBe(true)
  })

  it('plugin name is "theokit:observability"', () => {
    const { adapter } = createMockAdapter()
    const plugin = createObservabilityPlugin(adapter)
    expect(plugin.name).toBe('theokit:observability')
  })

  it('multiple concurrent requests track independently', async () => {
    const { adapter, spans } = createMockAdapter()
    const plugin = createObservabilityPlugin(adapter)

    await plugin.onRequest({ requestId: 'r1', request: { method: 'GET', url: '/a' } })
    await plugin.onRequest({ requestId: 'r2', request: { method: 'POST', url: '/b' } })

    await plugin.onResponse({ requestId: 'r2', request: { method: 'POST', url: '/b' }, response: { statusCode: 201 } })
    await plugin.onResponse({ requestId: 'r1', request: { method: 'GET', url: '/a' }, response: { statusCode: 200 } })

    expect(spans).toHaveLength(2)
    expect(spans[0].attrs.path).toBe('/b') // r2 ended first
    expect(spans[1].attrs.path).toBe('/a') // r1 ended second
  })

  it('onResponse without prior onRequest is a no-op', async () => {
    const { adapter, spans } = createMockAdapter()
    const plugin = createObservabilityPlugin(adapter)

    await plugin.onResponse({ requestId: 'unknown', request: { method: 'GET', url: '/x' }, response: { statusCode: 200 } })
    expect(spans).toHaveLength(0)
  })
})
