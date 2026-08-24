import { describe, it, expect } from 'vitest'
import { serializeSpansToOtlp } from '../../src/server/observability/otlp-serializer.js'
import type { SpanData } from '../../src/server/observability/span.js'

interface OtlpAttribute {
  key: string
  value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean }
}

describe('T30.3 — OTLP serializer', () => {
  it('produces valid ExportTraceServiceRequest JSON', () => {
    const spans: SpanData[] = [
      {
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: 'a1b2c3d4e5f60718',
        name: 'http.request',
        attributes: { method: 'GET', path: '/api/test' },
        status: 'ok',
        startTimeMs: 1000,
        endTimeMs: 1050,
        durationMs: 50,
      },
    ]

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
    const spans: SpanData[] = [
      {
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: 'a1b2c3d4e5f60718',
        name: 'test',
        attributes: { method: 'POST', status: 201, cached: true },
        status: 'ok',
        startTimeMs: 1000,
        endTimeMs: 1010,
        durationMs: 10,
      },
    ]

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
    const spans: SpanData[] = [
      {
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: 'a1b2c3d4e5f60718',
        name: 'test',
        attributes: {},
        status: 'error',
        statusMessage: 'timeout',
        startTimeMs: 1000,
        endTimeMs: 1500,
        durationMs: 500,
      },
    ]

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

/**
 * A fractional number is an OTLP `doubleValue`, never an `intValue`
 * (usetheokit/theokit#380).
 *
 * `cost.usd` is the one attribute that answers "what did this run cost", and it
 * reached the collector as `{"intValue":"0.0031"}` — a string that is not an
 * integer, in the field reserved for integers. A collector may reject it, coerce
 * it to 0, or store the string; none of those is the number.
 *
 * It survived because the only numeric fixture in this file was `201`, and 201
 * happens to be an integer. A fixture that cannot express the failing case
 * cannot fail on it — the same shape as the token attributes that were read from
 * an invented flat object, and the recorder that dropped the argument it did not
 * use.
 */
describe('numeric attributes', () => {
  const attributesOf = (attributes: SpanData['attributes']) => {
    const spans: SpanData[] = [
      {
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: 'a1b2c3d4e5f60718',
        name: 'agent.run',
        attributes,
        status: 'ok',
        startTimeMs: 1000,
        endTimeMs: 1010,
        durationMs: 10,
      },
    ]
    const parsed = JSON.parse(new TextDecoder().decode(serializeSpansToOtlp(spans))) as {
      resourceSpans: { scopeSpans: { spans: { attributes: OtlpAttribute[] }[] }[] }[]
    }
    const list = parsed.resourceSpans[0].scopeSpans[0].spans[0].attributes
    return (key: string) => list.find((a) => a.key === key)?.value
  }

  it('a fractional value is a doubleValue and NOT an intValue', () => {
    const value = attributesOf({ 'cost.usd': 0.0031 })('cost.usd')

    expect(value?.doubleValue).toBe(0.0031)
    expect(value?.intValue).toBeUndefined()
  })

  it('an integral value stays an intValue', () => {
    // Token counts, status codes and durations are integers and must not move to
    // `doubleValue`: a collector aggregating `tokens.total` as a double is a
    // different regression, introduced by an over-broad fix for this one.
    const read = attributesOf({ 'tokens.total': 1234, 'http.status': 201 })

    expect(read('tokens.total')?.intValue).toBe('1234')
    expect(read('http.status')?.intValue).toBe('201')
    expect(read('tokens.total')?.doubleValue).toBeUndefined()
  })

  it('a whole number written as a float is still an integer', () => {
    // `2.0` is `2` in JavaScript; there is no float/int distinction to preserve,
    // and pretending otherwise would make the wire shape depend on how a literal
    // was typed rather than on the value.
    expect(attributesOf({ 'tokens.total': 2.0 })('tokens.total')?.intValue).toBe('2')
  })

  it('a negative fraction and a very small one both stay doubles', () => {
    const read = attributesOf({ delta: -0.5, tiny: 1e-9 })

    expect(read('delta')?.doubleValue).toBe(-0.5)
    expect(read('tiny')?.doubleValue).toBe(1e-9)
  })
})
