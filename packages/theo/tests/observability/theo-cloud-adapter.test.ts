import { describe, it, expect, vi } from 'vitest'
import { TheoCloudObservabilityAdapter } from '../../src/server/observability/adapters/theo-cloud.js'

describe('T30.3 — theo-cloud adapter', () => {
  it('batches spans and flushes via fetch', async () => {
    const fetched: { url: string; body: unknown }[] = []
    const adapter = new TheoCloudObservabilityAdapter({
      ingestUrl: 'https://ingest.test/v1/traces',
      token: 'test-key-fixture',
      _mockFetch: async (url, init) => {
        fetched.push({ url: url as string, body: init?.body })
        return new Response('ok')
      },
    })

    const span = adapter.startSpan('test.span', { method: 'GET' })
    span.end()
    await adapter.flush()

    expect(fetched).toHaveLength(1)
    expect(fetched[0].url).toBe('https://ingest.test/v1/traces')
  })

  it('sends authorization header with API key', async () => {
    let authHeader = ''
    const adapter = new TheoCloudObservabilityAdapter({
      ingestUrl: 'https://ingest.test/v1/traces',
      token: 'test-key-secret-fixture',
      _mockFetch: async (_url, init) => {
        authHeader = (init?.headers as Record<string, string>)?.authorization ?? ''
        return new Response('ok')
      },
    })

    const span = adapter.startSpan('test')
    span.end()
    await adapter.flush()

    expect(authHeader).toBe('Bearer tck_secret_123')
  })

  it('flush with no pending spans is a no-op', async () => {
    let fetchCalled = false
    const adapter = new TheoCloudObservabilityAdapter({
      ingestUrl: 'https://ingest.test/v1/traces',
      token: 'test-key-fixture',
      _mockFetch: async () => { fetchCalled = true; return new Response('ok') },
    })

    await adapter.flush()
    expect(fetchCalled).toBe(false)
  })

  it('EC-1: flush failure logs warning and does not throw', async () => {
    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const adapter = new TheoCloudObservabilityAdapter({
      ingestUrl: 'https://ingest.test/v1/traces',
      token: 'test-key-fixture',
      _mockFetch: async () => { throw new Error('network down') },
    })

    const span = adapter.startSpan('test')
    span.end()
    await expect(adapter.flush()).resolves.not.toThrow()

    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0]?.[0]).toContain('flush failed')
    expect(warnSpy.mock.calls[0]?.[0]).toContain('network down')

    warnSpy.mockRestore()
  })

  it('EC-2: startSpan after shutdown returns noop span', async () => {
    const adapter = new TheoCloudObservabilityAdapter({
      ingestUrl: 'https://ingest.test/v1/traces',
      token: 'test-key-fixture',
      _mockFetch: async () => new Response('ok'),
    })

    await adapter.shutdown()
    const span = adapter.startSpan('post-shutdown')
    expect(() => span.end()).not.toThrow()
  })

  it('name is "theo-cloud"', () => {
    const adapter = new TheoCloudObservabilityAdapter({
      ingestUrl: 'https://ingest.test/v1/traces',
      token: 'test-key-fixture',
    })
    expect(adapter.name).toBe('theo-cloud')
  })

  it('shutdown flushes pending spans before closing', async () => {
    let flushed = false
    const adapter = new TheoCloudObservabilityAdapter({
      ingestUrl: 'https://ingest.test/v1/traces',
      token: 'test-key-fixture',
      _mockFetch: async () => { flushed = true; return new Response('ok') },
    })

    const span = adapter.startSpan('test')
    span.end()
    await adapter.shutdown()

    expect(flushed).toBe(true)
  })
})
