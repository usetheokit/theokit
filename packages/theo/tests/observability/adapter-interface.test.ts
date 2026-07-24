import { describe, it, expect } from 'vitest'
import { NoopObservabilityAdapter } from '../../src/server/observability/adapters/noop.js'
import { SpanImpl } from '../../src/server/observability/span.js'

describe('T30.1 — ObservabilityAdapter interface + SpanHandle + noop', () => {
  it('noop adapter startSpan returns a SpanHandle', () => {
    const adapter = new NoopObservabilityAdapter()
    const span = adapter.startSpan('test.span')
    expect(span).toBeDefined()
    expect(typeof span.end).toBe('function')
    expect(typeof span.setAttribute).toBe('function')
    expect(typeof span.setStatus).toBe('function')
  })

  it('noop adapter counter/histogram/log do not throw', () => {
    const adapter = new NoopObservabilityAdapter()
    expect(() => adapter.counter('test.count', 1)).not.toThrow()
    expect(() => adapter.histogram('test.duration', 42)).not.toThrow()
    expect(() => adapter.log('info', 'test')).not.toThrow()
  })

  it('noop span end is idempotent', () => {
    const adapter = new NoopObservabilityAdapter()
    const span = adapter.startSpan('test')
    span.end()
    expect(() => span.end()).not.toThrow()
  })

  it('noop adapter name is "noop"', () => {
    expect(new NoopObservabilityAdapter().name).toBe('noop')
  })

  it('noop flush and shutdown resolve', async () => {
    const adapter = new NoopObservabilityAdapter()
    await expect(adapter.flush()).resolves.not.toThrow()
    await expect(adapter.shutdown()).resolves.not.toThrow()
  })

  it('EC-2: startSpan after shutdown returns noop span', async () => {
    const adapter = new NoopObservabilityAdapter()
    await adapter.shutdown()
    const span = adapter.startSpan('post-shutdown')
    expect(span).toBeDefined()
    expect(() => span.end()).not.toThrow()
  })

  it('EC-2: flush after shutdown is a no-op', async () => {
    const adapter = new NoopObservabilityAdapter()
    await adapter.shutdown()
    await expect(adapter.flush()).resolves.not.toThrow()
  })

  it('SpanImpl records timing and attributes', () => {
    const span = new SpanImpl('test.span', { method: 'GET' })
    span.setAttribute('status', 200)
    span.setStatus('ok')
    span.end()

    const data = span.getData()
    expect(data.name).toBe('test.span')
    expect(data.attributes.method).toBe('GET')
    expect(data.attributes.status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.durationMs).toBeGreaterThanOrEqual(0)
    expect(span.isEnded()).toBe(true)
  })

  it('SpanImpl end is idempotent', () => {
    const span = new SpanImpl('test')
    span.end()
    const firstDuration = span.getData().durationMs
    span.end()
    expect(span.getData().durationMs).toBe(firstDuration)
  })

  it('SpanImpl ignores setAttribute after end', () => {
    const span = new SpanImpl('test')
    span.end()
    span.setAttribute('late', 'value')
    expect(span.getData().attributes.late).toBeUndefined()
  })
})
