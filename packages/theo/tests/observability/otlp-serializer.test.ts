import { describe, it, expect } from 'vitest'
import { serializeSpansToOtlp } from '../../src/server/observability/otlp-serializer.js'
import type { SpanData } from '../../src/server/observability/span.js'

describe('T30.3 — OTLP serializer', () => {
  it('produces valid ExportTraceServiceRequest JSON', () => {
    const spans: SpanData[] = [{
      name: 'http.request',
      attributes: { method: 'GET', path: '/api/test' },
      status: 'ok',
      startTimeMs: 1000,
      endTimeMs: 1050,
      durationMs: 50,
    }]

    const bytes = serializeSpansToOtlp(spans)
    const parsed = JSON.parse(new TextDecoder().decode(bytes))

    expect(parsed.resourceSpans).toBeDefined()
    expect(parsed.resourceSpans).toHaveLength(1)
    const span = parsed.resourceSpans[0].scopeSpans[0].spans[0]
    expect(span.name).toBe('http.request')
    expect(span.kind).toBe(2) // SERVER
    expect(span.status.code).toBe(1) // OK
  })

  it('serializes attributes with correct types', () => {
    const spans: SpanData[] = [{
      name: 'test',
      attributes: { method: 'POST', status: 201, cached: true },
      status: 'ok',
      startTimeMs: 1000,
      endTimeMs: 1010,
      durationMs: 10,
    }]

    const parsed = JSON.parse(new TextDecoder().decode(serializeSpansToOtlp(spans)))
    const attrs = parsed.resourceSpans[0].scopeSpans[0].spans[0].attributes

    const methodAttr = attrs.find((a: { key: string }) => a.key === 'method')
    expect(methodAttr.value.stringValue).toBe('POST')

    const statusAttr = attrs.find((a: { key: string }) => a.key === 'status')
    expect(statusAttr.value.intValue).toBe('201')

    const cachedAttr = attrs.find((a: { key: string }) => a.key === 'cached')
    expect(cachedAttr.value.boolValue).toBe(true)
  })

  it('error status maps to code 2', () => {
    const spans: SpanData[] = [{
      name: 'test',
      attributes: {},
      status: 'error',
      statusMessage: 'timeout',
      startTimeMs: 1000,
      endTimeMs: 1500,
      durationMs: 500,
    }]

    const parsed = JSON.parse(new TextDecoder().decode(serializeSpansToOtlp(spans)))
    expect(parsed.resourceSpans[0].scopeSpans[0].spans[0].status.code).toBe(2)
  })

  it('EC-3: empty spans array produces valid OTLP JSON', () => {
    const bytes = serializeSpansToOtlp([])
    const parsed = JSON.parse(new TextDecoder().decode(bytes))

    expect(parsed.resourceSpans).toBeDefined()
    expect(parsed.resourceSpans[0].scopeSpans[0].spans).toEqual([])
  })

  it('uses custom service name', () => {
    const bytes = serializeSpansToOtlp([], 'my-service')
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    expect(parsed.resourceSpans[0].scopeSpans[0].scope.name).toBe('my-service')
  })
})
