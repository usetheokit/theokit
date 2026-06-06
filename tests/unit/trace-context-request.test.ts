/**
 * T5a.2 Phase C slice 1/2 — Web-Standards traceId extractor tests.
 *
 * Verifies `extractTraceIdFromRequest(request)` is a behaviour-equivalent
 * mirror of `extractTraceId(req: IncomingMessage)` for the Web Request
 * shape. Same 3-tier precedence (`traceparent` → `x-request-id` → UUID).
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase C (Tracing + observability). The IncomingMessage tests in
 * `trace-context.test.ts` cover the legacy path; this file covers the Web
 * Request path.
 */
import { describe, it, expect } from 'vitest'

import {
  TRACE_PARENT_HEADER,
  extractTraceIdFromRequest,
} from '../../packages/theo/src/server/http/trace-context.js'

describe('extractTraceIdFromRequest (T5a.2 Phase C slice 1/2 — Web shape)', () => {
  // === Tier 1: traceparent ===

  it('returns the W3C trace-id when traceparent is valid', () => {
    const traceId = 'abcdef0123456789abcdef0123456789'
    const spanId = '0123456789abcdef'
    const request = new Request('http://example.com/api', {
      method: 'GET',
      headers: { [TRACE_PARENT_HEADER]: `00-${traceId}-${spanId}-01` },
    })
    expect(extractTraceIdFromRequest(request)).toBe(traceId)
  })

  it('falls through to next tier when traceparent is malformed', () => {
    const request = new Request('http://example.com/api', {
      method: 'GET',
      headers: {
        traceparent: 'not-a-valid-traceparent',
        'x-request-id': 'fallback-id-from-tier-2',
      },
    })
    expect(extractTraceIdFromRequest(request)).toBe('fallback-id-from-tier-2')
  })

  it('falls through when traceparent uses all-zeros trace-id (W3C-invalid)', () => {
    const request = new Request('http://example.com/api', {
      method: 'GET',
      headers: {
        traceparent: '00-00000000000000000000000000000000-0123456789abcdef-01',
        'x-request-id': 'tier-2-id',
      },
    })
    expect(extractTraceIdFromRequest(request)).toBe('tier-2-id')
  })

  // === Tier 2: x-request-id ===

  it('returns x-request-id when no traceparent is present', () => {
    const request = new Request('http://example.com/api', {
      method: 'GET',
      headers: { 'x-request-id': 'req-abc-123' },
    })
    expect(extractTraceIdFromRequest(request)).toBe('req-abc-123')
  })

  // === Tier 3: generated UUID ===

  it('generates a fresh UUID when no trace headers present', () => {
    const request = new Request('http://example.com/api', { method: 'GET' })
    const id = extractTraceIdFromRequest(request)
    // Web Crypto randomUUID returns a v4 UUID (36 chars, 4 dashes)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('generates distinct UUIDs across calls (no caching)', () => {
    const r1 = new Request('http://example.com/api/a', { method: 'GET' })
    const r2 = new Request('http://example.com/api/b', { method: 'GET' })
    expect(extractTraceIdFromRequest(r1)).not.toBe(extractTraceIdFromRequest(r2))
  })

  // === Precedence ordering ===

  it('prefers valid traceparent over x-request-id', () => {
    const traceId = 'abcdef0123456789abcdef0123456789'
    const spanId = '0123456789abcdef'
    const request = new Request('http://example.com/api', {
      method: 'GET',
      headers: {
        [TRACE_PARENT_HEADER]: `00-${traceId}-${spanId}-01`,
        'x-request-id': 'should-be-ignored',
      },
    })
    expect(extractTraceIdFromRequest(request)).toBe(traceId)
  })
})
