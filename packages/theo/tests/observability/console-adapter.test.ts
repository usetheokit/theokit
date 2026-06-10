import { describe, it, expect } from 'vitest'
import { ConsoleObservabilityAdapter } from '../../src/server/observability/adapters/console.js'

describe('T30.2 — Console adapter', () => {
  it('console adapter logs span to writer as JSON', () => {
    const chunks: string[] = []
    const adapter = new ConsoleObservabilityAdapter({ write: (s) => chunks.push(s) })
    const span = adapter.startSpan('http.request', { method: 'GET', path: '/' })
    span.end()

    expect(chunks.length).toBeGreaterThanOrEqual(1)
    const log = JSON.parse(chunks[0])
    expect(log.type).toBe('span')
    expect(log.name).toBe('http.request')
    expect(log.duration_ms).toBeGreaterThanOrEqual(0)
    expect(log.attributes.method).toBe('GET')
  })

  it('console adapter counter emits structured log', () => {
    const chunks: string[] = []
    const adapter = new ConsoleObservabilityAdapter({ write: (s) => chunks.push(s) })
    adapter.counter('http.requests', 1, { method: 'GET' })

    expect(chunks.length).toBe(1)
    const log = JSON.parse(chunks[0])
    expect(log.type).toBe('counter')
    expect(log.metric).toBe('http.requests')
    expect(log.value).toBe(1)
    expect(log.attributes.method).toBe('GET')
  })

  it('console adapter histogram emits structured log', () => {
    const chunks: string[] = []
    const adapter = new ConsoleObservabilityAdapter({ write: (s) => chunks.push(s) })
    adapter.histogram('http.duration_ms', 42)

    const log = JSON.parse(chunks[0])
    expect(log.type).toBe('histogram')
    expect(log.metric).toBe('http.duration_ms')
    expect(log.value).toBe(42)
  })

  it('console adapter log emits structured log', () => {
    const chunks: string[] = []
    const adapter = new ConsoleObservabilityAdapter({ write: (s) => chunks.push(s) })
    adapter.log('warn', 'rate limit approaching', { remaining: 5 })

    const log = JSON.parse(chunks[0])
    expect(log.type).toBe('log')
    expect(log.level).toBe('warn')
    expect(log.message).toBe('rate limit approaching')
  })

  it('console adapter name is "console"', () => {
    expect(new ConsoleObservabilityAdapter().name).toBe('console')
  })

  it('EC-2: console adapter ignores after shutdown', async () => {
    const chunks: string[] = []
    const adapter = new ConsoleObservabilityAdapter({ write: (s) => chunks.push(s) })
    await adapter.shutdown()

    adapter.counter('post.shutdown', 1)
    const span = adapter.startSpan('post.shutdown')
    span.end()

    expect(chunks).toEqual([]) // nothing emitted after shutdown
  })
})
