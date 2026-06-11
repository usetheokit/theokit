/**
 * RED tests for buildRequestPreview — pure helper that produces a
 * devtools-safe body preview string + truncation metadata from an
 * arbitrary parsed body (object, string, Buffer, undefined).
 *
 * Before this helper, the devtools Requests tab's expanded view showed
 * no body / no headers at all because broadcastRequestToDevtools only
 * forwarded {method, path, status, duration, traceId}. This helper
 * formalizes the preview contract; consumers wire it through.
 */
import { describe, expect, it } from 'vitest'

import { buildRequestBodyPreview } from '../../packages/theo/src/devtools/server-side/build-request-body-preview.js'

describe('buildRequestBodyPreview', () => {
  it('returns undefined for nullish body', () => {
    expect(buildRequestBodyPreview(undefined)).toBeUndefined()
    expect(buildRequestBodyPreview(null)).toBeUndefined()
  })

  it('serializes object as pretty JSON', () => {
    const out = buildRequestBodyPreview({ a: 1, b: 'two' })
    expect(out).toBeDefined()
    expect(out?.preview).toContain('"a": 1')
    expect(out?.preview).toContain('"b": "two"')
    expect(out?.truncated).toBe(false)
  })

  it('passes strings through unchanged', () => {
    const out = buildRequestBodyPreview('hello world')
    expect(out?.preview).toBe('hello world')
    expect(out?.length).toBe(11)
  })

  it('truncates bodies above the 4 KB cap (default)', () => {
    const big = 'x'.repeat(5000)
    const out = buildRequestBodyPreview(big)
    expect(out?.truncated).toBe(true)
    expect(out?.length).toBe(5000)
    expect((out?.preview ?? '').length).toBeLessThanOrEqual(4096)
  })

  it('respects custom maxBytes', () => {
    const out = buildRequestBodyPreview('1234567890', { maxBytes: 5 })
    expect(out?.truncated).toBe(true)
    expect(out?.preview).toBe('12345')
    expect(out?.length).toBe(10)
  })

  it('handles circular references gracefully', () => {
    const circ: Record<string, unknown> = { a: 1 }
    circ.self = circ
    const out = buildRequestBodyPreview(circ)
    expect(out).toBeDefined()
    expect(out?.preview).toMatch(/<unserializable|circular/i)
  })

  it('handles Buffer-like objects (Uint8Array) as base64 marker', () => {
    const buf = new Uint8Array([0x68, 0x69]) // 'hi'
    const out = buildRequestBodyPreview(buf)
    expect(out).toBeDefined()
    expect(out?.preview).toMatch(/binary|bytes/i)
  })
})
